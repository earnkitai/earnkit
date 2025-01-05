import express from 'express';
import * as sdkController from '../../controllers/config/sdk.controller';

const router = express.Router();

router.get('/get-sdk-config', sdkController.GetSdkConfig);

export default router;
