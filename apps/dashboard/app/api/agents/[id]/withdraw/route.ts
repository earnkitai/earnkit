import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPublicClient } from '@/lib/web3';
import { keccak256, encodePacked, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import earnkitABI from '@/contract/earnkit_new_ABI.json';
import { type Abi } from 'viem';

// Contract address from environment variable
const CONTRACT_ADDRESS =
  process.env.ESCROW_CONTRACT_ADDRESS ||
  '0x8076E4444D6AE75396Dcf1E201Dbc6a4cd01FDC8';

// Contract ABI for withdrawal functions
const CONTRACT_ABI = earnkitABI as unknown as Abi;

// EIP-712 Domain for withdrawal authorization
const EIP712_DOMAIN = {
  name: 'EarnKitAgentVault',
  version: '1',
  chainId: 8453, // Base
  verifyingContract: CONTRACT_ADDRESS as `0x${string}`,
};

// EIP-712 Types for withdrawal authorization (matches contract exactly)
const EIP712_TYPES = {
  Withdraw: [
    { name: 'agentId', type: 'bytes32' },
    { name: 'developer', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

interface WithdrawRequest {
  amount: string; // USD amount to withdraw
  toAddress: string; // Recipient address
}

// Function to generate EIP-712 signature for withdrawal
async function generateWithdrawalSignature(
  agentIdHash: `0x${string}`,
  amount: bigint,
  developer: `0x${string}`,
  to: `0x${string}`,
  deadline: bigint,
  nonce: bigint,
  privateKey: `0x${string}`,
): Promise<{ v: number; r: `0x${string}`; s: `0x${string}` }> {
  const account = privateKeyToAccount(privateKey);
  console.log('account', account);
  const message = {
    agentId: agentIdHash,
    developer: developer,
    to: to,
    amount: amount,
    nonce: nonce,
    deadline: deadline,
  };

  // Sign the EIP-712 message
  const signature = await account.signTypedData({
    domain: EIP712_DOMAIN,
    types: EIP712_TYPES,
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
    const { amount, toAddress } = body;

    if (!amount || !toAddress) {
      return NextResponse.json(
        { error: 'Amount and recipient address are required' },
        { status: 400 },
      );
    }

    // Get agent details with user's wallet address
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        agentId: true,
        userId: true,
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

    // Get current ETH price for conversion
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

    // Get current agent balance from contract
    const publicClient = getPublicClient('base');
    const agentIdHash = keccak256(encodePacked(['string'], [agent.agentId]));

    let currentBalance: bigint;
    try {
      currentBalance = (await publicClient.readContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: CONTRACT_ABI,
        functionName: 'getAgentBalance',
        args: [agentIdHash],
      })) as unknown as bigint;
    } catch {
      // Fallback to agentBalance mapping
      currentBalance = (await publicClient.readContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: CONTRACT_ABI,
        functionName: 'agentBalance',
        args: [agentIdHash],
      })) as unknown as bigint;
    }

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

    // Get withdrawal quote (fee calculation)
    const quote = (await publicClient.readContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: CONTRACT_ABI,
      functionName: 'quoteWithdrawal',
      args: [ethAmountWei],
    })) as [bigint, bigint];

    const [feeWei, netWei] = quote;
    const feeEth = Number(formatEther(feeWei));
    const netEth = Number(formatEther(netWei));
    const feeUsd = feeEth * ethPrice;
    const netUsd = netEth * ethPrice;

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

    // Get the current nonce for this developer from the contract
    const publicClientForNonce = getPublicClient('base');
    const currentNonce = (await publicClientForNonce.readContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: CONTRACT_ABI,
      functionName: 'nonces',
      args: [userWalletAddress as `0x${string}`],
    })) as bigint;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now

    try {
      // Generate EIP-712 signature
      const signature = await generateWithdrawalSignature(
        agentIdHash,
        ethAmountWei,
        userWalletAddress as `0x${string}`, // Developer address (user's wallet)
        toAddress as `0x${string}`, // Recipient address (user enters this)
        deadline,
        currentNonce,
        formattedPrivateKey,
      );

      // Return signature data for frontend to execute
      return NextResponse.json({
        success: true,
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
