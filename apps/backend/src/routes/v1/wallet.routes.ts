import express from 'express';
import { verifyJwt } from '../../middleware/verifyJwt';
import * as agentController from '../../controllers/wallet/agent.controller';

const router = express.Router(); // Apply to all wallet routes

// Create first agent wallet with sub-org
router.post(
  '/create-ai-agent-wallet',
  verifyJwt,
  agentController.CreateAIAgentWallet,
);

// Add additional agent wallet to existing sub-org
router.post(
  '/add-new-ai-agent-wallet',
  verifyJwt,
  agentController.AddNewAIAgentWallet,
);

// Get specific agent wallet details
router.get('/get-ai-agent-wallet-details', agentController.GetWalletDetails);

export default router;
