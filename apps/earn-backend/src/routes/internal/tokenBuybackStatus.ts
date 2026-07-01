import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { snapshotBuybackBalance } from '../../lib/buybackBalance';

/**
 * GET /api/internal/token-buyback-status?configId=...
 *
 * Returns the on-chain balance snapshot + recent execution history for a
 * per-token buyback config. Used by tokens.fun's admin page to show creators
 * what's accumulated in their Turnkey wallet and which burns have completed.
 *
 * Internal endpoint — protected by x-internal-secret. The tokens.fun admin
 * route enforces user-level access control before calling this.
 */
const router: Router = Router();

router.get('/token-buyback-status', async (req: Request, res: Response) => {
  try {
    const configId = req.query.configId;
    if (!configId || typeof configId !== 'string') {
      return res.status(400).json({ error: 'configId query param is required' });
    }

    const config = await prisma.sharedSplitBuybackConfig.findUnique({
      where: { id: configId },
      include: {
        executions: {
          orderBy: { startedAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!config) {
      return res.status(404).json({ error: 'config not found' });
    }

    let balance: { totalUsd: number; assets: unknown[] } = { totalUsd: 0, assets: [] };
    if (config.walletAddress) {
      try {
        const snapshot = await snapshotBuybackBalance(
          config.walletAddress as `0x${string}`,
          config.tokenAddress,
        );
        balance = { totalUsd: snapshot.totalUsd, assets: snapshot.assets };
      } catch (err) {
        console.warn(`[token-buyback-status] balance snapshot failed for ${configId}:`, err);
      }
    }

    // Sum lifetime tokens burned across completed executions for a quick at-a-glance number.
    const completed = config.executions.filter((e) => e.status === 'COMPLETED');
    const totalBurnedRaw = completed.reduce((acc, e) => {
      try {
        return acc + BigInt(e.tokensOutAmount ?? '0');
      } catch {
        return acc;
      }
    }, BigInt(0));
    const totalBurnedUsd = completed.reduce((acc, e) => acc + (e.tokensOutUsd ?? 0), 0);

    return res.json({
      ok: true,
      config: {
        id: config.id,
        status: config.status,
        walletAddress: config.walletAddress,
        tokenAddress: config.tokenAddress,
        tokenSymbol: config.tokenSymbol,
        tokenDecimals: config.tokenDecimals,
        thresholdUsd: config.thresholdUsd,
        burnMode: config.burnMode,
        isActive: config.isActive,
        lastCheckedAt: config.lastCheckedAt,
        lastTriggeredAt: config.lastTriggeredAt,
        createdAt: config.createdAt,
        // Activation telemetry — populated when Phase 2 has been attempted
        // (success or failure). Crystal-clear visibility into stuck configs.
        lastActivationError: config.lastActivationError,
        lastActivationAttemptAt: config.lastActivationAttemptAt,
        activationAttempts: config.activationAttempts,
        pendingTokenAddress: config.pendingTokenAddress,
        swapVenue: config.swapVenue,
      },
      balance,
      burns: {
        totalBurnedRaw: totalBurnedRaw.toString(),
        totalBurnedUsd,
        completedCount: completed.length,
      },
      executions: config.executions.map((e) => ({
        id: e.id,
        status: e.status,
        triggerBalanceUsd: e.triggerBalanceUsd,
        tokensOutAmount: e.tokensOutAmount,
        tokensOutUsd: e.tokensOutUsd,
        burnHash: e.burnHash,
        swapHash: e.swapHash,
        startedAt: e.startedAt,
        completedAt: e.completedAt,
        lastError: e.lastError,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[internal/token-buyback-status] error:', err);
    return res.status(500).json({ error: message });
  }
});

export default router;
