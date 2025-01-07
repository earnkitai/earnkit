import { Request, Response } from 'express';
import 'dotenv/config';
import { toSafeSmartAccount } from 'permissionless/accounts';
import { Address, createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { Turnkey } from '@turnkey/sdk-server';
import { createAccount } from '@turnkey/viem';
import { entryPoint07Address } from 'viem/account-abstraction';
import { createSmartAccountClient } from 'permissionless';
import { encodeFunctionData } from 'viem';
import WalletModel from '../../models/wallet.model';
import { getApiKeyFromHeader } from '../../utils/GetHeaders';
import tokenABI from '../../utils/tokenABI.json';
import pool from '../../config/database';

const pimlocoApiKey = process.env.PIMLICO_API_KEY;
if (!pimlocoApiKey) throw new Error('Missing PIMLICO_API_KEY');

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://sepolia.base.org'),
});

export const ExecuteTransaction = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const apiKey = getApiKeyFromHeader(req);
    const { agentName } = req.query;
    const { name, symbol } = req.body;

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

    // Find the agent
    const agent = wallet.agents.find((a) => a.name === agentName);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'No agent found with the provided name',
      });
    }

    const turnkeyServer = new Turnkey({
      apiBaseUrl: 'https://api.turnkey.com',
      apiPrivateKey: wallet.privateKey,
      apiPublicKey: wallet.publicKey,
      defaultOrganizationId: wallet.organizationId,
    }).apiClient();

    const turnkeyAccount = await createAccount({
      client: turnkeyServer,
      organizationId: wallet.organizationId,
      signWith: wallet.ownerWalletAddress,
    });

    const pimlicoUrl = `https://api.pimlico.io/v2/84532/rpc?apikey=${pimlocoApiKey}`;
    const pimlicoClient = createPimlicoClient({
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
      saltNonce: BigInt(agent.saltNonce),
      version: '1.4.1',
      address: agent.walletAddress as `0x${string}`,
    });

    const smartAccountClient = createSmartAccountClient({
      account,
      chain: baseSepolia,
      bundlerTransport: http(pimlicoUrl),
      paymaster: pimlicoClient,
      userOperation: {
        estimateFeesPerGas: async () => {
          return (await pimlicoClient.getUserOperationGasPrice()).fast;
        },
      },
    });

    // Token deployment parameters
    const totalSupply = BigInt(100000000 * 10 ** 18); // 100M tokens with 18 decimals
    const initialTick = -230400;
    const poolFee = 10000; // 1% fee (10000 = 100%)

    // Generate salt for deployment
    const saltandAddress = await generateSalt(
      agent.walletAddress as `0x${string}`,
      name,
      symbol,
      totalSupply,
    );

    const salt = saltandAddress[0];
    const tokenContractAddress = saltandAddress[1];

    // Deploy token
    const txHash = await deployToken(
      smartAccountClient,
      name,
      symbol,
      totalSupply,
      initialTick,
      poolFee,
      agent.walletAddress as `0x${string}`,
      salt as `0x${string}`,
    );

    // Store token details
    const storeTokenQuery = `
      INSERT INTO deployed_tokens (
        agent_id,
        token_address,
        token_name,
        token_symbol
      ) VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    await pool.query(storeTokenQuery, [
      agent.id,
      tokenContractAddress,
      name,
      symbol,
    ]);

    return res.status(200).json({
      success: true,
      data: {
        transactionHash: txHash,
        tokenDetails: {
          name,
          symbol,
          totalSupply: totalSupply.toString(),
          owner: agent.walletAddress,
          tokenAddress: tokenContractAddress,
        },
      },
    });
  } catch (error: any) {
    console.error('Error deploying token:', error);
    return res.status(400).json({
      success: false,
      error: error.message || 'Failed to deploy token',
    });
  }
};

const generateSalt = async (
  deployer: `0x${string}`,
  name: string,
  symbol: string,
  supply: bigint,
): Promise<`0x${string}`> => {
  const salt = await publicClient.readContract({
    address: '0x527d044c74E48420815Cf9328f03B7471440D979',
    abi: tokenABI,
    functionName: 'generateSalt',
    args: [deployer, name, symbol, supply],
  });
  return salt as `0x${string}`;
};

const deployToken = async (
  smartAccountClient: any,
  name: string,
  symbol: string,
  totalSupply: bigint,
  initialTick: number,
  poolFee: number,
  deployer: `0x${string}`,
  salt: `0x${string}`,
): Promise<`0x${string}`> => {
  const txHash = await smartAccountClient.sendTransaction({
    to: '0x527d044c74E48420815Cf9328f03B7471440D979',
    data: encodeFunctionData({
      abi: tokenABI,
      functionName: 'deployToken',
      args: [name, symbol, totalSupply, initialTick, poolFee, salt, deployer],
    }),
    value: BigInt(0),
  });
  return txHash;
};
