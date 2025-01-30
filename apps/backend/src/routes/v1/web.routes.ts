import express from 'express';
import { verifyJwt } from '../../middleware/verifyJwt';
import * as userController from '../../controllers/web/user/subOrg.controller';
import * as apiKeyController from '../../controllers/web/api/apiKey.controller';
import * as transactionController from '../../controllers/web/agentToken/transaction.controller';
import * as agentToolController from '../../controllers/web/agent/agentTools.controller';
import * as agentFarcasterDetailsController from '../../controllers/web/agent/agentFarcaster.controller';
import * as agentWalletController from '../../controllers/web/agent/agentWallet.controller';

const router = express.Router();

// Route without JWT verification
router.post('/store-token-details', transactionController.storeTokenDetails);

// Routes that only need JWT
router.use(verifyJwt);

// Agent Farcaster Details routes
router.post(
  '/agent/:agentId/farcaster',
  agentFarcasterDetailsController.createFarcasterDetails,
);
router.put(
  '/agent/:agentId/farcaster',
  agentFarcasterDetailsController.updateFarcasterDetails,
);
router.get(
  '/agent/:agentId/farcaster',
  agentFarcasterDetailsController.getFarcasterDetails,
);

// Agent Tool Config routes
router.post('/agent/:agentId/config', agentToolController.createOrUpdateConfig);
router.get('/agent/:agentId/config', agentToolController.getConfig);

router.post('/create-api-key', apiKeyController.createApiKey);
router.get('/get-user-details', userController.GetUserDetails);
router.get('/get-api-keys', apiKeyController.GetUserApiKeys);
router.get(
  '/get-agent-wallet-details-by-address',
  agentWalletController.GetAgentByWalletAddress,
);

// Agent Wallet routes
router.post(
  '/create-ai-agent-wallet',
  agentWalletController.CreateAIAgentWallet,
);
router.post(
  '/add-new-ai-agent-wallet',
  agentWalletController.AddNewAIAgentWallet,
);

// Agent Token routes
router.post('/deploy-agent-token', transactionController.DeployAgentToken);
router.post('/claim-agent-fees', transactionController.claimFees);

export default router;
