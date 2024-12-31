import express from "express";
import {
  CreateAIAgent,
  CreateNewAIAgentWallet,
  ExecuteTransaction,
  GetUserDetails,
  GetSmartAccountClient,
  ExecuteTransactionWithClient,
  GetWalletDetails,
} from "../controllers/private/turnkey.controller";
import validateApiKey from "../middleware/validateApiKey";
import { deployToken } from "../controllers/farcaster.controller";

const router = express.Router();
// router.use(validateApiKey);
router.get("/user-details", GetUserDetails);
router.post("/create-ai-agent", CreateAIAgent);
router.post("/add-new-ai-agent-wallet", CreateNewAIAgentWallet);
router.post("/execute-transaction", ExecuteTransaction);
router.get("/smart-account-client", GetSmartAccountClient);
router.post("/execute-with-client", ExecuteTransactionWithClient);
router.get("/wallet-details", GetWalletDetails);
export default router;
