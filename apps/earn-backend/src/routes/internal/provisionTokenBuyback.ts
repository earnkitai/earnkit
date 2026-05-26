import { Router, Request, Response } from 'express';
import { isAddress, getAddress } from 'viem';
import {
  createBuybackSubOrgWallet,
  attachBuybackPolicy,
} from '../../services/turnkeyService';
import {
  assertHasCode,
  canReceiveDead,
  detectBurnFunction,
  getTokenMeta,
  TokenSafetyError,
} from '../../lib/tokenSafety';
import { SUPPORTED_TOKENS } from '../../services/tokenService';
import { SPLIT_NATIVE_TOKEN_ADDRESS } from '../../lib/splitsWarehouse';
import { prisma } from '../../lib/prisma';

/**
 * Two-phase provisioning for Doppler token-creation buyback.
 *
 * Phase 1 — POST /provision-token-buyback-wallet
 *   Called BEFORE the Doppler deploy tx. We don't yet know the final token
 *   address, so we only create the Turnkey sub-org + wallet (no policy yet)
 *   and persist a SharedSplitBuybackConfig in PROVISIONING state.
 *
 * Phase 2 — POST /activate-token-buyback
 *   Called AFTER the Doppler deploy confirms. Token address is known, so we
 *   attach the buyback policy (token-bound, V3 or V4 router as appropriate)
 *   and flip the config to ACTIVE. EVERY attempt — success or fail — writes
 *   pendingTokenAddress + lastActivationError + lastActivationAttemptAt so:
 *     (a) the admin UI can show creators why their buyback is stuck
 *     (b) the worker can retry without needing tokens.fun to re-call
 *     (c) failures are NEVER silent
 */
const router: Router = Router();

const MIN_THRESHOLD_USD = parseFloat(process.env.PLATFORM_THRESHOLD_USD ?? '10');

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: provision wallet only (no policy)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/provision-token-buyback-wallet', async (req: Request, res: Response) => {
  try {
    const {
      tokenId,
      creatorAddress: rawCreator,
      userEmail,
      thresholdUsd,
    } = req.body ?? {};

    if (!tokenId || typeof tokenId !== 'string') {
      return res.status(400).json({ error: 'tokenId is required' });
    }
    if (!userEmail || typeof userEmail !== 'string') {
      return res.status(400).json({
        error: 'userEmail is required (becomes the root authenticator on the Turnkey sub-org)',
      });
    }
    if (!rawCreator || !isAddress(rawCreator)) {
      return res.status(400).json({ error: 'creatorAddress must be a valid 0x address' });
    }

    const creatorAddress = getAddress(rawCreator) as `0x${string}`;
    const threshold =
      typeof thresholdUsd === 'number' && thresholdUsd >= MIN_THRESHOLD_USD
        ? thresholdUsd
        : MIN_THRESHOLD_USD;

    const wallet = await createBuybackSubOrgWallet({
      agentId: tokenId,
      userEmail,
    });

    const config = await prisma.sharedSplitBuybackConfig.create({
      data: {
        ownerAddress: creatorAddress,
        splitAddress: null,
        tokenAddress: '', // filled in Phase 2
        tokenSymbol: '',
        tokenDecimals: 18,
        feeRateBps: 0,
        thresholdUsd: threshold,
        burnMode: 'DEAD_ADDRESS',
        recoveryAddress: creatorAddress,
        turnkeySubOrgId: wallet.subOrgId,
        turnkeyWalletId: wallet.walletId,
        walletAddress: wallet.walletAddress,
        parentAdminUserId: wallet.parentAdminUserId,
        coSignerUserId: wallet.coSignerUserId,
        status: 'PROVISIONING',
        swapVenue: 'UNISWAP_V3', // overwritten in Phase 2 if caller specifies V4
      },
    });

    return res.json({
      ok: true,
      configId: config.id,
      walletAddress: wallet.walletAddress,
      subOrgId: wallet.subOrgId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[internal/provision-token-buyback-wallet] error:', err);
    return res.status(500).json({ error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: attach policy + flip to ACTIVE (idempotent + retryable)
// ─────────────────────────────────────────────────────────────────────────────
interface ActivateBody {
  configId?: string;
  tokenAddress?: string;
  // V4 pool details — required when swapVenue is UNISWAP_V4 (Doppler tokens).
  // Caller (tokens.fun) supplies these from its pool-key endpoint so we don't
  // need a cross-service runtime dependency at swap time.
  swapVenue?: 'UNISWAP_V3' | 'UNISWAP_V4';
  v4PoolHook?: string;
  v4PairedToken?: string;
  v4TickSpacing?: number;
  v4FeeFlag?: number;
}

async function runActivation(
  configId: string,
  body: ActivateBody,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const rawToken = body.tokenAddress;
  if (!rawToken || !isAddress(rawToken)) {
    return { ok: false, status: 400, error: 'tokenAddress must be a valid 0x address' };
  }
  const tokenAddress = getAddress(rawToken) as `0x${string}`;

  const swapVenue = body.swapVenue ?? 'UNISWAP_V3';
  let v4PoolHook: `0x${string}` | null = null;
  let v4PairedToken: `0x${string}` | null = null;
  let v4TickSpacing: number | null = null;
  let v4FeeFlag: number | null = null;

  if (swapVenue === 'UNISWAP_V4') {
    if (!body.v4PoolHook || !isAddress(body.v4PoolHook)) {
      return { ok: false, status: 400, error: 'v4PoolHook is required for UNISWAP_V4 venue' };
    }
    if (!body.v4PairedToken || !isAddress(body.v4PairedToken)) {
      return { ok: false, status: 400, error: 'v4PairedToken is required for UNISWAP_V4 venue' };
    }
    if (typeof body.v4TickSpacing !== 'number') {
      return { ok: false, status: 400, error: 'v4TickSpacing is required for UNISWAP_V4 venue' };
    }
    if (typeof body.v4FeeFlag !== 'number') {
      return { ok: false, status: 400, error: 'v4FeeFlag is required for UNISWAP_V4 venue' };
    }
    v4PoolHook = getAddress(body.v4PoolHook) as `0x${string}`;
    v4PairedToken = getAddress(body.v4PairedToken) as `0x${string}`;
    v4TickSpacing = body.v4TickSpacing;
    v4FeeFlag = body.v4FeeFlag;
  }

  const config = await prisma.sharedSplitBuybackConfig.findUnique({ where: { id: configId } });
  if (!config) {
    return { ok: false, status: 404, error: `config ${configId} not found` };
  }
  if (config.status === 'ACTIVE') {
    return { ok: true, payload: { alreadyActive: true, configId } };
  }
  if (config.status !== 'PROVISIONING') {
    return {
      ok: false,
      status: 400,
      error: `config ${configId} is in status ${config.status}; expected PROVISIONING`,
    };
  }
  if (!config.turnkeySubOrgId || !config.parentAdminUserId || !config.coSignerUserId) {
    return {
      ok: false,
      status: 500,
      error: `config ${configId} is missing Turnkey identifiers — wallet provisioning incomplete`,
    };
  }

  // Persist attempt metadata BEFORE the attempt so a hard crash mid-attempt
  // still leaves a trail. pendingTokenAddress is the canonical address we'll
  // retry with on subsequent calls.
  await prisma.sharedSplitBuybackConfig.update({
    where: { id: configId },
    data: {
      pendingTokenAddress: tokenAddress,
      lastActivationAttemptAt: new Date(),
      activationAttempts: { increment: 1 },
      swapVenue,
      v4PoolHook: v4PoolHook,
      v4PairedToken: v4PairedToken,
      v4TickSpacing: v4TickSpacing,
      v4FeeFlag: v4FeeFlag,
    },
  });

  try {
    await assertHasCode(tokenAddress);
    const meta = await getTokenMeta(tokenAddress);

    const canDead = await canReceiveDead(tokenAddress);
    let burnMode: 'DEAD_ADDRESS' | 'TOKEN_BURN_FN';
    if (canDead) {
      burnMode = 'DEAD_ADDRESS';
    } else {
      const hasBurn = await detectBurnFunction(tokenAddress);
      if (!hasBurn) {
        throw new TokenSafetyError(
          'no_burn_function',
          `Token ${tokenAddress} blocks transfers to the dead address and exposes no burn() function — cannot be auto-burned`,
        );
      }
      burnMode = 'TOKEN_BURN_FN';
    }

    const allowedSwapInputTokens = [
      SPLIT_NATIVE_TOKEN_ADDRESS,
      ...SUPPORTED_TOKENS.map((t) => t.address as `0x${string}`),
    ];
    const { policyId } = await attachBuybackPolicy({
      subOrgId: config.turnkeySubOrgId,
      parentAdminUserId: config.parentAdminUserId,
      coSignerUserId: config.coSignerUserId,
      policyParams: {
        userTokenAddress: tokenAddress,
        allowedSwapInputTokens,
        recoveryAddress: config.recoveryAddress as `0x${string}`,
        swapVenue,
      },
    });

    const updated = await prisma.sharedSplitBuybackConfig.update({
      where: { id: configId },
      data: {
        tokenAddress,
        tokenSymbol: meta.symbol,
        tokenDecimals: meta.decimals,
        burnMode,
        policyId,
        status: 'ACTIVE',
        lastActivationError: null,
      },
    });

    return {
      ok: true,
      payload: {
        configId: updated.id,
        walletAddress: updated.walletAddress,
        tokenAddress: updated.tokenAddress,
        tokenSymbol: updated.tokenSymbol,
        burnMode: updated.burnMode,
        policyId: updated.policyId,
        swapVenue: updated.swapVenue,
      },
    };
  } catch (err: unknown) {
    const reason =
      err instanceof TokenSafetyError
        ? `[${err.reason}] ${err.message}`
        : err instanceof Error
          ? err.message
          : 'unknown_activation_error';

    // CRITICAL: store the error so the admin UI can show it. Never silent.
    await prisma.sharedSplitBuybackConfig.update({
      where: { id: configId },
      data: { lastActivationError: reason.slice(0, 1000) },
    });

    if (err instanceof TokenSafetyError) {
      return { ok: false, status: 400, error: reason };
    }
    return { ok: false, status: 500, error: reason };
  }
}

router.post('/activate-token-buyback', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as ActivateBody;
    if (!body.configId || typeof body.configId !== 'string') {
      return res.status(400).json({ error: 'configId is required' });
    }

    const result = await runActivation(body.configId, body);
    if (result.ok) {
      return res.json({ ok: true, ...result.payload });
    }
    return res.status(result.status).json({ error: result.error });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[internal/activate-token-buyback] error:', err);
    return res.status(500).json({ error: message });
  }
});

// Manual retry — same handler as the activate above, but accepts the
// already-stored pendingTokenAddress as an implicit default if tokenAddress
// isn't supplied. Used by the admin UI's "Retry activation" button.
router.post('/retry-token-buyback-activation', async (req: Request, res: Response) => {
  try {
    const { configId } = (req.body ?? {}) as { configId?: string };
    if (!configId || typeof configId !== 'string') {
      return res.status(400).json({ error: 'configId is required' });
    }

    const config = await prisma.sharedSplitBuybackConfig.findUnique({ where: { id: configId } });
    if (!config) return res.status(404).json({ error: `config ${configId} not found` });
    if (config.status === 'ACTIVE') {
      return res.json({ ok: true, alreadyActive: true, configId });
    }
    if (!config.pendingTokenAddress) {
      return res.status(400).json({
        error: 'No pendingTokenAddress on config — Phase 2 has never been attempted. Call activate-token-buyback with the tokenAddress first.',
      });
    }

    const body: ActivateBody = {
      configId,
      tokenAddress: config.pendingTokenAddress,
      swapVenue: (config.swapVenue as 'UNISWAP_V3' | 'UNISWAP_V4') ?? 'UNISWAP_V3',
      v4PoolHook: config.v4PoolHook ?? undefined,
      v4PairedToken: config.v4PairedToken ?? undefined,
      v4TickSpacing: config.v4TickSpacing ?? undefined,
      v4FeeFlag: config.v4FeeFlag ?? undefined,
    };
    const result = await runActivation(configId, body);
    if (result.ok) return res.json({ ok: true, ...result.payload });
    return res.status(result.status).json({ error: result.error });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[internal/retry-token-buyback-activation] error:', err);
    return res.status(500).json({ error: message });
  }
});

export default router;
