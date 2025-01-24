import { Request, Response } from 'express';
import pool from '../../config/database';

export const GetUserDetails = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const address = req.user?.address;

    if (!address || typeof address !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid address is required',
      });
    }

    // First check if user exists
    const userQuery = `
      SELECT 
        u.user_id,
        u.email,
        so.organization_id,
        so.owner_wallet_address,
        (
          SELECT json_agg(
            json_build_object(
              'id', aa.id,
              'name', aa.name,
              'walletAddress', aa.wallet_address,
              'saltNonce', aa.salt_nonce

            )
          )
          FROM ai_agents aa
          JOIN sub_organizations so2 ON so2.id = aa.sub_org_id
          WHERE so2.user_id = u.id
        ) as agents
      FROM users u
      LEFT JOIN sub_organizations so ON u.id = so.user_id
      WHERE u.user_id = $1
    `;

    const userResult = await pool.query(userQuery, [address]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'No user found with the provided address',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        user: {
          userId: user.user_id,
          email: user.email,
        },
        wallet: {
          ownerWalletAddress: user.owner_wallet_address || null,
          organizationId: user.organization_id || null,
        },
        agents: user.agents || [],
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
