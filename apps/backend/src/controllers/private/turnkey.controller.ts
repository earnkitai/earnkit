import { Request, Response } from 'express';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import neynarClient from '../../utils/neynarClient';
import mintToken from '../../utils/deployToken';
// import { NeynarFrameCreationRequest } from "@neynar/nodejs-sdk";
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { toSafeSmartAccount } from 'permissionless/accounts'; // using permissionless.js for safe accounts
import {
  Hex,
  createPublicClient,
  createWalletClient,
  getContract,
  http,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
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
import { createClient } from '../../utils/smartAccountClient';
import crypto from 'crypto';

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://sepolia.base.org'),
});

const apiPrivateKey = process.env.ORG_PRIVATE_KEY;
const apiPublicKey = process.env.ORG_PUBLIC_KEY;
const pimlocoApiKey = process.env.PIMLICO_API_KEY;
const orgId = process.env.ORG_ID;

// Ensure the keys are defined
if (!apiPrivateKey || !apiPublicKey) {
  throw new Error(
    'API keys are missing. Please set ORG_PRIVATE_KEY and ORG_PUBLIC_KEY in your environment variables.',
  );
}
if (!pimlocoApiKey) throw new Error('Missing PIMLICO_API_KEY');

const turnkeyServer = new Turnkey({
  apiBaseUrl: 'https://api.turnkey.com',
  apiPrivateKey: apiPrivateKey,
  apiPublicKey: apiPublicKey,
  defaultOrganizationId: orgId as string,
}).apiClient();

// to register a new dev and create a wallet
export const CreateAIAgent = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const { apiKey, agentName } = req.body;

    if (!apiKey || !agentName) {
      return res.status(400).json({
        success: false,
        error: 'API key and agent name are required',
      });
    }

    // Get user details
    const userQuery = `
      SELECT u.user_id, u.email
      FROM users u
      JOIN api_keys ak ON u.id = ak.user_id
      WHERE ak.hashed_key = $1 AND ak.active = true
    `;
    const hashedApiKey = crypto
      .createHash('sha256')
      .update(apiKey)
      .digest('hex');
    const userResult = await pool.query(userQuery, [hashedApiKey]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'No user found with the provided API key',
      });
    }

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
              publicKey: process.env.ORG_PUBLIC_KEY as string,
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
    });

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

// to create a new AI agent wallet
export const CreateNewAIAgentWallet = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    if (!apiPrivateKey || !apiPublicKey) {
      throw new Error(
        'API keys are missing. Please set ORG_PRIVATE_KEY and ORG_PUBLIC_KEY in your environment variables.',
      );
    }

    const { apiKey, agentName } = req.body;

    if (!apiKey || !agentName) {
      return res.status(400).json({
        success: false,
        error: 'API key and agent name are required',
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
    if (!apiPrivateKey || !apiPublicKey) {
      throw new Error(
        'API keys are missing. Please set ORG_PRIVATE_KEY and ORG_PUBLIC_KEY in your environment variables.',
      );
    }

    const { apiKey, agentName, name, symbol, ownerAddress, tokenImage } =
      req.body;

    console.log('API called by the AI Agent');
    console.log(apiKey, agentName, name, symbol, ownerAddress, tokenImage);

    if (!apiKey && !agentName) {
      return res.status(400).json({
        success: false,
        error: 'API key and agent name are required',
      });
    }

    const wallet = await WalletModel.findByApiKey(apiKey);
    if (!wallet) {
      return res.status(404).json({
        success: false,
        error: 'No wallet found for the provided API key',
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

    console.log('Wallet and agent found:', { wallet, agent }); // Debug log

    if (!wallet.sign_with) {
      return res.status(400).json({
        success: false,
        error: 'Wallet has no sign_with value',
      });
    }

    const turnkeyServer = new Turnkey({
      apiBaseUrl: 'https://api.turnkey.com',
      apiPrivateKey: apiPrivateKey,
      apiPublicKey: apiPublicKey,
      defaultOrganizationId: wallet.organization_id,
    }).apiClient();

    const turnkeyAccount = await createAccount({
      client: turnkeyServer,
      organizationId: wallet.organization_id,
      signWith: wallet.sign_with,
    });

    console.log('created', turnkeyAccount);

    const pimlicoUrl = `https://api.pimlico.io/v2/84532/rpc?apikey=${pimlocoApiKey}`; // bundler URL

    const pimlicoClient = createPimlicoClient({
      // pimlico client
      transport: http(pimlicoUrl),
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
    });
    // console.log("salt", agent.saltnonce);
    const account = await toSafeSmartAccount({
      client: publicClient,
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
      owners: [turnkeyAccount],
      saltNonce: BigInt(agent.saltnonce), // Use stored salt
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

//Not in use as of now
export const CreateNewDevWallet = async (
  req: Request,
  res: Response,
): Promise<any> => {
  if (!apiPrivateKey || !apiPublicKey) {
    throw new Error(
      'API keys are missing. Please set ORG_PRIVATE_KEY and ORG_PUBLIC_KEY in your environment variables.',
    );
  }

  const { organizationId, walletName } = req.body;

  const turnkeyServer = new Turnkey({
    apiBaseUrl: 'https://api.turnkey.com',
    apiPrivateKey: apiPrivateKey,
    apiPublicKey: apiPublicKey,
    defaultOrganizationId: organizationId,
  }).apiClient();

  const walletResponse = await turnkeyServer.createWallet({
    walletName: walletName,
    accounts: DEFAULT_ETHEREUM_ACCOUNTS,
  });

  const accountAddress = walletResponse.addresses[0];

  console.log('wallet Created Sucessfully', accountAddress);
};

// to get user and their agents details
export const GetUserDetails = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const { email } = req.query;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid email is required',
      });
    }

    const userQuery = `
      SELECT 
        u.user_id,
        u.email,
        w.organization_id,
        w.sign_with,
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
      LEFT JOIN api_keys ak ON u.id = ak.user_id
      LEFT JOIN wallets w ON u.user_id = w.user_id
      LEFT JOIN agents a ON w.id = a.wallet_id
      WHERE u.email = $1 AND ak.active = true
      GROUP BY u.user_id, u.email, w.organization_id, w.sign_with
    `;

    const userResult = await pool.query(userQuery, [email]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'No user found with the provided email',
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

// to get smart account client for a specific agent
export const GetSmartAccountClient = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const { apiKey, agentName } = req.body;

    if (!apiKey || !agentName) {
      return res.status(400).json({
        success: false,
        error: 'API key and agent name are required',
      });
    }

    const wallet = await WalletModel.findByApiKey(apiKey as string);
    if (!wallet) {
      return res.status(404).json({
        success: false,
        error: 'No wallet found for the provided API key',
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
      apiPrivateKey: apiPrivateKey as string,
      apiPublicKey: apiPublicKey as string,
      defaultOrganizationId: wallet.organization_id,
    }).apiClient();

    const turnkeyAccount = await createAccount({
      client: turnkeyServer,
      organizationId: wallet.organization_id,
      signWith: wallet.sign_with,
    });

    const account = await toSafeSmartAccount({
      client: publicClient,
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
      owners: [turnkeyAccount],
      saltNonce: BigInt(agent.saltnonce),
      version: '1.4.1',
      address: agent.address as `0x${string}`,
    });

    return res.status(200).json({
      success: true,
      data: {
        config: {
          account: {
            address: account.address,
            entryPoint: account.entryPoint,
            owner: turnkeyAccount.address,
            saltNonce: agent.saltnonce,
          },
          wallet: {
            organizationId: wallet.organization_id,
            signWith: wallet.sign_with,
          },
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

// to execute transaction with provided smart account client
export const ExecuteTransactionWithClient = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const { config } = req.body;
    const smartAccountClient = await createClient(config);

    // Use the client for transaction
    const args: [string, string, bigint, `0x${string}`] = [
      'Earnkit',
      'EKT',
      BigInt(100000000 * 18),
      '0x362EEAa2584Ba571F7F853F39460b867d4588bb2' as `0x${string}`,
    ];
    const txHash = await smartAccountClient.sendTransaction({
      to: '0x362EEAa2584Ba571F7F853F39460b867d4588bb2',
      data: encodeFunctionData({
        abi: [
          parseAbiItem(
            'function createToken(string memory name, string memory symbol, uint256 initialSupply,address _ownerAddress)',
          ),
        ],
        functionName: 'createToken', // Comma added here
        args,
      }),
      value: BigInt(0),
    });

    res.status(201).json({
      success: true,
      data: { txHash },
    });
  } catch (e: any) {
    console.error('Error executing transaction:', e.message);
    res.status(400).json({
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
  try {
    const { apiKey, agentName } = req.query;
    console.log(apiKey, agentName);

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'API key is required',
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

    // Base response with wallet details
    const response = {
      wallet: {
        organizationId: wallet.organization_id,
        sign_with: wallet.sign_with,
      },
      agents: wallet.agents || [],
    };

    // If agentName is provided, validate and include specific agent details
    if (agentName) {
      const agent = wallet.agents.find((a: any) => a.name === agentName);
      if (!agent) {
        return res.status(404).json({
          success: false,
          error: 'No agent found with the provided name',
        });
      }
      response.agents = [agent];
    }

    return res.status(200).json({
      success: true,
      data: wallet,
    });
  } catch (e: any) {
    console.error('Error:', e.message);
    return res.status(400).json({
      success: false,
      error: e.message,
    });
  }
};
