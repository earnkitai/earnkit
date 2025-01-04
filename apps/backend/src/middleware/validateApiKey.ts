import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import pool from '../config/database';

// Interface to type the request user data
interface User {
  id: number;
  subscription: string;
}

interface ApiKeyRow {
  id: number;
  user_id: number;
  hashed_key: string;
  active: boolean;
  expires_at: Date;
  usage_count: number;
  max_usage: number;
  subscription_type: string;
}

const validateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const apiKey = req.headers['x-api-key'] as string | undefined;

  if (!apiKey) {
    res.status(401).json({ message: 'API key is missing' });
    return;
  }

  try {
    // Hash the API key
    const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');

    // Query the database to find the API key
    const result = await pool.query<ApiKeyRow>(
      `SELECT * FROM api_keys 
       WHERE hashed_key = $1 
       AND active = TRUE`,
      [apiKey],
    );

    if (result.rows.length === 0) {
      res.status(403).json({ message: 'Invalid or expired API key' });
      return;
    }

    const keyData = result.rows[0];

    // Check if the API key has exceeded the usage limit
    if (keyData.usage_count >= keyData.max_usage) {
      res.status(429).json({ message: 'API key usage limit exceeded' });
      return;
    }

    // Increment the usage count
    await pool.query(
      `UPDATE api_keys SET usage_count = usage_count + 1 WHERE id = $1`,
      [keyData.id],
    );

    // Attach user information to the request object for further processing
    req.user = {
      id: keyData.user_id,
      subscription: keyData.subscription_type,
    };

    next(); // Proceed to the next middleware or controller
  } catch (error) {
    console.error('API key validation error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

export default validateApiKey;
