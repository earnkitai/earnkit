import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';

/**
 * POST /api/internal/activate-shared-buyback/:id
 * POST /api/internal/activate-token-buyback/:id
 *
 * Force-activate a config that is stuck in PENDING state. Used when on-chain
 * ABI detection fails (e.g. push-split contracts where getSplit() reverts) but
 * the owner has confirmed the wallet has been added / fee recipient set.
 *
 * Protected by INTERNAL_API_SECRET — not publicly accessible.
 */
const router: Router = Router();

router.post('/activate-shared-buyback/:id', async (req: Request, res: Response) => {
  try {
    const config = await prisma.sharedSplitBuybackConfig.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, isActive: true, walletAddress: true },
    });

    if (!config) return res.status(404).json({ error: 'Not found' });
    if (!config.isActive) return res.status(400).json({ error: 'Config is disabled' });
    if (config.status === 'ACTIVE') return res.json({ ok: true, message: 'Already active' });

    await prisma.sharedSplitBuybackConfig.update({
      where: { id: config.id },
      data:  { status: 'ACTIVE' },
    });

    return res.json({ ok: true, configId: config.id, walletAddress: config.walletAddress });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: message });
  }
});

router.post('/activate-token-buyback/:id', async (req: Request, res: Response) => {
  try {
    const config = await prisma.tokenContractBuybackConfig.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, isActive: true, walletAddress: true },
    });

    if (!config) return res.status(404).json({ error: 'Not found' });
    if (!config.isActive) return res.status(400).json({ error: 'Config is disabled' });
    if (config.status === 'ACTIVE') return res.json({ ok: true, message: 'Already active' });

    await prisma.tokenContractBuybackConfig.update({
      where: { id: config.id },
      data:  { status: 'ACTIVE' },
    });

    return res.json({ ok: true, configId: config.id, walletAddress: config.walletAddress });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: message });
  }
});

export default router;
