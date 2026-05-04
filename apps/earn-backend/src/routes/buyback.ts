import { Router, Request, Response } from 'express';
import { isAddress, getAddress } from 'viem';
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
// On first enable: provisions a Turnkey sub-org owned by the customer's email
// (customer is root authenticator), runs token safety pre-checks, attaches a
// two-stamper policy that requires both the platform's parent-admin AND the
// off-host co-signer to sign every buyback tx, and persists the config. No
// per-config secret material is created or stored.
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

      // Provision Turnkey sub-org. No per-config keypair — all signing uses
      // parent-org users (parent-admin + off-host co-signer) acting into the
      // sub-org via the attached two-stamper policy.
      const allowedSwapInputTokens = [
        SPLIT_NATIVE_TOKEN_ADDRESS,
        ...SUPPORTED_TOKENS.map((t) => t.address as `0x${string}`),
      ];

      const subOrg = await createBuybackSubOrg({
        agentId: agent.id,
        userEmail,
        policyParams: {
          userTokenAddress: tokenAddress,
          allowedSwapInputTokens,
        },
      });

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
          policyId: subOrg.policyId,
          isActive: true,
        },
      });

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

export default router;
