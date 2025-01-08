import { Request, Response } from 'express';
import { getApiKeyFromHeader } from '../../utils/GetHeaders';
import WalletModel from '../../models/wallet.model';
import { SDKConfig } from '../../types';
import pool from '../../config/database';

export const GetSdkConfig = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    // Get API key from request
    const apiKey = getApiKeyFromHeader(req);

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'API key is required',
      });
    }

    // Find wallet and its keys
    const wallet = await WalletModel.findByApiKey(apiKey);
    if (!wallet) {
      return res.status(404).json({
        success: false,
        error: 'No wallet found for the provided API key',
      });
    }

    // Get keys from database
    const keys = await WalletModel.findKeysByWalletId(wallet.id);
    if (!keys?.public_key || !keys?.private_key) {
      return res.status(400).json({
        success: false,
        error: 'No keys found for this wallet',
      });
    }

    const config: SDKConfig = {
      turnkeyApiPrivateKey: keys.private_key,
      turnkeyApiPublicKey: keys.public_key,
      pimlicoApiKey: process.env.PIMLICO_API_KEY!,
      pimlicoUrl: process.env.PIMLICO_URL!,
    };

    res.json(config);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch configuration',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// Get wallet details with agentName and APIkey
export const GetWalletDetails = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const apiKey = getApiKeyFromHeader(req);
    const { agentName } = req.query;

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'API key is required in headers',
      });
    }

    if (!agentName || typeof agentName !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Agent name is required',
      });
    }

    // Find sub-org and agent by API key
    const subOrg = await WalletModel.findByApiKey(apiKey);
    if (!subOrg) {
      return res.status(404).json({
        success: false,
        error: 'No sub-organization found for the provided API key',
      });
    }

    const agentQuery = `
      SELECT 
        a.*,
        json_agg(
          json_build_object(
            'tokenAddress', dt.token_address,
            'tokenName', dt.token_name,
            'tokenSymbol', dt.token_symbol,
            'createdAt', dt.created_at
          )
        ) FILTER (WHERE dt.id IS NOT NULL) as deployed_tokens
      FROM ai_agents a
      LEFT JOIN deployed_tokens dt ON dt.agent_id = a.id
      WHERE a.sub_org_id = $1 AND a.name = $2
      GROUP BY a.id
    `;

    const agentResult = await pool.query(agentQuery, [subOrg.id, agentName]);
    const agent = agentResult.rows[0];

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'No agent found with the provided name',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        organization_id: subOrg.organizationId,
        sign_with: subOrg.ownerWalletAddress,
        agent: {
          name: agent.name,
          address: agent.wallet_address,
          saltNonce: agent.salt_nonce,
          deployedTokens: agent.deployed_tokens || [],
        },
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
