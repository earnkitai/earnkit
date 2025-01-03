import { Request, Response } from 'express';
import 'dotenv/config';
import { toSafeSmartAccount } from 'permissionless/accounts'; // using permissionless.js for safe accounts
import {
  Hex,
  createPublicClient,
  createWalletClient,
  getContract,
  http,
} from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { Turnkey } from '@turnkey/sdk-server';
import { DEFAULT_ETHEREUM_ACCOUNTS } from '@turnkey/sdk-server';
import { createAccount } from '@turnkey/viem';

import { entryPoint07Address } from 'viem/account-abstraction';
import { createSmartAccountClient } from 'permissionless';
import { parseAbiItem, encodeFunctionData } from 'viem';
import WalletModel, { IAgent } from '../../models/wallet.model';
import pool from '../../config/database';
import crypto from 'crypto';
import { SDKConfig } from '../../types';
import { generateP256KeyPairHex } from '../../utils/ApiKeyUtils';
import { CLIENT_RENEG_LIMIT } from 'tls';

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

// Common function to get API key from headers
const getApiKeyFromHeader = (req: Request): string | null => {
  // Check for x-api-key header first
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    return apiKey.toString();
  }

  // Fallback to Authorization header if x-api-key is not present
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    console.log('No Authorization header found');
    return null;
  }

  const [bearer, token] = authHeader.split(' ');
  if (bearer !== 'Bearer' || !token) {
    console.log('Invalid Authorization format. Expected: Bearer <token>');
    return null;
  }

  return token;
};

// to create a new turnkeysub organization and create a dev wallet(which will be the owner of safe wallet) for that sub organization and a safe Wallet(which will be the AI-Agent Wallet).
export const CreateAIAgentWallet = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const apiKey = getApiKeyFromHeader(req);
    const { agentName } = req.body;

    if (!apiKey || !agentName) {
      return res.status(400).json({
        success: false,
        error: 'API key in headers and agent name are required',
      });
    }

    // Get user details and check if they already have a wallet
    const userQuery = `
      SELECT 
        u.user_id, 
        u.email,
        EXISTS (
          SELECT 1 FROM wallets w 
          WHERE w.user_id = u.user_id
        ) as has_wallet
      FROM users u
      JOIN api_keys ak ON u.id = ak.user_id
      WHERE ak.hashed_key = $1 AND ak.active = true
    `;

    const userResult = await pool.query(userQuery, [apiKey]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'No user found with the provided API key',
      });
    }

    // Check if user already has a wallet
    if (user.has_wallet) {
      return res.status(400).json({
        success: false,
        error:
          'User already has an Turnkey Sub-org. Use AddNewAIAgentWallet to create additional agents.',
      });
    }

    const keyPair = generateP256KeyPairHex();
    if (!keyPair) {
      return res.status(400).json({
        success: false,
        error: 'Failed to generate key pair',
      });
    }

    const { publicKey, privateKey } = keyPair;

    // Create sub organization for the user
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
              curveType: 'API_KEY_CURVE_P256', // Add this field
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

    // Create wallet and agent
    const wallet = await WalletModel.createWallet({
      userId: user.user_id,
      organizationId: createSubOrgResponse.subOrganizationId,
      signWith: createSubOrgResponse.wallet.addresses[0],
      publicKey,
      privateKey,
    });

    // Store the keys in the new table
    await WalletModel.createKeys(wallet.id, publicKey, privateKey);

    // Create turnkey account for AI agent
    const turnkeyAccount = await createAccount({
      client: turnkeyServer,
      organizationId: createSubOrgResponse.subOrganizationId,
      signWith: createSubOrgResponse.wallet.addresses[0],
    });

    const saltNonce = BigInt(
      Date.now() * 1000 + Math.floor(Math.random() * 1000),
    );
    const account = await toSafeSmartAccount({
      client: publicClient,
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
      saltNonce,
      owners: [turnkeyAccount],
      version: '1.4.1',
    });

    const agent = await WalletModel.addAgent(wallet.id, {
      name: agentName,
      address: account.address,
      saltNonce,
    });

    return res.status(201).json({
      success: true,
      data: {
        organizationId: createSubOrgResponse.subOrganizationId,
        wallet: {
          address: createSubOrgResponse.wallet.addresses[0],
          organizationId: wallet.organization_id,
        },
        agent: {
          name: agentName,
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

// to create a new AI agent wallet for a dev wallet(which will be the owner of safe wallet)->requrued when creating new AI agent
export const AddNewAIAgentWallet = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const apiKey = getApiKeyFromHeader(req);
    const { agentName } = req.body;

    if (!apiKey || !agentName) {
      return res.status(400).json({
        success: false,
        error: 'API key in headers and agent name are required',
      });
    }

    // Find the base wallet record using apiKey
    const baseWallet = await WalletModel.findByApiKey(apiKey);
    if (!baseWallet) {
      return res.status(404).json({
        success: false,
        error: 'No Dev User found for the provided API key',
      });
    }

    console.log('Base wallet found:', baseWallet); // Debug log

    if (!baseWallet.sign_with) {
      return res.status(400).json({
        success: false,
        error: 'Wallet has no sign_with value',
      });
    }

    const turnkeyServer = new Turnkey({
      apiBaseUrl: 'https://api.turnkey.com',
      apiPrivateKey: apiPrivateKey,
      apiPublicKey: apiPublicKey,
      defaultOrganizationId: baseWallet.organization_id, // Note: using snake_case from DB
    }).apiClient();

    const turnkeyAccount = await createAccount({
      client: turnkeyServer,
      organizationId: baseWallet.organization_id,
      signWith: baseWallet.sign_with, // Note: using snake_case from DB
    });

    // Generate unique salt based on timestamp and random number
    const saltNonce = BigInt(
      Date.now() * 1000 + Math.floor(Math.random() * 1000),
    );

    const account = await toSafeSmartAccount({
      client: publicClient,
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
      saltNonce: saltNonce,
      owners: [turnkeyAccount],
      version: '1.4.1',
    });

    // Check if agent with this name already exists
    const existingAgent = await WalletModel.findAgentByNameAndApiKey(
      apiKey,
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
      address: account.address,
      saltNonce: saltNonce,
    });

    return res.status(201).json({
      success: true,
      data: {
        agentName,
        smartAccountAddress: account.address,
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

// to execute a transaction
export const ExecuteTransaction = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const apiKey = getApiKeyFromHeader(req);
    const { agentName, name, symbol, ownerAddress, tokenImage } = req.body;

    if (!apiKey || !agentName) {
      return res.status(400).json({
        success: false,
        error: 'API key in headers and agent name are required',
      });
    }

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

    // Find the agent
    const agent = wallet.agents.find((a: any) => a.name === agentName);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'No agent found with the provided name',
      });
    }

    if (!wallet.sign_with) {
      return res.status(400).json({
        success: false,
        error: 'Wallet has no sign_with value',
      });
    }

    const turnkeyServer = new Turnkey({
      apiBaseUrl: 'https://api.turnkey.com',
      apiPrivateKey: keys.private_key,
      apiPublicKey: keys.public_key,
      defaultOrganizationId: wallet.organization_id,
    }).apiClient();

    const turnkeyAccount = await createAccount({
      client: turnkeyServer,
      organizationId: wallet.organization_id,
      signWith: wallet.sign_with,
    });

    const pimlicoUrl = `https://api.pimlico.io/v2/84532/rpc?apikey=${pimlocoApiKey}`; // bundler URL

    const pimlicoClient = createPimlicoClient({
      // pimlico client
      transport: http(pimlicoUrl),
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
    });

    const account = await toSafeSmartAccount({
      client: publicClient,
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
      owners: [turnkeyAccount],
      saltNonce: BigInt(agent.saltNonce), // Use stored salt
      version: '1.4.1',
      address: agent.address as `0x${string}`,
    });

    console.log(
      `Smart account address: https://sepolia.etherscan.io/address/${account.address}`,
    );

    const smartAccountClient = createSmartAccountClient({
      account,
      chain: baseSepolia,
      bundlerTransport: http(pimlicoUrl),
      paymaster: pimlicoClient,
      userOperation: {
        estimateFeesPerGas: async () => {
          return (await pimlicoClient.getUserOperationGasPrice()).fast;
        },
      }, //remove paymaster and userOperation if you don't want it to be sponsored
    });

    const args: [string, string, `0x${string}`, `0x${string}`, bigint] = [
      name,
      symbol,
      ownerAddress as `0x${string}`,
      tokenImage as `0x${string}`,
      BigInt(100000000 * 18),
    ];
    const txHash = await smartAccountClient.sendTransaction({
      to: '0x1302017D2d3aA9Fe213cd7F9fa76d9299722690E',
      data: encodeFunctionData({
        abi: [
          parseAbiItem(
            'function deployToken(string memory name,string memory symbol,address deployer,string memory image,uint256 totalSupply) public returns (address)',
          ),
        ],
        functionName: 'deployToken',
        args,
      }),
      value: BigInt(0),
    });

    console.log(
      `User operation included: https://sepolia.basescan.org/tx/${txHash}`,
    );

    res.status(200).json({
      success: true,
      data: txHash,
    });
    // return new Response("Webhook received!", { status: 200 });
  } catch (e: any) {
    console.error('Error processing webhook:', e.message);
    res.status(400).json({
      success: false,
      error: 'error',
    });
  }
};

// to get user and their agents details
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
      SELECT 
        u.user_id,
        u.email,
        w.organization_id,
        w.sign_with,
        w.id as wallet_id,
        json_agg(
          CASE WHEN a.id IS NOT NULL 
          THEN json_build_object(
            'name', a.name,
            'address', a.address,
            'saltNonce', a.salt_nonce
          )
          ELSE NULL 
          END
        ) FILTER (WHERE a.id IS NOT NULL) as agents
      FROM users u
      LEFT JOIN wallets w ON u.user_id = w.user_id
      LEFT JOIN agents a ON w.id = a.wallet_id
      JOIN api_keys ak ON u.id = ak.user_id
      WHERE u.user_id = $1 AND ak.active = true
      GROUP BY u.user_id, u.email, w.organization_id, w.sign_with, w.id
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
          signWith: user.sign_with,
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

//to get wallet details with agentName and APIkey to be used in the SDK for initializing the smart account client
export const GetWalletDetails = async (
  req: Request,
  res: Response,
): Promise<any> => {
  console.log('GetWalletDetails called');
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

    // Find wallet by API key
    const wallet = await WalletModel.findByApiKey(apiKey as string);
    if (!wallet) {
      return res.status(404).json({
        success: false,
        error: 'No wallet found for the provided API key',
      });
    }

    // Find the specific agent
    const agent = wallet.agents.find((a: any) => a.name === agentName);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'No agent found with the provided name',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        organization_id: wallet.organization_id,
        sign_with: wallet.sign_with,
        agent: {
          name: agent.name,
          address: agent.address,
          saltNonce: agent.saltNonce,
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

export const GetSdkConfig = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    console.log('GetSdkConfig called');
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

// Check if user exists by address
export const CheckUserExists = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const { address } = req.query;

    if (!address || typeof address !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid address is required',
      });
    }

    const userQuery = `
      SELECT 
        u.user_id,
        u.email
      FROM users u
      WHERE u.user_id = $1
      LIMIT 1
    `;

    const userResult = await pool.query(userQuery, [address]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(200).json({
        success: true,
        exists: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      exists: true,
      data: {
        address: user.user_id,
        email: user.email,
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

// Get all API keys for a user by address
export const GetUserApiKeys = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const { address } = req.query;

    if (!address || typeof address !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid address is required',
      });
    }

    const apiKeysQuery = `
      SELECT 
        ak.hashed_key,
        ak.created_at,
        ak.expires_at,
        ak.active,
        ak.usage_count,
        ak.max_usage,
        ak.subscription_type
      FROM users u
      JOIN api_keys ak ON u.id = ak.user_id
      WHERE u.user_id = $1
      ORDER BY ak.created_at DESC
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
          hashedKey: key.hashed_key,
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
