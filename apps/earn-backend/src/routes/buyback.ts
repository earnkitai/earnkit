import { Router, Request, Response } from 'express';
import { isAddress, getAddress } from 'viem';
import { p256 } from '@noble/curves/nist.js';
import { prisma } from '../lib/prisma';
import {
  assertHasCode,
  canReceiveDead,
  detectBurnFunction,
  getTokenMeta,
  TokenSafetyError,
  assertNotHoneypot,
} from '../lib/tokenSafety';
import { SUPPORTED_TOKENS } from '../services/tokenService';
import { SPLIT_NATIVE_TOKEN_ADDRESS } from '../lib/splitsWarehouse';
import { createBuybackSubOrg } from '../services/turnkeyService';

const router: Router = Router({ mergeParams: true });

// Generate a fresh P-256 keypair for the sub-org's delegated API key.
// Public key is sent to Turnkey; private key is stored encrypted alongside
// the BuybackConfig (used by the executor worker to call signTransaction).
function generateDelegatedKeypair(): {
  publicKeyHex: string;
  privateKeyHex: string;
} {
  const { secretKey, publicKey } = p256.keygen();
  const compressedPub = p256.getPublicKey(secretKey, true);
  const toHex = (b: Uint8Array) =>
    Array.from(b)
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
  void publicKey; // keygen() returns uncompressed; we publish the compressed form
  return {
    publicKeyHex: toHex(compressedPub),
    privateKeyHex: toHex(secretKey),
  };
}

async function findAgent(agentParam: string) {
  // Same fallback pattern token-config uses: try UUID, then external slug.
  let agent = await prisma.agent.findUnique({
    where: { id: agentParam },
    include: { user: true, buybackConfig: true },
  });
  if (!agent) {
    agent = await prisma.agent.findUnique({
      where: { agentId: agentParam },
      include: { user: true, buybackConfig: true },
    });
  }
  return agent;
}

// GET /api/agents/:agentId/buyback — current config (or null)
router.get('/', async (req: Request, res: Response) => {
  try {
    const agent = await findAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const config = agent.buybackConfig;
    if (!config) {
      return res.json({ buybackConfig: null });
    }

    // Don't ever leak the delegated API key id beyond what's necessary.
    return res.json({
      buybackConfig: {
        id: config.id,
        tokenAddress: config.tokenAddress,
        tokenSymbol: config.tokenSymbol,
        tokenDecimals: config.tokenDecimals,
        thresholdUsd: config.thresholdUsd,
        slippageBps: config.slippageBps,
        burnMode: config.burnMode,
        walletAddress: config.walletAddress,
        isActive: config.isActive,
        lastCheckedAt: config.lastCheckedAt,
        lastTriggeredAt: config.lastTriggeredAt,
      },
    });
  } catch (err: any) {
    console.error('[buyback] GET error:', err);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// POST /api/agents/:agentId/buyback — create or update config
//
// Body: { tokenAddress, thresholdUsd?, slippageBps?, burnMode? }
// On first enable: provisions Turnkey sub-org + wallet, runs token safety
// pre-checks, persists config, and overwrites Agent.buybackAddress.
router.post('/', async (req: Request, res: Response) => {
  try {
    const agent = await findAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const {
      tokenAddress: rawToken,
      thresholdUsd,
      slippageBps,
      burnMode: requestedBurnMode,
    } = req.body ?? {};

    if (!rawToken || typeof rawToken !== 'string' || !isAddress(rawToken)) {
      return res.status(400).json({ error: 'tokenAddress must be a valid 0x address' });
    }
    const tokenAddress = getAddress(rawToken) as `0x${string}`;

    if (
      thresholdUsd !== undefined &&
      (typeof thresholdUsd !== 'number' || !Number.isFinite(thresholdUsd) || thresholdUsd < 1)
    ) {
      return res.status(400).json({ error: 'thresholdUsd must be a number >= 1' });
    }
    if (
      slippageBps !== undefined &&
      (typeof slippageBps !== 'number' || slippageBps < 100 || slippageBps > 2000)
    ) {
      return res.status(400).json({ error: 'slippageBps must be between 100 and 2000' });
    }

    if (agent.buybackConfig) {
      // Only allow updating mutable fields. Token + wallet are locked once provisioned —
      // changing them would need a fresh sub-org (or a confirmed sweep of stranded funds).
      if (
        tokenAddress.toLowerCase() !==
        agent.buybackConfig.tokenAddress.toLowerCase()
      ) {
        return res.status(409).json({
          error:
            'tokenAddress is locked once provisioned. Disable buyback (DELETE) and re-create with the new token after sweeping any stranded funds.',
        });
      }
      const updated = await prisma.buybackConfig.update({
        where: { id: agent.buybackConfig.id },
        data: {
          ...(thresholdUsd !== undefined && { thresholdUsd }),
          ...(slippageBps !== undefined && { slippageBps }),
          ...(requestedBurnMode === 'TOKEN_BURN_FN' || requestedBurnMode === 'DEAD_ADDRESS'
            ? { burnMode: requestedBurnMode }
            : {}),
          isActive: true,
        },
      });
      return res.json({ buybackConfig: updated });
    }

    // First-time enable: run pre-checks and provision wallet.
    const userEmail = agent.user.email;
    if (!userEmail) {
      return res.status(400).json({
        error:
          'Agent owner must have a verified email before enabling buyback (root authenticator on Turnkey sub-org).',
      });
    }

    try {
      await assertHasCode(tokenAddress);
      const meta = await getTokenMeta(tokenAddress);
      await assertNotHoneypot(tokenAddress);
      const canDead = await canReceiveDead(tokenAddress);
      let burnMode: 'DEAD_ADDRESS' | 'TOKEN_BURN_FN';
      if (canDead) {
        burnMode =
          requestedBurnMode === 'TOKEN_BURN_FN' ? 'TOKEN_BURN_FN' : 'DEAD_ADDRESS';
      } else {
        // Forced fallback: token blocks transfers to 0xdEaD, must use burn().
        const hasBurn = await detectBurnFunction(tokenAddress);
        if (!hasBurn) {
          throw new TokenSafetyError(
            'no_burn_function',
            `Token ${tokenAddress} blocks transfers to the dead address and exposes no burn() function — cannot be auto-burned`,
          );
        }
        burnMode = 'TOKEN_BURN_FN';
      }

      // Provision Turnkey sub-org (root = end user; delegated key = our bot).
      const { publicKeyHex, privateKeyHex } = generateDelegatedKeypair();
      const allowedSwapInputTokens = [
        SPLIT_NATIVE_TOKEN_ADDRESS,
        ...SUPPORTED_TOKENS.map((t) => t.address as `0x${string}`),
      ];

      const subOrg = await createBuybackSubOrg({
        agentId: agent.id,
        userEmail,
        delegatedApiPublicKey: publicKeyHex,
        policyParams: {
          userTokenAddress: tokenAddress,
          allowedSwapInputTokens,
        },
      });

      // The delegated private key MUST be stored to call signTransaction later.
      // Persist it via env-keyed encryption (BUYBACK_KEYWRAP_SECRET). For v1
      // we store it in an env-derived secrets store; the worker reads it on demand.
      // TODO(prod): move to a real KMS (AWS KMS / GCP KMS) — for now, env-encrypted JSON column.
      const config = await prisma.buybackConfig.create({
        data: {
          agentId: agent.id,
          tokenAddress,
          tokenSymbol: meta.symbol,
          tokenDecimals: meta.decimals,
          thresholdUsd: thresholdUsd ?? 10,
          slippageBps: slippageBps ?? 500,
          burnMode,
          turnkeySubOrgId: subOrg.subOrgId,
          turnkeyWalletId: subOrg.walletId,
          walletAddress: subOrg.walletAddress,
          delegatedApiKeyId: subOrg.delegatedApiKeyId,
          policyId: subOrg.policyId,
          isActive: true,
        },
      });

      // Stash the encrypted delegated private key — the executor worker needs it
      // to mint stamped Turnkey requests. Stored in a sibling DelegatedKeyMaterial
      // table or a JSON column; for now we hold it in a local secrets file under
      // process.env.BUYBACK_KEYS_DIR. Workers read by config.id.
      await persistDelegatedPrivateKey(config.id, privateKeyHex);

      // Update Agent.buybackAddress so future split deployments route to the new wallet.
      await prisma.agent.update({
        where: { id: agent.id },
        data: { buybackAddress: subOrg.walletAddress },
      });

      return res.json({
        buybackConfig: {
          id: config.id,
          tokenAddress: config.tokenAddress,
          tokenSymbol: config.tokenSymbol,
          tokenDecimals: config.tokenDecimals,
          thresholdUsd: config.thresholdUsd,
          slippageBps: config.slippageBps,
          burnMode: config.burnMode,
          walletAddress: config.walletAddress,
          isActive: config.isActive,
        },
        notice:
          burnMode === 'TOKEN_BURN_FN'
            ? 'Token blocks 0xdEaD transfers — using token.burn() instead.'
            : undefined,
      });
    } catch (err) {
      if (err instanceof TokenSafetyError) {
        return res.status(400).json({ error: err.message, reason: err.reason });
      }
      throw err;
    }
  } catch (err: any) {
    console.error('[buyback] POST error:', err);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// DELETE /api/agents/:agentId/buyback — disable auto-buyback (does not destroy
// the Turnkey wallet; user can still claim funds from app.splits.org or via the
// recover endpoint).
router.delete('/', async (req: Request, res: Response) => {
  try {
    const agent = await findAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (!agent.buybackConfig) {
      return res.json({ ok: true, message: 'No buyback config to disable' });
    }
    await prisma.buybackConfig.update({
      where: { id: agent.buybackConfig.id },
      data: { isActive: false },
    });
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[buyback] DELETE error:', err);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// POST /api/agents/:agentId/buyback/recover
//
// Sweeps any stranded funds from the buyback wallet back to the developer's
// connected wallet. Useful when the user disables buyback while funds are still
// accumulating, or when an execution fails permanently. Implemented as a queued
// recovery execution that the worker picks up — same code path, different intent.
router.post('/recover', async (req: Request, res: Response) => {
  try {
    const agent = await findAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (!agent.buybackConfig) {
      return res.status(400).json({ error: 'No buyback config exists for this agent' });
    }
    // Recovery is implemented by the executor: insert a recovery-tagged execution.
    // The worker recognizes this tag and routes funds to Agent.buybackAddress's
    // owning developer wallet rather than swapping & burning.
    const exec = await prisma.buybackExecution.create({
      data: {
        buybackConfigId: agent.buybackConfig.id,
        status: 'QUEUED',
        triggerBalanceUsd: 0,
        assetsIn: { intent: 'recover' },
      },
    });
    return res.json({ ok: true, executionId: exec.id });
  } catch (err: any) {
    console.error('[buyback] recover error:', err);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// --------- Delegated key persistence ---------
//
// We need to hold the private key for our delegated Turnkey API key per
// sub-org so the executor worker can sign requests. Until a proper KMS is
// wired, store it AES-GCM-encrypted in a `DelegatedKeyMaterial` row (added
// inline below as a JSON column on BuybackConfig is sufficient for v1; in
// the actual schema we keep it in a separate model for easier rotation).
//
// For v1 we use the simpler approach: env-encrypted in a small JSON file on
// disk under BUYBACK_KEYS_DIR. This keeps secrets out of the DB until KMS
// is wired up.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

function getKeyDir(): string {
  const dir = process.env.BUYBACK_KEYS_DIR || '/tmp/earnkit-buyback-keys';
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getMasterKey(): Buffer {
  const secret = process.env.BUYBACK_KEYWRAP_SECRET;
  if (!secret) {
    throw new Error('BUYBACK_KEYWRAP_SECRET is not configured');
  }
  return scryptSync(secret, 'earnkit-buyback-v1', 32);
}

export async function persistDelegatedPrivateKey(
  configId: string,
  privateKeyHex: string,
): Promise<void> {
  const key = getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(privateKeyHex, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const payload = {
    v: 1,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ct: encrypted.toString('hex'),
  };
  writeFileSync(
    join(getKeyDir(), `${configId}.json`),
    JSON.stringify(payload),
    { mode: 0o600 },
  );
}

export async function loadDelegatedPrivateKey(configId: string): Promise<string> {
  const raw = readFileSync(join(getKeyDir(), `${configId}.json`), 'utf8');
  const payload = JSON.parse(raw) as {
    iv: string;
    tag: string;
    ct: string;
  };
  const key = getMasterKey();
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ct, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export default router;
