import { Router, Request, Response, NextFunction } from 'express';
import trackRoutes from './track';
import captureRoutes from './capture';
import releaseRoutes from './release';
import balanceRoutes from './balance';
import topUpDetailsRoutes from './topUpDetails';
import tokenConfigRoutes from './tokenConfig';
import paymentIntentRoutes from './paymentIntents';
import webhookRoutes from './webhooks';
import debugRoutes from './debug';
import deploySplitRoutes from './internal/deploySplit';
import buybackRoutes from './buyback';

const router: Router = Router();

// API routes
router.use('/track', trackRoutes);
router.use('/capture', captureRoutes);
router.use('/release', releaseRoutes);
router.use('/balance', balanceRoutes);
router.use('/top-up-details', topUpDetailsRoutes);
router.use('/payment-intents', paymentIntentRoutes);
router.use('/agents/:agentId/token-config', tokenConfigRoutes);
router.use('/agents/:agentId/buyback', buybackRoutes);
router.use('/webhooks', webhookRoutes);

// Debug routes — require ADMIN_API_KEY header regardless of environment
const adminAuth = (req: Request, res: Response, next: NextFunction): void => {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey || req.headers['x-admin-key'] !== adminKey) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
};

router.use('/debug', adminAuth, debugRoutes);

// Internal routes — require INTERNAL_API_SECRET header; not exposed publicly
const internalAuth = (req: Request, res: Response, next: NextFunction): void => {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret || req.headers['x-internal-secret'] !== secret) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
};

router.use('/internal/deploy-split', internalAuth, deploySplitRoutes);

export default router;
