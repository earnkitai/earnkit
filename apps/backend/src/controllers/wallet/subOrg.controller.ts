import { Request, Response } from 'express';
import { getApiKeyFromHeader } from '../../utils/GetHeaders';
import pool from '../../config/database';

export const GetUserDetails = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const { address } = req.query;
    const apiKey = getApiKeyFromHeader(req);

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'API key is required in headers',
      });
    }

    if (!address || typeof address !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid address is required',
      });
    }

    const userQuery = `
        WITH user_data AS (
          SELECT DISTINCT
            u.user_id,
            u.email,
            so.organization_id,
            so.owner_wallet_address
          FROM users u
          LEFT JOIN sub_organizations so ON u.id = so.user_id
          JOIN platform_api_keys pak ON u.id = pak.user_id
          WHERE u.user_id = $1 AND pak.active = true
        ),
        agent_data AS (
          SELECT 
            aa.name,
            aa.wallet_address,
            aa.salt_nonce,
            so.organization_id
          FROM ai_agents aa
          JOIN sub_organizations so ON so.id = aa.sub_org_id
        )
        SELECT 
          ud.*,
          json_agg(
            json_build_object(
              'name', ad.name,
              'walletAddress', ad.wallet_address,
              'saltNonce', ad.salt_nonce
            )
          ) as agents
        FROM user_data ud
        LEFT JOIN agent_data ad ON ad.organization_id = ud.organization_id
        GROUP BY ud.user_id, ud.email, ud.organization_id, ud.owner_wallet_address
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
          ownerWalletAddress: user.owner_wallet_address,
          organizationId: user.organization_id,
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
