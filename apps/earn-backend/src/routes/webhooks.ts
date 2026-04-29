import { Router, Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import { validateApiKey } from '../middleware/apiKeyAuth';
import { WebhookService } from '../services/webhookService';

const router: Router = Router();

// POST /api/webhooks — register a webhook endpoint for an agent
router.post('/', validateApiKey, async (req: Request, res: Response) => {
  try {
    const { agentId, url, events } = req.body;

    if (!agentId || typeof agentId !== 'string') {
      throw new AppError('agentId is required', 400);
    }
    if (!url || typeof url !== 'string') {
      throw new AppError('url is required', 400);
    }

    const endpoint = await WebhookService.registerEndpoint({
      agentId,
      userId: (req as any).user?.id,
      url,
      events: Array.isArray(events) ? events : undefined,
    });

    res.status(201).json({ success: true, data: endpoint });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error) throw new AppError(error.message, 400);
    throw error;
  }
});

// GET /api/webhooks?agentId=xxx — list endpoints for an agent
router.get('/', validateApiKey, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.query;
    if (!agentId || typeof agentId !== 'string') {
      throw new AppError('agentId is required', 400);
    }

    const userId = (req as any).user?.id;
    if (!userId) throw new AppError('Authentication required', 401);

    const { prisma } = await import('../lib/prisma');
    const agent = await prisma.agent.findFirst({
      where: { agentId, userId },
      select: { id: true },
    });
    if (!agent) throw new AppError('Agent not found', 404);

    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { agentId: agent.id },
      select: {
        id: true,
        url: true,
        events: true,
        enabled: true,
        createdAt: true,
        // secret intentionally omitted from list response
      },
    });

    res.json({ success: true, data: endpoints });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error) throw new AppError(error.message, 400);
    throw error;
  }
});

// DELETE /api/webhooks/:id — remove a webhook endpoint
router.delete('/:id', validateApiKey, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) throw new AppError('Authentication required', 401);

    const { prisma } = await import('../lib/prisma');
    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { id: req.params.id, agent: { userId } },
    });
    if (!endpoint) throw new AppError('Webhook endpoint not found', 404);

    await prisma.webhookEndpoint.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error) throw new AppError(error.message, 400);
    throw error;
  }
});

export default router;
