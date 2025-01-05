import express from 'express';
import authRoutes from './v1/auth.routes';

const router = express.Router();

router.use('/auth', authRoutes);

export default router;
