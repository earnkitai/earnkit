import express from 'express';
import * as registerController from '../../controllers/auth/register.controller';
import * as apiKeyController from '../../controllers/auth/apiKey.controller';
import { verify } from 'jsonwebtoken';
import { verifyJwt } from '../../middleware/verifyJwt';

const router = express.Router();

router.post('/register', registerController.registerUser);
router.get('/check-user', registerController.CheckUserExists);
router.post('/create-api-key', verifyJwt, apiKeyController.createApiKey);
router.get('/get-api-keys', verifyJwt, apiKeyController.GetUserApiKeys);

export default router;
