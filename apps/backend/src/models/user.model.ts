import pool from '../config/database';

interface IUser {
  id: number;
  userId: string; // blockchain address
  email: string;
  createdAt: Date;
}

interface IApiKey {
  id: number;
  apiKey: string;
  createdAt: Date;
  expiresAt: Date;
  active: boolean;
  usageCount: number;
  maxUsage: number;
  subscriptionType: string;
}

class UserModel {
  // Create a new user
  static async createUser(email: string, address: string): Promise<IUser> {
    const query = `
      INSERT INTO users (user_id, email)
      VALUES ($1, $2)
      RETURNING *
    `;

    const result = await pool.query(query, [address, email]);
    return result.rows[0];
  }

  // Find user by address
  static async findByAddress(address: string): Promise<IUser | null> {
    const query = `
      SELECT * FROM users
      WHERE user_id = $1
    `;

    const result = await pool.query(query, [address]);
    return result.rows[0] || null;
  }

  // Get all API keys for a user
  static async getApiKeys(address: string): Promise<IApiKey[]> {
    const query = `
      SELECT 
        pak.*
      FROM platform_api_keys pak
      JOIN users u ON u.id = pak.user_id
      WHERE u.user_id = $1
      ORDER BY pak.created_at DESC
    `;

    const result = await pool.query(query, [address]);
    return result.rows;
  }

  // Validate API key
  static async validateApiKey(apiKey: string): Promise<boolean> {
    const query = `
      SELECT EXISTS (
        SELECT 1 
        FROM platform_api_keys 
        WHERE api_key = $1 
        AND active = true 
        AND expires_at > NOW() 
        AND usage_count < max_usage
      )
    `;

    const result = await pool.query(query, [apiKey]);
    return result.rows[0].exists;
  }

  // Increment API key usage
  static async incrementApiKeyUsage(apiKey: string): Promise<void> {
    const query = `
      UPDATE platform_api_keys 
      SET usage_count = usage_count + 1
      WHERE api_key = $1
    `;

    await pool.query(query, [apiKey]);
  }
}

export default UserModel;
