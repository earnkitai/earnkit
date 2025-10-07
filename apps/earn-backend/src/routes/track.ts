import { Router, Request, Response } from 'express';
import { EventService } from '../services/eventService';
import {
  validateWalletAddress,
  validateAgentId,
} from '../middleware/validation';
import { validateApiKey } from '../middleware/apiKeyAuth';
import { AppError } from '../middleware/errorHandler';

const router: Router = Router();
const eventService = new EventService();

/**
 * POST /api/track
 * Track a new event and provisionally deduct credits
 */
router.post(
  '/',
  validateApiKey,
  validateAgentId,
  validateWalletAddress,
  async (req: Request, res: Response) => {
    try {
      const { agentId, walletAddress, idempotencyKey, creditsToDeduct } =
        req.body;

      const result = await eventService.track({
        agentId,
        walletAddress,
        idempotencyKey,
        creditsToDeduct,
      });

      res.json({
        data: {
          eventId: result.eventId,
          insufficientCredits: result.insufficientCredits,
          creditsRequired: result.creditsRequired,
          creditsAvailable: result.creditsAvailable,
        },
        success: true,
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new AppError(error.message, 400);
      }
      throw error;
    }
  },
);

export default router;
