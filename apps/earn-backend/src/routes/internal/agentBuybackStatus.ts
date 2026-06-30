import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { snapshotBuybackBalance } from '../../lib/buybackBalance';

/**
 * GET /api/internal/agent-buyback-status?agentId=...
 *
 * Returns the buyback config, live on-chain balance snapshot, lifetime burn
 * aggregates, and recent execution history for a per-agent buyback (the
 * dashboard agent-page flow: Agent -> BuybackConfig -> BuybackExecution).
 *
 * Used by data.tokens.fun to render a single agent's buyback stats. The
 * `agentId` param accepts either the internal UUID or the external agent slug,
 * matching the resolution in routes/buyback.ts:findAgent().
 *
 * Internal endpoint — protected by x-internal-secret. The data.tokens.fun
 * route enforces any user-level access control before calling this.
 */
const router: Router = Router();

router.get('/agent-buyback-status', async (req: Request, res: Response) => {
  try {
    const agentId = req.query.agentId;
    if (!agentId || typeof agentId !== 'string') {
      return res.status(400).json({ error: 'agentId query param is required' });
    }

    // Same fallback pattern as routes/buyback.ts:findAgent — try UUID, then slug.
    let agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { buybackConfig: true },
    });
    if (!agent) {
      agent = await prisma.agent.findUnique({
        where: { agentId },
        include: { buybackConfig: true },
      });
    }

    if (!agent) {
      return res.status(404).json({ error: 'agent not found' });
    }

    const config = agent.buybackConfig;
    if (!config) {
      return res.status(404).json({ error: 'buyback not configured for this agent' });
    }

    const executions = await prisma.buybackExecution.findMany({
      where: { buybackConfigId: config.id },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });

    let balance: { totalUsd: number; assets: unknown[] } = { totalUsd: 0, assets: [] };
    if (config.walletAddress) {
      try {
        const snapshot = await snapshotBuybackBalance(
          config.walletAddress as `0x${string}`,
        );
        balance = { totalUsd: snapshot.totalUsd, assets: snapshot.assets };
      } catch (err) {
        console.warn(`[agent-buyback-status] balance snapshot failed for ${agentId}:`, err);
      }
    }

    // Lifetime aggregates across completed executions for at-a-glance headline cards.
    const completed = executions.filter((e) => e.status === 'COMPLETED');
    const totalBurnedRaw = completed.reduce((acc, e) => {
      try {
        return acc + BigInt(e.tokensOutAmount ?? '0');
      } catch {
        return acc;
      }
    }, BigInt(0));
    const totalBurnedUsd = completed.reduce((acc, e) => acc + (e.tokensOutUsd ?? 0), 0);
    const totalVolumeUsd = completed.reduce((acc, e) => acc + (e.triggerBalanceUsd ?? 0), 0);

    return res.json({
      ok: true,
      agent: {
        id: agent.id,
        agentId: agent.agentId,
        name: agent.name,
      },
      config: {
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
        createdAt: config.createdAt,
      },
      balance,
      burns: {
        totalBurnedRaw: totalBurnedRaw.toString(),
        totalBurnedUsd,
        totalVolumeUsd,
        completedCount: completed.length,
      },
      executions: executions.map((e) => ({
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
    console.error('[internal/agent-buyback-status] error:', err);
    return res.status(500).json({ error: message });
  }
});

export default router;
