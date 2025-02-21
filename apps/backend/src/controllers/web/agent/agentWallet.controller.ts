import { Request, Response } from 'express';
import 'dotenv/config';
import { toSafeSmartAccount } from 'permissionless/accounts'; // using permissionless.js for safe accounts
import { createPublicClient, http } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import { Turnkey } from '@turnkey/sdk-server';
import { DEFAULT_ETHEREUM_ACCOUNTS } from '@turnkey/sdk-server';
import { createAccount } from '@turnkey/viem';
import { entryPoint07Address } from 'viem/account-abstraction';
import WalletModel, { IAgent } from '../../../models/wallet.model';
import pool from '../../../config/database';
import { generateP256KeyPairHex } from '../../../utils/ApiKeyUtils';
import { getApiKeyFromHeader } from '../../../utils/GetHeaders';
import UserModel from '../../../models/user.model';
import { privateKeyToAccount } from 'viem/accounts';

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://sepolia.base.org'),
});

const apiPrivateKey = process.env.TURNKEY_API_PRIVATE_KEY;
const apiPublicKey = process.env.TURNKEY_API_PUBLIC_KEY;
const pimlocoApiKey = process.env.PIMLICO_API_KEY;
const orgId = process.env.ORG_ID;

// Ensure the keys are defined
if (!apiPrivateKey || !apiPublicKey) {
  throw new Error(
    'API keys are missing. Please set TURNKEY_API_PRIVATE_KEY and TURNKEY_API_PUBLIC_KEY in your environment variables.',
  );
}
if (!pimlocoApiKey) throw new Error('Missing PIMLICO_API_KEY');

const turnkeyServer = new Turnkey({
  apiBaseUrl: 'https://api.turnkey.com',
  apiPrivateKey: apiPrivateKey,
  apiPublicKey: apiPublicKey,
  defaultOrganizationId: orgId as string,
}).apiClient();

export const CreateAIAgentWallet = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const userAddress = req.user?.address;
    const { agentName } = req.body;

    if (!agentName) {
      return res.status(400).json({
        success: false,
        error: 'Agent name is required',
      });
    }

    // Get user details and check if they already have a sub-org
    const userQuery = `
      SELECT 
        u.id,
        u.user_id, 
        u.email,
        EXISTS (
          SELECT 1 FROM sub_organizations so 
          WHERE so.user_id = u.id
        ) as has_sub_org
      FROM users u
      WHERE u.user_id = $1
    `;

    const userResult = await pool.query(userQuery, [userAddress]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Check if user already has a sub-org
    if (user.has_sub_org) {
      return res.status(200).json({
        success: false,
        error:
          'User already has a Turnkey Sub-org. Use AddNewAIAgentWallet to create additional agents.',
      });
    }

    // Generate keys for the sub-org
    const keyPair = generateP256KeyPairHex();
    if (!keyPair) {
      return res.status(400).json({
        success: false,
        error: 'Failed to generate key pair',
      });
    }

    const { publicKey, privateKey } = keyPair;

    // Create sub organization
    const createSubOrgResponse = await turnkeyServer.createSubOrganization({
      subOrganizationName: 'AIAgent',
      rootUsers: [
        {
          userName: user.email.split('@')[0],
          userEmail: user.email,
          apiKeys: [
            {
              apiKeyName: 'earnkit',
              publicKey: publicKey as string,
              curveType: 'API_KEY_CURVE_P256',
            },
          ],
          authenticators: [],
          oauthProviders: [],
        },
      ],
      rootQuorumThreshold: 1,
      wallet: {
        walletName: 'Default Wallet',
        accounts: DEFAULT_ETHEREUM_ACCOUNTS,
      },
    });

    if (!createSubOrgResponse || !createSubOrgResponse.wallet) {
      return res.status(400).json({
        success: false,
        error: 'Error creating sub organization: wallet not created',
      });
    }

    // Create sub-org record
    const subOrg = await WalletModel.createSubOrg({
      userId: user.id,
      organizationId: createSubOrgResponse.subOrganizationId,
      ownerWalletAddress: createSubOrgResponse.wallet.addresses[0],
      publicKey,
      privateKey,
    });

    // Create turnkey account for AI agent
    const turnkeyAccount = await createAccount({
      client: turnkeyServer,
      organizationId: createSubOrgResponse.subOrganizationId,
      signWith: createSubOrgResponse.wallet.addresses[0],
    });

    // Generate unique salt for the agent
    const saltNonce = (
      Date.now() * 1000 +
      Math.floor(Math.random() * 1000)
    ).toString();

    // Create safe account for the agent
    const account = await toSafeSmartAccount({
      client: publicClient,
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
      saltNonce: BigInt(saltNonce),
      owners: [turnkeyAccount],
      version: '1.4.1',
    });

    // Add the agent
    const agent = await WalletModel.addAgent(subOrg.id, {
      name: agentName,
      walletAddress: account.address,
      saltNonce,
    });

    return res.status(201).json({
      success: true,
      data: {
        organizationId: createSubOrgResponse.subOrganizationId,
        owner: {
          address: createSubOrgResponse.wallet.addresses[0],
          organizationId: subOrg.organizationId,
        },
        agent: {
          id: agent.id,
          name: agent.name,
          smartAccountAddress: agent.walletAddress,
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

// to create a new AI agent wallet for a dev wallet(which will be the owner of safe wallet)->requrued when creating new AI agent
export const AddNewAIAgentWallet = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const userAddress = req.user?.address;
    const { agentName } = req.body;

    if (!agentName) {
      return res.status(400).json({
        success: false,
        error: 'Agent name is required',
      });
    }

    // Find the base wallet record using user address
    const baseWallet = await WalletModel.findByUserAddress(userAddress!);
    if (!baseWallet) {
      return res.status(404).json({
        success: false,
        error: 'No wallet found for this user',
      });
    }

    const turnkeyServer = new Turnkey({
      apiBaseUrl: 'https://api.turnkey.com',
      apiPrivateKey: baseWallet.privateKey,
      apiPublicKey: baseWallet.publicKey,
      defaultOrganizationId: baseWallet.organizationId, // Note: using snake_case from DB
    }).apiClient();

    const turnkeyAccount = await createAccount({
      client: turnkeyServer,
      organizationId: baseWallet.organizationId,
      signWith: baseWallet.ownerWalletAddress, // Note: using snake_case from DB
    });

    // Generate unique salt based on timestamp and random number
    const saltNonce = BigInt(
      Date.now() * 1000 + Math.floor(Math.random() * 1000),
    );

    // Create safe account for the agent
    const account = await toSafeSmartAccount({
      client: publicClient,
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
      saltNonce: BigInt(saltNonce),
      owners: [turnkeyAccount],
      version: '1.4.1',
    });

    // Check if agent with this name already exists
    const existingAgent = await WalletModel.findAgentByNameAndUserAddress(
      userAddress!,
      agentName,
    );
    if (existingAgent) {
      return res.status(400).json({
        success: false,
        error: 'An agent with this name already exists for this wallet',
      });
    }

    // Add new agent to the agents array with salt
    const agent = await WalletModel.addAgent(baseWallet.id, {
      name: agentName,
      walletAddress: account.address,
      saltNonce: saltNonce.toString(),
    });

    return res.status(201).json({
      success: true,
      // data: {
      //   organizationId: baseWallet.organizationId,
      //   owner: {
      //     address: baseWallet.ownerWalletAddress,
      //     organizationId: baseWallet.organizationId,
      //   },
      //   agent: {
      //     id: agent.id,
      //     name: agentName,
      //     smartAccountAddress: account.address,
      //   },
      // },
      data: {
        organizationId: baseWallet.organizationId,
        owner: {
          address: baseWallet.ownerWalletAddress,
          organizationId: baseWallet.organizationId,
        },
        agent: {
          id: agent.id,
          name: agent.name,
          smartAccountAddress: account.address,
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

// Get agent details by wallet address
export const GetAgentByWalletAddress = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const userAddress = req.user?.address;
    const { walletAddress } = req.query;

    if (!walletAddress || typeof walletAddress !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required',
      });
    }

    // Query to get agent details by wallet address
    const agentQuery = `
      SELECT 
        a.*,
        so.organization_id,
        so.owner_wallet_address as sign_with,
        json_agg(
          json_build_object(
            'tokenAddress', dt.token_address,
            'tokenName', dt.token_name,
            'tokenSymbol', dt.token_symbol,
            'lockerAddress', dt.locker_address,
            'tokenId', dt.token_id,
            'createdAt', dt.created_at
          )
        ) FILTER (WHERE dt.id IS NOT NULL) as deployed_tokens
      FROM ai_agents a
      JOIN sub_organizations so ON so.id = a.sub_org_id
      JOIN users u ON u.id = so.user_id
      LEFT JOIN deployed_tokens dt ON dt.agent_id = a.id
      WHERE a.wallet_address = $1 
      AND u.user_id = $2
      GROUP BY a.id, so.organization_id, so.owner_wallet_address
    `;

    const agentResult = await pool.query(agentQuery, [
      walletAddress,
      userAddress,
    ]);
    const agent = agentResult.rows[0];

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'No agent found with the provided wallet address',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        organization_id: agent.organization_id,
        sign_with: agent.sign_with,
        agent: {
          id: agent.id,
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
