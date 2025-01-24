import express from 'express';
import { verifyJwt } from '../../middleware/verifyJwt';
import { verifyApiKeyOwnership } from '../../utils/VerifyApiKeyOwnership';
import * as agentController from '../../controllers/web/agent.controller';
import * as userController from '../../controllers/web/subOrg.controller';
import * as apiKeyController from '../../controllers/web/apiKey.controller';
import * as transactionController from '../../controllers/web/transaction.controller';
import * as logsController from '../../controllers/web/logs.controller';
import * as agentDetailsController from '../../controllers/web/agent.details.controller';

const router = express.Router();

// Route without JWT verification
router.post('/store-token-details', transactionController.storeTokenDetails);

// Logs routes (no JWT required as they're from external sources)
router.post('/logs/interaction', logsController.createInteractionLog);
router.post('/logs/agent-response', logsController.createAgentResponse);
router.get('/logs/agent/:agentId', logsController.getAgentLogs);
router.get('/logs/agent/:agentId/responses', logsController.getAgentResponses);
router.get(
  '/logs/agent/:agentId/interactions',
  logsController.getAgentInteractionsWithResponses,
);

// Agent Details routes
router.post(
  '/agent/:agentId/farcaster',
  agentDetailsController.createFarcasterDetails,
);
router.put(
  '/agent/:agentId/farcaster',
  agentDetailsController.updateFarcasterDetails,
);
router.get(
  '/agent/:agentId/farcaster',
  agentDetailsController.getFarcasterDetails,
);

// Agent Config routes
router.post(
  '/agent/:agentId/config',
  agentDetailsController.createOrUpdateConfig,
);
router.get('/agent/:agentId/config', agentDetailsController.getConfig);

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
