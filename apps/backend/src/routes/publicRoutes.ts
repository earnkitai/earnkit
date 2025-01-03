import express from 'express';
import {
  registerUser,
  createApiKey,
  CheckUserExists,
} from '../controllers/public/auth.controller';
import { GetUserApiKeys } from '../controllers/private/turnkey.controller';

const router = express.Router();

router.post('/auth/register', registerUser);
router.post('/auth/create-api-key', createApiKey);
router.get('/check-user', CheckUserExists);
router.get('/api-keys', GetUserApiKeys);

export default router;
