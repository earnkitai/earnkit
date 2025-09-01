import { Router, Request, Response } from 'express';
import { BalanceService } from '../services/balanceService';
import { AppError } from '../middleware/errorHandler';

const router: Router = Router();
const balanceService = new BalanceService();

/**
 * GET /api/balance
 * Get user balance by wallet address and agent ID
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { walletAddress, agentId } = req.query;

    if (!walletAddress || typeof walletAddress !== 'string') {
      throw new AppError('walletAddress query parameter is required', 400);
    }

    if (!agentId || typeof agentId !== 'string') {
      throw new AppError('agentId query parameter is required', 400);
    }

    if (!walletAddress.startsWith('0x')) {
      throw new AppError('walletAddress must start with 0x', 400);
    }

    const balance = await balanceService.getBalance(walletAddress, agentId);

    res.json(balance);
  } catch (error) {
    if (error instanceof Error) {
      throw new AppError(error.message, 400);
    }
    throw error;
  }
});

export default router;
