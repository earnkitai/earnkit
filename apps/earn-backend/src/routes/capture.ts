import { Router, Request, Response } from 'express';
import { EventService } from '../services/eventService';
import { validateEventId } from '../middleware/validation';
import { AppError } from '../middleware/errorHandler';

const router: Router = Router();
const eventService = new EventService();

/**
 * POST /api/capture
 * Capture a tracked event, finalizing the charge
 */
router.post('/', validateEventId, async (req: Request, res: Response) => {
  try {
    const { eventId } = req.body;

    const result = await eventService.capture({ eventId });

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
});

export default router;
