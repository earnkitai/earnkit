import express from 'express';
import {
  CreateAIAgentWallet,
  AddNewAIAgentWallet,
  ExecuteTransaction,
  GetUserDetails,
  GetWalletDetails,
  GetSdkConfig,
} from '../controllers/private/turnkey.controller';
import validateApiKey from '../middleware/validateApiKey';

const router = express.Router();
router.use(validateApiKey);
router.get('/get-user-details', GetUserDetails);
router.post('/create-ai-agent-wallet', CreateAIAgentWallet);
router.post('/add-new-ai-agent-wallet', AddNewAIAgentWallet);
router.post('/execute-transaction', ExecuteTransaction);
router.get('/wallet-details', GetWalletDetails);
router.get('/get-sdk-config', GetSdkConfig);
export default router;
