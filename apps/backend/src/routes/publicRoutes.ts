import express from 'express';
import {
  registerUser,
  createApiKey,
} from "../controllers/public/auth.controller";
import { deployToken } from "../controllers/farcaster.controller";
const router = express.Router();

router.post("/auth/register", registerUser);
router.post("/auth/create-api-key", createApiKey);
router.post("/farcaster/deploy-token", deployToken);

export default router;
