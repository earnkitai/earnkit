import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPublicClient } from '@/lib/web3';
import { keccak256, encodePacked, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import earnkitABI from '@/contract/earnkit_ABI.json';
import { type Abi } from 'viem';

// Contract address from environment variable
const CONTRACT_ADDRESS =
  process.env.ESCROW_CONTRACT_ADDRESS ||
  '0xCAeB6A62D04C52E1e196E5Bdce63e43f45582aA2';

// Contract ABI for withdrawal functions
const CONTRACT_ABI = earnkitABI as unknown as Abi;

// EIP-712 Domain for withdrawal authorization
// MUST match contract: _NAME_HASH = keccak256('AgentEscrow')
const EIP712_DOMAIN = {
  name: 'AgentEscrow',
  version: '1',
  chainId: 8453, // Base
  verifyingContract: CONTRACT_ADDRESS as `0x${string}`,
};

// EIP-712 Types for ETH withdrawal authorization (matches contract exactly)
// Contract: 'Withdraw(bytes32 agentId,uint256 amount,address to,uint256 nonce,uint256 deadline)'
const EIP712_TYPES_ETH = {
  Withdraw: [
    { name: 'agentId', type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
    { name: 'to', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

// EIP-712 Types for token withdrawal authorization (matches contract exactly)
// Contract: 'WithdrawToken(bytes32 agentId,address token,uint256 amount,address to,uint256 nonce,uint256 deadline)'
const EIP712_TYPES_TOKEN = {
  WithdrawToken: [
    { name: 'agentId', type: 'bytes32' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'to', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

interface WithdrawRequest {
  amount: string; // Amount to withdraw (USD for ETH, raw amount for tokens)
  toAddress: string; // Recipient address
  tokenAddress?: string; // Optional: token address for token withdrawals
  tokenSymbol?: string; // Optional: token symbol for token withdrawals
}

// Function to generate EIP-712 signature for ETH withdrawal
async function generateWithdrawalSignature(
  agentIdHash: `0x${string}`,
  amount: bigint,
  to: `0x${string}`,
  deadline: bigint,
  nonce: bigint,
  privateKey: `0x${string}`,
): Promise<{ v: number; r: `0x${string}`; s: `0x${string}` }> {
  const account = privateKeyToAccount(privateKey);
  console.log('Signing ETH withdrawal with account:', account.address);
  
  const message = {
    agentId: agentIdHash,
    amount: amount,
    to: to,
    nonce: nonce,
    deadline: deadline,
  };

  // Sign the EIP-712 message
  const signature = await account.signTypedData({
    domain: EIP712_DOMAIN,
    types: EIP712_TYPES_ETH,
    primaryType: 'Withdraw',
    message: message,
  });

  // Parse the signature
  const sig = signature.slice(2);
  const r = `0x${sig.slice(0, 64)}` as `0x${string}`;
  const s = `0x${sig.slice(64, 128)}` as `0x${string}`;
  const v = parseInt(sig.slice(128, 130), 16);

  return { v, r, s };
}

// Function to generate EIP-712 signature for token withdrawal
async function generateTokenWithdrawalSignature(
  agentIdHash: `0x${string}`,
  tokenAddress: `0x${string}`,
  amount: bigint,
  to: `0x${string}`,
  deadline: bigint,
  nonce: bigint,
  privateKey: `0x${string}`,
): Promise<{ v: number; r: `0x${string}`; s: `0x${string}` }> {
  const account = privateKeyToAccount(privateKey);
  console.log('Signing token withdrawal with account:', account.address);
  
  const message = {
    agentId: agentIdHash,
    token: tokenAddress,
    amount: amount,
    to: to,
    nonce: nonce,
    deadline: deadline,
  };

  // Sign the EIP-712 message
  const signature = await account.signTypedData({
    domain: EIP712_DOMAIN,
    types: EIP712_TYPES_TOKEN,
    primaryType: 'WithdrawToken',
    message: message,
  });

  // Parse the signature
  const sig = signature.slice(2);
  const r = `0x${sig.slice(0, 64)}` as `0x${string}`;
  const s = `0x${sig.slice(64, 128)}` as `0x${string}`;
  const v = parseInt(sig.slice(128, 130), 16);

  return { v, r, s };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolvedParams = await params;
    const agentId = resolvedParams.id;

    if (!agentId) {
      return NextResponse.json(
        { error: 'Agent ID is required' },
        { status: 400 },
      );
    }

    const body: WithdrawRequest = await request.json();
    const { amount, toAddress, tokenAddress, tokenSymbol } = body;

    if (!amount || !toAddress) {
      return NextResponse.json(
        { error: 'Amount and recipient address are required' },
        { status: 400 },
      );
    }

    const isTokenWithdrawal = !!tokenAddress;

    // Get agent details with user's wallet address
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        agentId: true,
        userId: true,
        splitAddress: true,
        user: {
          select: {
            walletAccounts: {
              select: {
                address: true,
              },
              take: 1,
            },
          },
        },
      },
    });

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Splits mode: permissionless distribute() — no private key needed server-side
    if (agent.splitAddress) {
      return NextResponse.json({
        success: true,
        withdrawalMode: 'splits',
        splitAddress: agent.splitAddress,
        message:
          'Call distribute() on your Split contract to push funds to your wallet. ' +
          'Use the Splits SDK or BaseScan with the split address below.',
      });
    }

    // Get user's wallet address
    const userWalletAddress = agent.user.walletAccounts[0]?.address;
    if (!userWalletAddress) {
      return NextResponse.json(
        {
          error:
            'User wallet address not found. Please connect a wallet first.',
        },
        { status: 400 },
      );
    }

    const publicClient = getPublicClient('base');
    const agentIdHash = keccak256(encodePacked(['string'], [agent.agentId]));

    // Get platform wallet private key from environment
    const platformPrivateKey = process.env.PLATFORM_WALLET_PRIVATE_KEY;
    if (!platformPrivateKey) {
      return NextResponse.json(
        { error: 'Platform wallet private key not configured' },
        { status: 500 },
      );
    }

    // Ensure private key is properly formatted
    let formattedPrivateKey: `0x${string}`;
    if (platformPrivateKey.startsWith('0x')) {
      formattedPrivateKey = platformPrivateKey as `0x${string}`;
    } else {
      formattedPrivateKey = `0x${platformPrivateKey}` as `0x${string}`;
    }

    // Validate private key format
    if (formattedPrivateKey.length !== 66) {
      return NextResponse.json(
        {
          error:
            'Invalid private key format. Must be 64 hex characters with 0x prefix.',
        },
        { status: 400 },
      );
    }

    // Get the developer address from the private key (this is who signs)
    const signerAccount = privateKeyToAccount(formattedPrivateKey);
    const developerAddress = signerAccount.address;
    
    console.log('Developer/Signer address:', developerAddress);

    // Verify this is the correct developer for the agent
    try {
      const agentDeveloper = (await publicClient.readContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: CONTRACT_ABI,
        functionName: 'developerOf',
        args: [agentIdHash],
      })) as `0x${string}`;
      
      console.log('On-chain agent developer:', agentDeveloper);
      
      if (agentDeveloper.toLowerCase() !== developerAddress.toLowerCase()) {
        return NextResponse.json(
          {
            error: 'Platform wallet is not the developer of this agent',
            platformWallet: developerAddress,
            agentDeveloper,
          },
          { status: 403 },
        );
      }
    } catch (err) {
      console.error('Error verifying agent developer:', err);
      return NextResponse.json(
        { error: 'Unable to verify agent developer on-chain' },
        { status: 400 },
      );
    }

    // Get the current nonce for the DEVELOPER (signer) from the contract
    const currentNonce = (await publicClient.readContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: CONTRACT_ABI,
      functionName: 'nonces',
      args: [developerAddress as `0x${string}`],
    })) as bigint;
    
    console.log('Developer nonce:', currentNonce.toString());

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now

    try {
      if (isTokenWithdrawal) {
        // TOKEN WITHDRAWAL FLOW
        const { parseUnits, formatUnits } = await import('viem');
        
        // Parse token amount (amount is raw token amount, not USD)
        const tokenAmount = parseFloat(amount);
        
        console.log('Token withdrawal request:', {
          rawAmount: amount,
          parsedAmount: tokenAmount,
        });

        // Get current token balance from contract FIRST
        let currentTokenBalance: bigint;
        try {
          currentTokenBalance = (await publicClient.readContract({
            address: CONTRACT_ADDRESS as `0x${string}`,
            abi: CONTRACT_ABI,
            functionName: 'agentTokenBalance',
            args: [agentIdHash, tokenAddress as `0x${string}`],
          })) as unknown as bigint;
        } catch (err) {
          console.error('Error fetching token balance:', err);
          currentTokenBalance = BigInt(0);
        }

        console.log('Current token balance (wei):', currentTokenBalance.toString());
        
        const currentTokenBalanceFormatted = Number(formatUnits(currentTokenBalance, 18));
        console.log('Current token balance (formatted):', currentTokenBalanceFormatted);

        // Use the actual on-chain balance if user requested max (within 0.01% tolerance)
        let tokenAmountWei: bigint;
        const tolerance = currentTokenBalanceFormatted * 0.0001; // 0.01% tolerance
        
        if (Math.abs(tokenAmount - currentTokenBalanceFormatted) < tolerance || tokenAmount >= currentTokenBalanceFormatted) {
          // User wants max - use exact on-chain balance
          tokenAmountWei = currentTokenBalance;
          console.log('Using exact on-chain balance for max withdrawal');
        } else {
          // Parse the requested amount
          try {
            const roundedAmount = tokenAmount.toFixed(6);
            tokenAmountWei = parseUnits(roundedAmount, 18);
          } catch {
            tokenAmountWei = parseUnits(Math.floor(tokenAmount).toString(), 18);
          }
        }

        console.log('Token amount to withdraw (wei):', tokenAmountWei.toString());

        // Compare using BigInt to avoid precision loss
        if (tokenAmountWei > currentTokenBalance) {
          return NextResponse.json(
            {
              error: 'Insufficient token balance',
              currentBalance: currentTokenBalanceFormatted,
              requestedAmount: tokenAmount,
              requestedWei: tokenAmountWei.toString(),
              balanceWei: currentTokenBalance.toString(),
            },
            { status: 400 },
          );
        }

        // Calculate fee (use same fee structure as ETH)
        const platformFeeBps = (await publicClient.readContract({
          address: CONTRACT_ADDRESS as `0x${string}`,
          abi: CONTRACT_ABI,
          functionName: 'platformFeeBps',
        })) as number;

        const fee = (tokenAmount * platformFeeBps) / 10000;
        const net = tokenAmount - fee;

        // Generate EIP-712 signature for token withdrawal
        const signature = await generateTokenWithdrawalSignature(
          agentIdHash,
          tokenAddress as `0x${string}`,
          tokenAmountWei,
          toAddress as `0x${string}`,
          deadline,
          currentNonce,
          formattedPrivateKey,
        );

        // Return signature data for frontend to execute
        return NextResponse.json({
          success: true,
          isTokenWithdrawal: true,
          signature: {
            v: signature.v,
            r: signature.r,
            s: signature.s,
          },
          withdrawal: {
            agentId: agentIdHash,
            tokenAddress: tokenAddress,
            tokenSymbol: tokenSymbol || 'TOKEN',
            amount: tokenAmountWei.toString(),
            to: toAddress,
            deadline: deadline.toString(),
            totalAmount: tokenAmount,
            fee: fee,
            net: net,
            recipient: toAddress,
          },
          message: 'Token withdrawal signature generated',
        });
      } else {
        // ETH WITHDRAWAL FLOW
        const { priceService } = await import('@/lib/priceService');
        let ethPrice: number;
        try {
          ethPrice = await priceService.getEthPrice();
        } catch (error) {
          console.error('Error getting ETH price:', error);
          ethPrice = 3000; // Fallback price
        }

        // Convert USD amount to ETH
        const usdAmount = parseFloat(amount);
        const ethAmount = usdAmount / ethPrice;
        const ethAmountWei = parseEther(ethAmount.toString());

        // Get current ETH balance from contract
        const currentBalance = (await publicClient.readContract({
          address: CONTRACT_ADDRESS as `0x${string}`,
          abi: CONTRACT_ABI,
          functionName: 'agentBalance',
          args: [agentIdHash],
        })) as unknown as bigint;

        const currentBalanceEth = Number(formatEther(currentBalance));
        const requestedBalanceEth = ethAmount;

        // Check if agent has sufficient balance
        if (requestedBalanceEth > currentBalanceEth) {
          return NextResponse.json(
            {
              error: 'Insufficient balance',
              currentBalance: currentBalanceEth,
              requestedAmount: requestedBalanceEth,
            },
            { status: 400 },
          );
        }

        const platformFeeBps = BigInt(
          Number(await publicClient.readContract({
            address: CONTRACT_ADDRESS as `0x${string}`,
            abi: CONTRACT_ABI,
            functionName: 'platformFeeBps',
          })),
        );
        const feeWei = (ethAmountWei * platformFeeBps) / BigInt(10000);
        const netWei = ethAmountWei - feeWei;
        const feeEth = Number(formatEther(feeWei));
        const netEth = Number(formatEther(netWei));
        const feeUsd = feeEth * ethPrice;
        const netUsd = netEth * ethPrice;

        // Generate EIP-712 signature for ETH withdrawal
        const signature = await generateWithdrawalSignature(
          agentIdHash,
          ethAmountWei,
          toAddress as `0x${string}`,
          deadline,
          currentNonce,
          formattedPrivateKey,
        );

        // Return signature data for frontend to execute
        return NextResponse.json({
          success: true,
          isTokenWithdrawal: false,
          signature: {
            v: signature.v,
            r: signature.r,
            s: signature.s,
          },
          withdrawal: {
            agentId: agentIdHash,
            amount: ethAmountWei.toString(),
            to: toAddress,
            deadline: deadline.toString(),
            totalAmount: {
              eth: ethAmount,
              usd: usdAmount,
            },
            fee: {
              eth: feeEth,
              usd: feeUsd,
            },
            net: {
              eth: netEth,
              usd: netUsd,
            },
            recipient: toAddress,
          },
          message: 'Signature generated',
        });
      }
    } catch (error) {
      console.error('Error executing withdrawal:', error);
      return NextResponse.json(
        { error: 'Failed to execute withdrawal transaction' },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error('Error processing withdrawal request:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
