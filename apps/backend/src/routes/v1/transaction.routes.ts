import express from 'express';
import { verifyJwt } from '../../middleware/verifyJwt';
import * as transactionController from '../../controllers/wallet/transaction.controller';

const router = express.Router();

router.post(
  '/execute-transaction',
  verifyJwt,
  transactionController.ExecuteTransaction,
);

export default router;
