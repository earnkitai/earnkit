import { Request, Response } from 'express';
import crypto from 'crypto';
import UserModel from '../../models/user.model';
import pool from '../../config/database';
import { verifySignature } from '../../utils/SignatureUtils';

export const createApiKey = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { userId, subscriptionType = 'free' } = req.body;

    if (!userId) {
      res.status(400).json({
        success: false,
        error: 'User ID is required',
      });
      return;
    }

    // Find user
    const user = await UserModel.findByAddress(userId);
    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found',
      });
      return;
    }

    // Check existing API keys count
    const existingKeys = await UserModel.getApiKeys(userId);
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
    const { address, signature } = req.query;

    if (
      !address ||
      typeof address !== 'string' ||
      !signature ||
      typeof signature !== 'string'
    ) {
      return res.status(400).json({
        success: false,
        error: 'Valid address and signature are required',
      });
    }

    // Verify the signature
    const isValidSignature = verifySignature(address, signature);
    if (!isValidSignature) {
      return res.status(403).json({
        success: false,
        error: 'Invalid signature',
      });
    }

    const apiKeysQuery = `
      SELECT 
        pak.api_key,
        pak.created_at,
        pak.expires_at,
        pak.active,
        pak.usage_count,
        pak.max_usage,
        pak.subscription_type
      FROM users u
      JOIN platform_api_keys pak ON u.id = pak.user_id
      WHERE u.user_id = $1
      ORDER BY pak.created_at DESC
    `;

    const apiKeysResult = await pool.query(apiKeysQuery, [address]);
    const apiKeys = apiKeysResult.rows;

    if (!apiKeys.length) {
      return res.status(200).json({
        success: true,
        data: {
          address,
          apiKeys: [],
          message: 'No API keys found for this user',
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        address,
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
