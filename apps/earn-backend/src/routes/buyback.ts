import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { snapshotBuybackBalance } from '../lib/buybackBalance';

const router: Router = Router({ mergeParams: true });

function getMinThresholdUsd(): number {
  const raw = process.env.BUYBACK_MIN_THRESHOLD_USD;
  if (!raw) return 10;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 10;
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
      return res.json({
        buybackConfig: null,
        minThresholdUsd: getMinThresholdUsd(),
      });
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
      minThresholdUsd: getMinThresholdUsd(),
    });
  } catch (err: any) {
    console.error('[buyback] GET error:', err);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// GET /api/agents/:agentId/buyback/status — live accumulated balance vs threshold.
// Used by the dashboard panel to show the user "$X.XX of $Y.YY accumulated"
// without waiting for the 5-minute scanner cycle.
router.get('/status', async (req: Request, res: Response) => {
  try {
    const agent = await findAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const config = agent.buybackConfig;
    if (!config) {
      return res.json({
        configured: false,
        accumulatedUsd: 0,
        thresholdUsd: 0,
        progress: 0,
        minThresholdUsd: getMinThresholdUsd(),
      });
    }

    const snapshot = await snapshotBuybackBalance(
      config.walletAddress as `0x${string}`,
      config.tokenAddress,
    );

    const inFlight = await prisma.buybackExecution.findFirst({
      where: {
        buybackConfigId: config.id,
        status: { in: ['QUEUED', 'WITHDRAWING', 'SWAPPING', 'BURNING', 'RETRYING'] },
      },
      select: { id: true, status: true },
    });

    const progress =
      config.thresholdUsd > 0
        ? Math.min(snapshot.totalUsd / config.thresholdUsd, 1)
        : 0;

    return res.json({
      configured: true,
      isActive: config.isActive,
      accumulatedUsd: snapshot.totalUsd,
      thresholdUsd: config.thresholdUsd,
      progress, // 0..1
      readyToFire: snapshot.totalUsd >= config.thresholdUsd,
      assets: snapshot.assets,
      walletAddress: config.walletAddress,
      lastCheckedAt: config.lastCheckedAt,
      lastTriggeredAt: config.lastTriggeredAt,
      inFlightExecution: inFlight ?? null,
      minThresholdUsd: getMinThresholdUsd(),
    });
  } catch (err: any) {
    console.error('[buyback] status error:', err);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// POST /api/agents/:agentId/buyback — UPDATE existing config only.
//
// First-time enable used to live here, but the on-chain Splits contract bakes
// the buyback recipient at deploy time and is immutable. So enabling Auto
// Buyback after agent creation silently misrouted funds to a different address
// than the Turnkey wallet. The only correct ordering is:
//   1. Provision Turnkey wallet (during agent creation)
//   2. Deploy Splits with that Turnkey address as the buyback recipient
// That happens in the dashboard's POST /api/agents flow now. This endpoint is
// only for editing thresholdUsd / slippageBps / burnMode of an existing config.
//
// Body: { thresholdUsd?, slippageBps?, burnMode? }
router.post('/', async (req: Request, res: Response) => {
  try {
    const agent = await findAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    if (!agent.buybackConfig) {
      return res.status(400).json({
        error:
          'Auto Buyback can only be configured during agent creation. Create a new agent and select Auto Buyback at that step.',
      });
    }

    const { thresholdUsd, slippageBps, burnMode: requestedBurnMode } = req.body ?? {};

    const minThreshold = getMinThresholdUsd();
    if (
      thresholdUsd !== undefined &&
      (typeof thresholdUsd !== 'number' ||
        !Number.isFinite(thresholdUsd) ||
        thresholdUsd < minThreshold)
    ) {
      return res.status(400).json({
        error: `thresholdUsd must be a number >= ${minThreshold}. Below this, on-chain gas eats most of the buyback value. (Operator can lower this floor via BUYBACK_MIN_THRESHOLD_USD for testing.)`,
      });
    }
    if (
      slippageBps !== undefined &&
      (typeof slippageBps !== 'number' || slippageBps < 100 || slippageBps > 2000)
    ) {
      return res.status(400).json({ error: 'slippageBps must be between 100 and 2000' });
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[buyback] POST error:', err);
    return res.status(500).json({ error: message });
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

// GET /api/agents/:agentId/buyback/executions — recent execution history with
// per-step tx hashes and error reasons. Used by the dashboard's history panel
// so users can see what happened without needing DB access.
router.get('/executions', async (req: Request, res: Response) => {
  try {
    const agent = await findAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const config = agent.buybackConfig;
    if (!config) return res.json({ executions: [] });

    const rows = await prisma.buybackExecution.findMany({
      where: { buybackConfigId: config.id },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });

    return res.json({
      executions: rows.map((r) => ({
        id: r.id,
        status: r.status,
        triggerBalanceUsd: r.triggerBalanceUsd,
        attempts: r.attempts,
        lastError: r.lastError,
        warehouseWithdrawHashes: r.warehouseWithdrawHashes,
        swapHash: r.swapHash,
        burnHash: r.burnHash,
        tokensOutAmount: r.tokensOutAmount,
        gasSpentEth: r.gasSpentEth,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        nextAttemptAt: r.nextAttemptAt,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[buyback] executions error:', err);
    return res.status(500).json({ error: message });
  }
});

// POST /api/agents/:agentId/buyback/check
//
// Event-driven trigger fired by the dashboard right after a successful Split
// distribute. Reads the buyback wallet's accumulated balance once and queues a
// BuybackExecution if the threshold is crossed. No background polling — funds
// only get re-evaluated on the next distribute (or via this endpoint manually).
router.post('/check', async (req: Request, res: Response) => {
  try {
    const agent = await findAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const config = agent.buybackConfig;
    if (!config || !config.isActive) {
      return res.json({ queued: false, reason: 'no_active_config' });
    }

    const inFlight = await prisma.buybackExecution.findFirst({
      where: {
        buybackConfigId: config.id,
        status: { in: ['QUEUED', 'WITHDRAWING', 'SWAPPING', 'BURNING', 'RETRYING'] },
      },
      select: { id: true, status: true },
    });
    if (inFlight) {
      return res.json({ queued: false, reason: 'in_flight', execution: inFlight });
    }

    const snapshot = await snapshotBuybackBalance(
      config.walletAddress as `0x${string}`,
      config.tokenAddress,
    );

    await prisma.buybackConfig.update({
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

    const execution = await prisma.buybackExecution.create({
      data: {
        buybackConfigId: config.id,
        status: 'QUEUED',
        triggerBalanceUsd: snapshot.totalUsd,
        assetsIn: snapshot.assets as any,
      },
    });

    return res.json({
      queued: true,
      executionId: execution.id,
      accumulatedUsd: snapshot.totalUsd,
      thresholdUsd: config.thresholdUsd,
    });
  } catch (err: any) {
    // Lost the race to the one-in-flight-per-config unique index — another
    // /check queued an execution concurrently. Treat as in-flight, not a 500.
    if (err?.code === 'P2002') {
      return res.json({ queued: false, reason: 'in_flight' });
    }
    console.error('[buyback] check error:', err);
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
    // A buyback/recovery is already in flight for this config (unique index).
    if (err?.code === 'P2002') {
      return res.status(409).json({ ok: false, reason: 'in_flight' });
    }
    console.error('[buyback] recover error:', err);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

export default router;
