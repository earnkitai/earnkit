import { Router, Request, Response } from 'express';
import { BalanceService } from '../services/balanceService';
import { validateApiKey } from '../middleware/apiKeyAuth';
import { AppError } from '../middleware/errorHandler';
import { requireWalletAddress } from '../lib/wallet';

const router: Router = Router();
const balanceService = new BalanceService();

/**
 * GET /api/balance
 * Get user balance by wallet address and agent ID
 */
router.get('/', validateApiKey, async (req: Request, res: Response) => {
  try {
    const { walletAddress, agentId } = req.query;

    if (!agentId || typeof agentId !== 'string') {
      throw new AppError('agentId query parameter is required', 400);
    }

    const normalizedWallet = requireWalletAddress(walletAddress, 'walletAddress');

    const balance = await balanceService.getBalance(
      normalizedWallet,
      agentId,
      (req as any).user?.id,
    );

    res.set('Cache-Control', 'no-store');
    res.json(balance);
  } catch (error) {
    if (error instanceof Error) {
      throw new AppError(error.message, 400);
    }
    throw error;
  }
});

export default router;
