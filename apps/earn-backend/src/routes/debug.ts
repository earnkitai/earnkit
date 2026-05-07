import { Router, Request, Response } from 'express';
import { EventService } from '../services/eventService';
import { BalanceService } from '../services/balanceService';
import { TopUpService } from '../services/topUpService';
import { prisma } from '../lib/prisma';

const router: Router = Router();
const eventService = new EventService();
const balanceService = new BalanceService();
const topUpService = new TopUpService(balanceService);

/**
 * GET /api/debug/events
 * Get all tracked events (for debugging)
 */
router.get('/events', async (req: Request, res: Response) => {
  const events = await eventService.getAllEvents();
  res.json({
    success: true,
    data: events,
    count: events.length,
  });
});

/**
 * GET /api/debug/balances
 * Get all user balances (for debugging)
 */
router.get('/balances', async (req: Request, res: Response) => {
  const balances = await balanceService.getAllBalances();
  const balanceArray = Array.from(balances.entries()).map(
    ([wallet, balance]) => ({
      walletAddress: wallet,
      ...balance,
    }),
  );

  res.json({
    success: true,
    data: balanceArray,
    count: balanceArray.length,
  });
});

/**
 * GET /api/debug/transactions
 * Get all top-up transactions (for debugging)
 */
router.get('/transactions', async (req: Request, res: Response) => {
  const transactions = await topUpService.getAllTransactions();
  res.json({
    success: true,
    data: transactions,
    count: transactions.length,
  });
});

/**
 * GET /api/debug/status
 * Get overall system status
 */
router.get('/status', async (req: Request, res: Response) => {
  const events = await eventService.getAllEvents();
  const balances = await balanceService.getAllBalances();
  const transactions = await topUpService.getAllTransactions();

  res.json({
    success: true,
    data: {
      events: {
        total: events.length,
        pending: events.filter((e) => e.status === 'pending').length,
        captured: events.filter((e) => e.status === 'captured').length,
        released: events.filter((e) => e.status === 'released').length,
      },
      users: balances.size,
      transactions: {
        total: transactions.length,
        pending: transactions.filter((t) => t.status === 'pending').length,
        confirmed: transactions.filter((t) => t.status === 'confirmed').length,
        failed: transactions.filter((t) => t.status === 'failed').length,
      },
    },
  });
});

/**
 * GET /api/debug/buyback-executions
 * List recent buyback executions with their status (last 50).
 */
router.get('/buyback-executions', async (req: Request, res: Response) => {
  const executions = await prisma.buybackExecution.findMany({
    orderBy: { startedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      status: true,
      attempts: true,
      lastError: true,
      startedAt: true,
      completedAt: true,
      nextAttemptAt: true,
      swapHash: true,
      burnHash: true,
      buybackConfig: { select: { id: true, tokenSymbol: true, walletAddress: true } },
    },
  });
  res.json({ success: true, data: executions, count: executions.length });
});

/**
 * POST /api/debug/buyback-executions/:id/retry
 * Re-queue a FAILED buyback execution so the worker picks it up again.
 * Resets attempts to 0 so all retry attempts are available.
 */
router.post('/buyback-executions/:id/retry', async (req: Request, res: Response) => {
  const { id } = req.params;
  const execution = await prisma.buybackExecution.findUnique({ where: { id } });
  if (!execution) {
    res.status(404).json({ error: 'Execution not found' });
    return;
  }
  if (execution.status !== 'FAILED') {
    res.status(400).json({ error: `Execution is ${execution.status}, only FAILED executions can be retried` });
    return;
  }
  const updated = await prisma.buybackExecution.update({
    where: { id },
    data: {
      status: 'QUEUED',
      attempts: 0,
      lastError: null,
      completedAt: null,
      nextAttemptAt: null,
    },
  });
  res.json({ success: true, data: updated });
});

export default router;
