import express from 'express';
import { verifyJwt } from '../../middleware/verifyJwt';
import * as subOrgController from '../../controllers/wallet/subOrg.controller';

const router = express.Router();

router.get('/get-user-details', verifyJwt, subOrgController.GetUserDetails);

export default router;
