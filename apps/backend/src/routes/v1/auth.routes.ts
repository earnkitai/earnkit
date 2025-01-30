import express from 'express';
import * as registerController from '../../controllers/auth/register.controller';

const router = express.Router();

router.post('/register', registerController.registerUser);
router.post('/login', registerController.loginUser);

export default router;
