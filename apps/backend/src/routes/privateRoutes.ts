import express from 'express';
import walletRoutes from './v1/wallet.routes';
import configRoutes from './v1/config.routes';
import userRoutes from './v1/user.routes';
import transactionRoutes from './v1/transaction.routes';
import validateApiKey from '../middleware/validateApiKey';

const router = express.Router();

router.use(validateApiKey);

router.use('/wallet', walletRoutes);
router.use('/config', configRoutes);
router.use('/user', userRoutes);
router.use('/transaction', transactionRoutes);

export default router;
