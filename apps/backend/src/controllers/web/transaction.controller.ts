import { Request, Response } from 'express';
import 'dotenv/config';
import { toSafeSmartAccount } from 'permissionless/accounts';
import { Address, createClient, createPublicClient, http } from 'viem';
import { baseSepolia, mainnet, sepolia } from 'viem/chains';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { Turnkey } from '@turnkey/sdk-server';
import { createAccount } from '@turnkey/viem';
import {
  createBundlerClient,
  entryPoint07Address,
} from 'viem/account-abstraction';

import { createSmartAccountClient } from 'permissionless';
import { encodeFunctionData } from 'viem';
import WalletModel from '../../models/wallet.model';
import { getApiKeyFromHeader } from '../../utils/GetHeaders';
import tokenABI from '../../utils/tokenABI.json';
import pool from '../../config/database';
import { privateKeyToAccount } from 'viem/accounts';
import LPLocker__factory from '../../utils/LPLockerABI.json';
import { useReadContract } from 'wagmi';
import { ethers } from 'ethers';
import { useWaitForTransactionReceipt } from 'wagmi';
import axios from 'axios';

interface TokenDetails {
  name: string;
  tokenAddress: string;
  symbol: string;
  tokenSupply: string;
  lpLockerAddress: string;
  imageUrl?: string;
  ownerAddress: string;
}

const storeInCoinvise = async (tokenDetails: TokenDetails): Promise<void> => {
  try {
    if (!process.env.COINVISE_API_KEY) {
      throw new Error('Missing COINVISE_API_KEY environment variable');
    }

    await axios.post(
      'https://api-staging.coinvise.co/token?chain=8453',
      {
        name: tokenDetails.name,
        address: tokenDetails.tokenAddress,
        symbol: tokenDetails.symbol,
        decimals: 18,
        tokenSupply: tokenDetails.tokenSupply,
        slope: 'null',
        slopeDecimals: 'null',
        type: 'ERC20',
        description: 'Deployed by Earnkit AI Agent',
        imageUrl: tokenDetails.imageUrl || '',
        lpLockerAddress: tokenDetails.lpLockerAddress,
      },
      {
        headers: {
          'x-api-key': process.env.COINVISE_API_KEY,
          'X-Authenticated-User': '0x97861976283e6901b407D1e217B72c4007D9F64D',
          'Content-Type': 'application/json',
        },
      },
    );
    console.log('Token details stored in Coinvise successfully');
  } catch (error) {
    console.error('Error storing token details in Coinvise:', error);
    throw error;
  }
};

const pimlocoApiKey = process.env.PIMLICO_API_KEY;
if (!pimlocoApiKey) throw new Error('Missing PIMLICO_API_KEY');

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://sepolia.base.org'),
});

export const DeployAgentToken = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const userAddress = req.user?.address;
    const { agentWalletAddress } = req.query;
    const { name, symbol } = req.body;

    if (!agentWalletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Agent wallet address is required',
      });
    }

    const wallet = await WalletModel.findByUserAddress(userAddress!);
    if (!wallet) {
      return res.status(404).json({
        success: false,
        error: 'No wallet found for this user',
      });
    }

    // Find the agent by wallet address instead of name
    const agent = wallet.agents.find(
      (a) => a.walletAddress === agentWalletAddress,
    );
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'No agent found with the provided wallet address',
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

    const privateKey =
      '0xefbf9ccef244f4e0e89592ada8c9b90a4cbdbadfa965222bdc6b84192a5aa29f';

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
      saltNonce: BigInt(agent.saltNonce),
      owners: [privateKeyToAccount(privateKey)],
      address: agent.walletAddress as `0x${string}`,
      // owners: [turnkeyAccount],
      version: '1.4.1',
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

    const provider = new ethers.JsonRpcProvider('https://sepolia.base.org');

    const contract = new ethers.Contract(
      '0x527d044c74E48420815Cf9328f03B7471440D979',
      LPLocker__factory,
      provider,
    );

    const receipt = await provider.getTransactionReceipt(txHash);
    console.log(receipt);

    if (receipt === null) {
      console.error('Transaction receipt not found.');
      return;
    }

    if ('logs' in receipt && Array.isArray(receipt.logs)) {
      // Parse logs
      const parsedLogs = (receipt.logs as any[])
        .map((log) => {
          try {
            return contract.interface.parseLog(log);
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean); // Remove null values

      // Process logs
      for (const log of parsedLogs) {
        if (log?.name === 'TokenCreated') {
          const tokenCreatedArgs = log.args;
          const lpNftId = tokenCreatedArgs[1]; // BigInt
          const lockerAddress = tokenCreatedArgs[6];

          // Store token details in Coinvise
          // try {
          //   await storeInCoinvise({
          //     name,
          //     tokenAddress: tokenContractAddress,
          //     symbol,
          //     tokenSupply: totalSupply.toString(),
          //     lpLockerAddress: lockerAddress,
          //     ownerAddress: agent.walletAddress,
          //   });
          // } catch (error) {
          //   console.error('Failed to store token in Coinvise:', error);
          // }

          const storeTokenQuery = `
        INSERT INTO deployed_tokens (
          agent_id,
          token_address,
          token_name,
          token_symbol,
          locker_address,
          token_id
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
          pool.query(storeTokenQuery, [
            agent.id,
            tokenContractAddress,
            name,
            symbol,
            lockerAddress,
            lpNftId.toString(),
          ]);
        }
      }
    }

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

export const claimFees = async (req: Request, res: Response): Promise<any> => {
  try {
    const userAddress = req.user?.address;
    // const poolAddress = '0xfffc9CF664eFbC1ea2DAdCa1957254668A43bbc3';
    // const tokenId = 8618;
    const { agentWalletAddress } = req.query;
    const { lockerAddress, tokenId } = req.body;

    if (!agentWalletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Agent wallet address is required',
      });
    }

    const wallet = await WalletModel.findByUserAddress(userAddress!);
    if (!wallet) {
      return res.status(404).json({
        success: false,
        error: 'No wallet found for this user',
      });
    }

    // console.log('Wallet agents:', wallet.agents); // Debugging: Ensure agents are retrieved

    // Safely find the agent
    const agent = wallet.agents?.find(
      (a) => a.walletAddress === agentWalletAddress,
    );

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'No agent found with the provided wallet address',
      });
    }

    console.log('Agent:', agent); // Debugging: Ensure agent is found

    // Remaining logic...
    const turnkeyServer = new Turnkey({
      apiBaseUrl: 'https://api.turnkey.com',
      apiPrivateKey: wallet.privateKey,
      apiPublicKey: wallet.publicKey,
      defaultOrganizationId: wallet.organizationId,
    }).apiClient();

    const privateKey =
      '0xefbf9ccef244f4e0e89592ada8c9b90a4cbdbadfa965222bdc6b84192a5aa29f';

    const pimlicoUrl = `https://api.pimlico.io/v2/84532/rpc?apikey=${pimlocoApiKey}`;
    const pimlicoClient = createPimlicoClient({
      transport: http(pimlicoUrl),
      entryPoint: {
        address: entryPoint07Address!,
        version: '0.7',
      },
    });

    console.log('agent', agent);
    const account = await toSafeSmartAccount({
      client: publicClient,
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
      saltNonce: BigInt(agent.saltNonce),
      owners: [privateKeyToAccount(privateKey)],
      address: agent.walletAddress as `0x${string}`,
      // owners: [turnkeyAccount],
      version: '1.4.1',
    });

    console.log('agent address:', agent.walletAddress, account.address);

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

    const collectFeesAbi = [
      {
        inputs: [
          {
            internalType: 'address',
            name: '_recipient',
            type: 'address',
          },
          {
            internalType: 'uint256',
            name: '_tokenId',
            type: 'uint256',
          },
        ],
        name: 'collectFees',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ];

    // const transaction = await smartAccountClient.sendTransaction({
    //   to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    //   value: 0n,
    //   data: '0x1234',
    // });
    const transaction = await smartAccountClient.sendTransaction({
      to: lockerAddress as `0x${string}`,
      data: encodeFunctionData({
        abi: collectFeesAbi,
        functionName: 'collectFees',
        args: [agentWalletAddress, tokenId],
      }),
    });

    console.log('Transaction:', transaction);

    return res.status(200).json({
      success: true,
      data: {
        transactionHash: transaction,
        message: 'Successfully claimed fees',
      },
    });
  } catch (error: any) {
    console.error('Error claiming fees:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to claim fees',
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

export const storeTokenDetails = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const {
      name,
      tokenAddress,
      symbol,
      tokenSupply,
      lpLockerAddress,
      tokenImage,
      ownerAddress,
    } = req.body;

    await storeInCoinvise({
      name,
      tokenAddress,
      symbol,
      tokenSupply,
      lpLockerAddress,
      imageUrl: tokenImage,
      ownerAddress,
    });

    return res.status(200).json({
      success: true,
      message: 'Token details stored successfully',
    });
  } catch (error: any) {
    console.error('Error storing token details:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to store token details',
    });
  }
};
