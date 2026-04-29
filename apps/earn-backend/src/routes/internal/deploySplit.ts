import { Router, Request, Response } from 'express';
import { deploySplitForAgent } from '../../services/splitService';

const router = Router();

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { developerWalletAddress, buybackAddress, buybackPercent } = req.body;

  if (!developerWalletAddress) {
    res.status(400).json({ error: 'developerWalletAddress is required' });
    return;
  }

  try {
    const result = await deploySplitForAgent({
      developerWalletAddress,
      buybackAddress,
      buybackPercent: buybackPercent !== undefined ? Number(buybackPercent) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[deploySplit] Error deploying split contract:', error);
    res.status(500).json({ error: error.message || 'Failed to deploy split' });
  }
});

export default router;
