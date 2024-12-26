import { Request, Response } from "express";
import { pool } from "../../db/pool";
import { generateApiKey, hashApiKey } from "../../utils/cryptoUtils";

export const registerUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email, address } = req.body;

    if (!email || !address) {
      res.status(400).json({
        success: false,
        error: "Email and address are required",
      });
      return;
    }

    const createUserQuery = `
      INSERT INTO users (user_id, email)
      VALUES ($1, $2)
      RETURNING id, user_id, email
    `;

    const userResult = await pool.query(createUserQuery, [address, email]);
    const user = userResult.rows[0];

    res.status(201).json({
      success: true,
      data: {
        userId: user.user_id,
        email: user.email,
      },
    });
  } catch (error: any) {
    console.error("Error registering user:", error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Create and store an API key for a user
 * @param req Express request object
 * @param res Express response object
 */
export const createApiKey = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { userId } = req.body;

  if (!userId) {
    res.status(400).json({
      success: false,
      error: "User ID is required",
    });
    return;
  }

  try {
    // First verify user exists
    const userExistsQuery = `
      SELECT id FROM users WHERE user_id = $1
    `;
    const userResult = await pool.query(userExistsQuery, [userId]);

    if (userResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: "User not found",
      });
      return;
    }

    const user = userResult.rows[0];

    // Check if user already has an API key
    const checkQuery = `
      SELECT COUNT(*) as key_count 
      FROM api_keys 
      WHERE user_id = $1 AND active = true
    `;

    const checkResult = await pool.query(checkQuery, [user.id]);
    if (checkResult.rows[0].key_count > 0) {
      res.status(400).json({
        success: false,
        error: "User already has an active API key",
      });
      return;
    }

    // Generate a new API key
    const apiKey = generateApiKey();
    const hashedApiKey = hashApiKey(apiKey);

    // Store the API key in the database using the user's id
    const result = await pool.query(
      `INSERT INTO api_keys (user_id, hashed_key, subscription_type, expires_at, max_usage, usage_count, active) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, user_id`,
      [
        user.id,
        hashedApiKey,
        "free",
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        1000,
        0,
        true,
      ]
    );

    res.status(201).json({
      message: "API key created successfully",
      apiKey,
      id: result.rows[0].id,
    });
  } catch (error) {
    console.error("Error creating API key:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
