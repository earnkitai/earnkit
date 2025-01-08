import express from 'express';
import * as configController from '../../controllers/sdk/sdk.controller';

const router = express.Router();

// SDK-specific endpoints (validated by API key)
router.get('/config', configController.GetSdkConfig);
router.get('/get-ai-agent-wallet-details', configController.GetWalletDetails);

export default router;
