import { Request, Response, NextFunction } from 'express';
import UserModel from '../models/user.model';

const validateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Get API key from headers
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      res.status(401).json({
        success: false,
        error: 'API key is required in x-api-key header',
      });
      return;
    }

    // Validate API key
    const isValid = await UserModel.validateApiKey(apiKey);
    if (!isValid) {
      res.status(401).json({
        success: false,
        error: 'Invalid or expired API key',
      });
      return;
    }

    // Increment usage count
    await UserModel.incrementApiKeyUsage(apiKey);

    next();
  } catch (error) {
    console.error('API Key validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Error validating API key',
    });
  }
};

export default validateApiKey;
