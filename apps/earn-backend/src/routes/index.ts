import { Router, Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import trackRoutes from './track';
import captureRoutes from './capture';
import releaseRoutes from './release';
import balanceRoutes from './balance';
import topUpDetailsRoutes from './topUpDetails';
import tokenConfigRoutes from './tokenConfig';
import paymentIntentRoutes from './paymentIntents';
import debugRoutes from './debug';
import deploySplitRoutes from './internal/deploySplit';
import buybackWalletsRoutes from './internal/buybackWallets';
import provisionBuybackRoutes from './internal/provisionBuyback';
import provisionTokenBuybackRoutes from './internal/provisionTokenBuyback';
import tokenBuybackStatusRoutes from './internal/tokenBuybackStatus';
import agentBuybackStatusRoutes from './internal/agentBuybackStatus';
import activateBuybackRoutes from './internal/activateBuyback';
import splitInfoRoutes from './internal/splitInfo';
import buybackRoutes from './buyback';
import sharedBuybackRoutes from './sharedBuyback';
import giftCodesRoutes from './giftCodes';

const router: Router = Router();

// Public platform config
router.get('/config', (_req: Request, res: Response) => {
  const feeRateBps = parseInt(process.env.PLATFORM_FEE_BPS ?? '100', 10);
  const minThresholdUsd = parseFloat(process.env.PLATFORM_THRESHOLD_USD ?? '10');
  res.json({
    platformFeeRateBps: isNaN(feeRateBps) ? 100 : Math.min(Math.max(feeRateBps, 0), 2000),
    minThresholdUsd: isNaN(minThresholdUsd) || minThresholdUsd <= 0 ? 10 : minThresholdUsd,
  });
});

// API routes
router.use('/track', trackRoutes);
router.use('/capture', captureRoutes);
router.use('/release', releaseRoutes);
router.use('/balance', balanceRoutes);
router.use('/top-up-details', topUpDetailsRoutes);
router.use('/payment-intents', paymentIntentRoutes);
router.use('/agents/:agentId/token-config', tokenConfigRoutes);
router.use('/agents/:agentId/buyback', buybackRoutes);
router.use('/shared-buyback', sharedBuybackRoutes);
router.use('/gift-codes', giftCodesRoutes);

// Constant-time secret comparison — avoids a timing side-channel that a
// byte-by-byte `!==` leaks. Both sides are SHA-256'd first so lengths always
// match (timingSafeEqual requires equal-length buffers) and the header length
// isn't leaked either. Missing/empty secret fails closed.
function secretMatches(provided: unknown, expected: string | undefined): boolean {
  if (!expected || typeof provided !== 'string') return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// Debug routes — require ADMIN_API_KEY header regardless of environment
const adminAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!secretMatches(req.headers['x-admin-key'], process.env.ADMIN_API_KEY)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
};

router.use('/debug', adminAuth, debugRoutes);

// Internal routes — require INTERNAL_API_SECRET header; not exposed publicly
const internalAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!secretMatches(req.headers['x-internal-secret'], process.env.INTERNAL_API_SECRET)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
};

router.use('/internal/deploy-split', internalAuth, deploySplitRoutes);
router.use('/internal/split-info', internalAuth, splitInfoRoutes);
router.use('/internal/buyback-wallets', internalAuth, buybackWalletsRoutes);
router.use('/internal/provision-buyback', internalAuth, provisionBuybackRoutes);
router.use('/internal', internalAuth, provisionTokenBuybackRoutes);
router.use('/internal', internalAuth, tokenBuybackStatusRoutes);
router.use('/internal', internalAuth, agentBuybackStatusRoutes);
router.use('/internal', internalAuth, activateBuybackRoutes);

export default router;
