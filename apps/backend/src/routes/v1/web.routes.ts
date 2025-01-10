import express from 'express';
import { verifyJwt } from '../../middleware/verifyJwt';
import { verifyApiKeyOwnership } from '../../utils/VerifyApiKeyOwnership';
import * as agentController from '../../controllers/web/agent.controller';
import * as userController from '../../controllers/web/subOrg.controller';
import * as apiKeyController from '../../controllers/web/apiKey.controller';
import * as transactionController from '../../controllers/web/transaction.controller';

const router = express.Router();

// Routes that only need JWT
router.use(verifyJwt);
router.post('/create-api-key', apiKeyController.createApiKey);
router.get('/get-user-details', userController.GetUserDetails);
router.get('/get-api-keys', apiKeyController.GetUserApiKeys);
router.get(
  '/get-agent-wallet-details-by-address',
  agentController.GetAgentByWalletAddress,
);

// Routes that need both JWT and API key verification
// router.use(verifyApiKeyOwnership);

router.post('/create-ai-agent-wallet', agentController.CreateAIAgentWallet);
router.post('/add-new-ai-agent-wallet', agentController.AddNewAIAgentWallet);
router.post('/deploy-agent-token', transactionController.DeployAgentToken);
router.post('/claim-agent-fees', transactionController.claimFees);

export default router;
