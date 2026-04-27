import { Router, Request, Response } from 'express';
import { TopUpService } from '../services/topUpService';
import { BalanceService } from '../services/balanceService';
import {
  validateAgentId,
  validateWalletAddress,
  validateTransactionHash,
  validateAmount,
} from '../middleware/validation';
import { validateApiKey } from '../middleware/apiKeyAuth';
import { AppError } from '../middleware/errorHandler';

const router: Router = Router();
const balanceService = new BalanceService();
const topUpService = new TopUpService(balanceService);

/**
 * GET /api/top-up-details
 * Get top-up options for an agent
 */
router.get('/', validateApiKey, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.query;

    if (!agentId || typeof agentId !== 'string') {
      throw new AppError('agentId query parameter is required', 400);
    }

    const result = await topUpService.getTopUpDetails(
      agentId,
      (req as any).user?.id,
    );

    res.json(result);
  } catch (error) {
    if (error instanceof Error) {
      throw new AppError(error.message, 400);
    }
    throw error;
  }
});

/**
 * POST /api/top-up-details
 * Submit a top-up transaction for monitoring
 */
router.post(
  '/',
  validateApiKey,
  validateAgentId,
  validateWalletAddress,
  validateTransactionHash,
  validateAmount,
  async (req: Request, res: Response) => {
    try {
      const {
        agentId,
        walletAddress,
        txHash,
        amountInUSD,
        amountInEth,
        creditsToTopUp,
        tokenAddress,
        tokenSymbol,
        amountInToken,
      } = req.body;

      const result = await topUpService.submitTopUpTransaction({
        agentId,
        walletAddress,
        txHash,
        amountInUSD,
        amountInEth,
        creditsToTopUp,
        tokenAddress,
        tokenSymbol,
        amountInToken,
        userId: (req as any).user?.id,
      });

      res.json(result);
    } catch (error) {
      if (error instanceof Error) {
        throw new AppError(error.message, 400);
      }
      throw error;
    }
  },
);

export default router;
