import express from 'express';
import * as registerController from '../../controllers/auth/register.controller';
import * as apiKeyController from '../../controllers/auth/apiKey.controller';

const router = express.Router();

router.post('/register', registerController.registerUser);
router.get('/check-user', registerController.CheckUserExists);
router.post('/create-api-key', apiKeyController.createApiKey);
router.get('/get-api-keys', apiKeyController.GetUserApiKeys);

export default router;
