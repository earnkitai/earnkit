import express from 'express';
import * as transactionController from '../../controllers/wallet/transaction.controller';

const router = express.Router();

// Execute transaction
router.post('/execute-transaction', transactionController.ExecuteTransaction);

export default router;
