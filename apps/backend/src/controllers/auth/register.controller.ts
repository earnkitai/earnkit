import { Request, Response } from 'express';
import UserModel from '../../models/user.model';
import { verifySignature } from '../../utils/SignatureUtils';
import { generateToken } from '../../utils/JwtUtils';

export const registerUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { email, address, signature } = req.body;

    if (!email || !address || !signature) {
      res.status(400).json({
        success: false,
        error: 'Email, address and signature are required',
      });
      return;
    }

    // Verify signature
    const isValidSignature = verifySignature(address, signature);
    if (!isValidSignature) {
      res.status(401).json({
        success: false,
        error: 'Invalid signature',
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

    // Generate JWT token
    const token = generateToken(address, signature);

    res.status(201).json({
      success: true,
      data: {
        userId: user.userId,
        email: user.email,
        token, // Include the JWT token in the response
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
    const { signature } = req.body;

    if (
      !address ||
      typeof address !== 'string' ||
      !signature ||
      typeof signature !== 'string'
    ) {
      res.status(400).json({
        success: false,
        error: 'Valid address and signature are required',
      });
      return;
    }

    // Verify signature
    const isValidSignature = verifySignature(address, signature);
    if (!isValidSignature) {
      res.status(401).json({
        success: false,
        error: 'Invalid signature',
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

    // Generate JWT token
    const token = generateToken(address, signature);

    res.status(200).json({
      success: true,
      exists: true,
      data: {
        userId: user.userId,
        email: user.email,
        token,
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
