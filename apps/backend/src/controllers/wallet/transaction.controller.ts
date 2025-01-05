import { Request, Response } from 'express';
import 'dotenv/config';
import { toSafeSmartAccount } from 'permissionless/accounts'; // using permissionless.js for safe accounts
import { createPublicClient, http } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { Turnkey } from '@turnkey/sdk-server';
import { createAccount } from '@turnkey/viem';

import { entryPoint07Address } from 'viem/account-abstraction';
import { createSmartAccountClient } from 'permissionless';
import { parseAbiItem, encodeFunctionData } from 'viem';
import WalletModel from '../../models/wallet.model';
import { getApiKeyFromHeader } from '../../utils/GetHeaders';

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://sepolia.base.org'),
});

const pimlocoApiKey = process.env.PIMLICO_API_KEY;

if (!pimlocoApiKey) throw new Error('Missing PIMLICO_API_KEY');

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

    if (!wallet.ownerWalletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet has no ownerWalletAddress value',
      });
    }

    const turnkeyServer = new Turnkey({
      apiBaseUrl: 'https://api.turnkey.com',
      apiPrivateKey: keys.private_key,
      apiPublicKey: keys.public_key,
      defaultOrganizationId: wallet.organizationId,
    }).apiClient();

    const turnkeyAccount = await createAccount({
      client: turnkeyServer,
      organizationId: wallet.organizationId,
      signWith: wallet.ownerWalletAddress,
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
      address: agent.walletAddress as `0x${string}`,
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
