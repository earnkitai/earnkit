import { Router, Request, Response } from 'express';
import { getAddress, isAddress } from 'viem';
import { prisma } from '../lib/prisma';
import { createBuybackSubOrg } from '../services/turnkeyService';
import {
  assertHasCode,
  assertNotHoneypot,
  canReceiveDead,
  detectBurnFunction,
  getTokenMeta,
  TokenSafetyError,
} from '../lib/tokenSafety';
import { snapshotBuybackBalance } from '../lib/buybackBalance';
import { SUPPORTED_TOKENS } from '../services/tokenService';
import { SPLIT_NATIVE_TOKEN_ADDRESS } from '../lib/splitsWarehouse';

const router: Router = Router();

function getTreasuryAddress(): `0x${string}` | undefined {
  const addr = process.env.BUYBACK_TREASURY_ADDRESS;
  if (!addr || !isAddress(addr)) return undefined;
  return getAddress(addr) as `0x${string}`;
}

/**
 * POST /api/shared-buyback/register
 *
 * Register a pre-existing 0xSplits contract for automated buyback. Provisions
 * a Turnkey sub-org wallet (the buyback executor) which the caller then adds
 * as a recipient to their existing split. Once added, the worker detects it
 * automatically and begins executing buyback on each distribution.
 *
 * Body:
 *   ownerAddress    — user's Safe or EOA (for reference only; not enforced on-chain here)
 *   splitAddress    — the existing 0xSplits V2 pull-split contract
 *   targetToken     — ERC-20 to buy back & burn
 *   recoveryAddress — EOA for emergency fund sweep
 *   userEmail       — becomes the Turnkey sub-org root authenticator
 *   feeRateBps      — optional, default 500 (5%)
 *   thresholdUsd    — optional, default 10
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const {
      ownerAddress: rawOwner,
      splitAddress: rawSplit,
      targetToken: rawToken,
      recoveryAddress: rawRecovery,
      userEmail,
      feeRateBps,
      thresholdUsd,
    } = req.body ?? {};

    if (!rawOwner || !isAddress(rawOwner)) {
      return res.status(400).json({ error: 'ownerAddress must be a valid 0x address' });
    }
    if (!rawSplit || !isAddress(rawSplit)) {
      return res.status(400).json({ error: 'splitAddress must be a valid 0x address' });
    }
    if (!rawToken || !isAddress(rawToken)) {
      return res.status(400).json({ error: 'targetToken must be a valid 0x address' });
    }
    if (!rawRecovery || !isAddress(rawRecovery)) {
      return res.status(400).json({ error: 'recoveryAddress must be a valid 0x address' });
    }
    if (!userEmail || typeof userEmail !== 'string') {
      return res.status(400).json({ error: 'userEmail is required' });
    }

    const ownerAddress = getAddress(rawOwner) as `0x${string}`;
    const splitAddress = getAddress(rawSplit) as `0x${string}`;
    const tokenAddress = getAddress(rawToken) as `0x${string}`;
    const recoveryAddress = getAddress(rawRecovery) as `0x${string}`;
    const resolvedFeeRateBps = typeof feeRateBps === 'number' ? Math.min(Math.max(feeRateBps, 0), 2000) : 500;
    const resolvedThresholdUsd = typeof thresholdUsd === 'number' ? thresholdUsd : 10;

    // Token safety checks — same as agent buyback
    await assertHasCode(tokenAddress);
    const meta = await getTokenMeta(tokenAddress);
    await assertNotHoneypot(tokenAddress);

    const canDead = await canReceiveDead(tokenAddress);
    let burnMode: 'DEAD_ADDRESS' | 'TOKEN_BURN_FN';
    if (canDead) {
      burnMode = 'DEAD_ADDRESS';
    } else {
      const hasBurn = await detectBurnFunction(tokenAddress);
      if (!hasBurn) {
        throw new TokenSafetyError(
          'no_burn_function',
          `Token ${tokenAddress} blocks transfers to the dead address and exposes no burn() function`,
        );
      }
      burnMode = 'TOKEN_BURN_FN';
    }

    // Create a placeholder config first so we have a cuid for the sub-org name
    const config = await prisma.sharedSplitBuybackConfig.create({
      data: {
        ownerAddress,
        splitAddress,
        tokenAddress,
        tokenSymbol: meta.symbol,
        tokenDecimals: meta.decimals,
        recoveryAddress,
        feeRateBps: resolvedFeeRateBps,
        thresholdUsd: resolvedThresholdUsd,
        burnMode,
        status: 'PROVISIONING',
      },
    });

    const allowedSwapInputTokens = [
      SPLIT_NATIVE_TOKEN_ADDRESS,
      ...SUPPORTED_TOKENS.map((t) => t.address as `0x${string}`),
    ];

    let subOrg;
    try {
      subOrg = await createBuybackSubOrg({
        agentId: `shared-${config.id.slice(0, 8)}`,
        userEmail,
        policyParams: {
          userTokenAddress: tokenAddress,
          allowedSwapInputTokens,
          recoveryAddress,
          treasuryAddress: getTreasuryAddress(),
        },
      });
    } catch (provisionErr: unknown) {
      // Delete the orphaned record so the user can retry cleanly
      await prisma.sharedSplitBuybackConfig.delete({ where: { id: config.id } }).catch(() => {});
      throw provisionErr;
    }

    const updated = await prisma.sharedSplitBuybackConfig.update({
      where: { id: config.id },
      data: {
        turnkeySubOrgId: subOrg.subOrgId,
        turnkeyWalletId: subOrg.walletId,
        walletAddress: subOrg.walletAddress,
        policyId: subOrg.policyId,
        status: 'PENDING_SPLIT_UPDATE',
      },
    });

    return res.status(201).json({
      ok: true,
      configId: updated.id,
      walletAddress: subOrg.walletAddress,
      status: updated.status,
      instructions: `Add ${subOrg.walletAddress} as a recipient to your split at ${splitAddress}. Once added, buyback will activate automatically.`,
    });
  } catch (err: unknown) {
    if (err instanceof TokenSafetyError) {
      return res.status(400).json({ error: err.message, reason: err.reason });
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[shared-buyback/register] error:', err);
    return res.status(500).json({ error: message });
  }
});

/**
 * GET /api/shared-buyback/:id
 * Returns config status + live balance snapshot.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const config = await prisma.sharedSplitBuybackConfig.findUnique({
      where: { id: req.params.id },
    });
    if (!config) return res.status(404).json({ error: 'Not found' });

    let balanceSnapshot = null;
    if (config.walletAddress && config.status === 'ACTIVE') {
      try {
        balanceSnapshot = await snapshotBuybackBalance(config.walletAddress as `0x${string}`);
      } catch {
        // non-fatal — balance is best-effort
      }
    }

    const inFlight = await prisma.sharedSplitExecution.findFirst({
      where: { configId: config.id, status: { in: ['QUEUED', 'WITHDRAWING', 'SWAPPING', 'BURNING', 'RETRYING'] } },
      select: { id: true, status: true },
    });

    return res.json({
      id: config.id,
      ownerAddress: config.ownerAddress,
      splitAddress: config.splitAddress,
      walletAddress: config.walletAddress,
      tokenAddress: config.tokenAddress,
      tokenSymbol: config.tokenSymbol,
      tokenDecimals: config.tokenDecimals,
      status: config.status,
      isActive: config.isActive,
      feeRateBps: config.feeRateBps,
      thresholdUsd: config.thresholdUsd,
      accumulatedUsd: balanceSnapshot?.totalUsd ?? null,
      assets: balanceSnapshot?.assets ?? null,
      lastCheckedAt: config.lastCheckedAt,
      lastTriggeredAt: config.lastTriggeredAt,
      inFlightExecution: inFlight ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[shared-buyback/:id] error:', err);
    return res.status(500).json({ error: message });
  }
});

/**
 * POST /api/shared-buyback/:id/check
 * Manually trigger a balance check and queue an execution if threshold is met.
 */
router.post('/:id/check', async (req: Request, res: Response) => {
  try {
    const config = await prisma.sharedSplitBuybackConfig.findUnique({
      where: { id: req.params.id },
    });
    if (!config) return res.status(404).json({ error: 'Not found' });
    if (!config.isActive) {
      return res.status(400).json({ error: 'Config is disabled' });
    }
    if (config.status === 'PENDING_SPLIT_UPDATE') {
      return res.status(400).json({
        error: 'Waiting for split update — add the buyback wallet as a recipient to your split first',
        walletAddress: config.walletAddress,
      });
    }
    if (config.status !== 'ACTIVE') {
      return res.status(400).json({ error: `Config is not active (status: ${config.status})` });
    }
    if (!config.walletAddress) {
      return res.status(400).json({ error: 'Wallet not yet provisioned' });
    }

    const snapshot = await snapshotBuybackBalance(config.walletAddress as `0x${string}`);

    await prisma.sharedSplitBuybackConfig.update({
      where: { id: config.id },
      data: { lastCheckedAt: new Date() },
    });

    if (snapshot.totalUsd < config.thresholdUsd) {
      return res.json({
        queued: false,
        reason: 'below_threshold',
        accumulatedUsd: snapshot.totalUsd,
        thresholdUsd: config.thresholdUsd,
      });
    }

    const existing = await prisma.sharedSplitExecution.findFirst({
      where: { configId: config.id, status: { in: ['QUEUED', 'WITHDRAWING', 'SWAPPING', 'BURNING', 'RETRYING'] } },
    });
    if (existing) {
      return res.json({ queued: false, reason: 'execution_in_flight', executionId: existing.id });
    }

    const execution = await prisma.sharedSplitExecution.create({
      data: {
        configId: config.id,
        triggerBalanceUsd: snapshot.totalUsd,
        assetsIn: snapshot.assets as any,
      },
    });

    return res.json({ queued: true, executionId: execution.id, triggerBalanceUsd: snapshot.totalUsd });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[shared-buyback/:id/check] error:', err);
    return res.status(500).json({ error: message });
  }
});

/**
 * DELETE /api/shared-buyback/:id
 * Disable a config. Does not destroy the Turnkey sub-org.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const config = await prisma.sharedSplitBuybackConfig.findUnique({
      where: { id: req.params.id },
    });
    if (!config) return res.status(404).json({ error: 'Not found' });

    await prisma.sharedSplitBuybackConfig.update({
      where: { id: config.id },
      data: { isActive: false, status: 'PAUSED' },
    });

    return res.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: message });
  }
});

/**
 * GET /api/shared-buyback/:id/executions
 * Last 20 executions.
 */
router.get('/:id/executions', async (req: Request, res: Response) => {
  try {
    const executions = await prisma.sharedSplitExecution.findMany({
      where: { configId: req.params.id },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    return res.json({ executions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: message });
  }
});

export default router;
