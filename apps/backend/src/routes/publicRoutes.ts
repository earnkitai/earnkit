import express from "express";
import {
  registerUser,
  createApiKey,
} from "../controllers/public/auth.controller";

const router = express.Router();

router.post("/auth/register", registerUser);
router.post("/auth/create-api-key", createApiKey);

export default router;
