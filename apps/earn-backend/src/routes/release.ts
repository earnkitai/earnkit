import { Router, Request, Response } from 'express';
import { EventService } from '../services/eventService';
import { validateEventId } from '../middleware/validation';
import { validateApiKey } from '../middleware/apiKeyAuth';
import { AppError } from '../middleware/errorHandler';

const router: Router = Router();
const eventService = new EventService();

/**
 * POST /api/release
 * Release a tracked event, refunding provisionally held credits
 */
router.post(
  '/',
  validateApiKey,
  validateEventId,
  async (req: Request, res: Response) => {
    try {
      const { eventId } = req.body;
      const userId = (req as any).user?.id;

      const result = await eventService.release({ eventId, userId });

      res.json({
        success: result.success,
        eventId,
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
