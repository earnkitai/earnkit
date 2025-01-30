import UserModel from '../models/user.model';
import { Request, Response, NextFunction } from 'express';
import { getApiKeyFromHeader } from './GetHeaders';

export async function verifyApiKeyOwnership(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const apiKey = getApiKeyFromHeader(req);
    const userAddress = req.user?.address;

    if (!apiKey || !userAddress) {
      res.status(401).json({
        success: false,
        error: 'API key and authentication required',
      });
      return;
    }

    // Verify API key belongs to the authenticated user
    const userApiKeys = await UserModel.getApiKeys(userAddress);
    const isValidApiKey = userApiKeys.some((key) => key.api_key === apiKey);

    if (!isValidApiKey) {
      res.status(403).json({
        success: false,
        error: 'Not authorized to use this API key',
      });
      return;
    }

    // Increment API key usage count
    await UserModel.incrementApiKeyUsage(apiKey);

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error verifying API key ownership',
    });
    return;
  }
}
