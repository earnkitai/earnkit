import { Router, Request, Response } from 'express';
import { EventService } from '../services/eventService';
import { BalanceService } from '../services/balanceService';
import { TopUpService } from '../services/topUpService';

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

export default router;
