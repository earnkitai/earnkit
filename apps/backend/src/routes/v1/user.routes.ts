import express from 'express';
import * as subOrgController from '../../controllers/wallet/subOrg.controller';

const router = express.Router();

// Get all details (user, sub-org, and all agents)
router.get('/get-user-details', subOrgController.GetUserDetails);

export default router;
