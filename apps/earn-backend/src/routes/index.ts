import { Router } from 'express';
import trackRoutes from './track';
import captureRoutes from './capture';
import releaseRoutes from './release';
import balanceRoutes from './balance';
import topUpDetailsRoutes from './topUpDetails';
import debugRoutes from './debug';

const router: Router = Router();

// API routes
router.use('/track', trackRoutes);
router.use('/capture', captureRoutes);
router.use('/release', releaseRoutes);
router.use('/balance', balanceRoutes);
router.use('/top-up-details', topUpDetailsRoutes);

// Debug routes (only in development)
if (process.env.NODE_ENV === 'development') {
  router.use('/debug', debugRoutes);
}

export default router;
