import express from 'express';
import authRoutes from './v1/auth.routes';
import sdkRoutes from './v1/sdk.routes';
import webRoutes from './v1/web.routes';
import validateApiKey from '../middleware/validateApiKey';

const router = express.Router();

// Public auth routes (no authentication)
router.use('/auth', authRoutes);

// SDK routes (API key authentication)
router.use('/sdk', validateApiKey, sdkRoutes);

// Web routes (JWT authentication)
router.use('/web', webRoutes);

export default router;
