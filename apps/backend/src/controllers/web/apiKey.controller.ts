import { Request, Response } from 'express';
import crypto from 'crypto';
import UserModel from '../../models/user.model';
import pool from '../../config/database';

export const createApiKey = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { subscriptionType = 'free' } = req.body;
    const userAddress = req.user?.address; // Get address from JWT token

    if (!userAddress) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    // Find user using verified address from JWT
    const user = await UserModel.findByAddress(userAddress);
    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found',
      });
      return;
    }

    // Check existing API keys count
    const existingKeys = await UserModel.getApiKeys(userAddress);
    if (existingKeys.length >= 5) {
      res.status(400).json({
        success: false,
        error: 'Maximum API key limit reached (5)',
      });
      return;
    }

    // Generate new API key
    const apiKey = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days validity

    const query = `
        INSERT INTO platform_api_keys (
          user_id, 
          api_key, 
          subscription_type, 
          expires_at, 
          max_usage, 
          usage_count, 
          active
        ) 
        VALUES ($1, $2, $3, $4, $5, $6, $7) 
        RETURNING id
      `;

    const result = await pool.query(query, [
      user.id,
      apiKey,
      subscriptionType,
      expiresAt,
      1000, // default max usage
      0, // initial usage count
      true, // active by default
    ]);

    res.status(201).json({
      success: true,
      data: {
        apiKey,
        expiresAt,
        subscriptionType,
      },
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create API key',
    });
  }
};

export const GetUserApiKeys = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const userAddress = req.user?.address; // Get address from JWT token

    if (!userAddress) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const apiKeys = await UserModel.getApiKeys(userAddress);

    return res.status(200).json({
      success: true,
      data: {
        address: userAddress,
        apiKeys: apiKeys.map((key) => ({
          apiKey: key.api_key,
          createdAt: key.created_at,
          expiresAt: key.expires_at,
          active: key.active,
          usageCount: key.usage_count,
          maxUsage: key.max_usage,
          subscriptionType: key.subscription_type,
        })),
      },
    });
  } catch (e: any) {
    console.error('Error:', e.message);
    return res.status(400).json({
      success: false,
      error: e.message,
    });
  }
};
