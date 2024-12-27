import express from 'express';
import {
  registerUser,
  createApiKey,
} from '../controllers/public/auth.controller';
import { createFarcasterAccount } from '../controllers/farcaster.controller';

const router = express.Router();

router.post('/auth/register', registerUser);
router.post('/auth/create-api-key', createApiKey);
router.post('/farcaster/account', createFarcasterAccount);

export default router;
