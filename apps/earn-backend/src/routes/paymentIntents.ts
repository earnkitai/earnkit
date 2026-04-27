import { Router, Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import { validateApiKey } from '../middleware/apiKeyAuth';
import { PaymentIntentService } from '../services/paymentIntentService';

const router: Router = Router();

router.post('/', validateApiKey, async (req: Request, res: Response) => {
  try {
    const {
      agentId,
      amountAtomic,
      chainId,
      amountInUSD,
      creditsToTopUp,
      customerWalletAddress,
      tokenAddress,
      tokenSymbol,
      externalReference,
      metadata,
      expiresAt,
    } = req.body;

    if (!agentId || typeof agentId !== 'string') {
      throw new AppError('agentId is required', 400);
    }

    if (!amountAtomic || typeof amountAtomic !== 'string') {
      throw new AppError('amountAtomic is required', 400);
    }

    if (!chainId || typeof chainId !== 'number') {
      throw new AppError('chainId is required', 400);
    }

    const paymentIntent = await PaymentIntentService.createPaymentIntent({
      agentId,
      userId: (req as any).user?.id,
      amountAtomic,
      chainId,
      amountInUSD,
      creditsToTopUp,
      customerWalletAddress,
      tokenAddress,
      tokenSymbol,
      externalReference,
      metadata,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    res.status(201).json({
      success: true,
      data: paymentIntent,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (error instanceof Error) {
      throw new AppError(error.message, 400);
    }

    throw error;
  }
});

router.get(
  '/:clientSecret',
  validateApiKey,
  async (req: Request, res: Response) => {
    try {
      const paymentIntent = await PaymentIntentService.getByClientSecret(
        req.params.clientSecret,
        (req as any).user?.id,
      );

      if (!paymentIntent) {
        throw new AppError('Payment intent not found', 404);
      }

      res.json({
        success: true,
        data: paymentIntent,
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof Error) {
        throw new AppError(error.message, 400);
      }

      throw error;
    }
  },
);

export default router;
