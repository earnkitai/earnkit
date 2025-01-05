import { Request, Response } from 'express';
import UserModel from '../../models/user.model';

export const registerUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { email, address } = req.body;

    if (!email || !address) {
      res.status(400).json({
        success: false,
        error: 'Email and address are required',
      });
      return;
    }

    // Check if user already exists
    const existingUser = await UserModel.findByAddress(address);
    if (existingUser) {
      res.status(400).json({
        success: false,
        error: 'User already exists with this address',
      });
      return;
    }

    // Create new user
    const user = await UserModel.createUser(email, address);

    res.status(201).json({
      success: true,
      data: {
        userId: user.userId,
        email: user.email,
      },
    });
  } catch (error: any) {
    console.error('Error registering user:', error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

export const CheckUserExists = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { address } = req.query;

    if (!address || typeof address !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Valid address is required',
      });
      return;
    }

    const user = await UserModel.findByAddress(address);

    if (!user) {
      res.status(200).json({
        success: true,
        exists: false,
        message: 'User not found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      exists: true,
      data: {
        address: user.userId,
        email: user.email,
      },
    });
  } catch (error: any) {
    console.error('Error:', error.message);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};
