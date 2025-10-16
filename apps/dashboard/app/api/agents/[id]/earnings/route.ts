import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPublicClient } from '@/lib/web3';
import { keccak256, encodePacked, type Abi } from 'viem';
import earnkitABI from '@/contract/earnkit_ABI.json';

// Use latest contract ABI copied into the dashboard app
const CONTRACT_ABI = earnkitABI as unknown as Abi;

// Contract address from environment variable
const CONTRACT_ADDRESS =
  process.env.ESCROW_CONTRACT_ADDRESS ||
  '0x8076E4444D6AE75396Dcf1E201Dbc6a4cd01FDC8';

export async function GET(
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

    // Get agent details
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        agentId: true,
        totalEarnings: true,
      },
    });

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Get total earnings from database (sum of all EARNING transactions)
    const totalEarningsResult = await prisma.transactionLog.aggregate({
      where: {
        agentId: agentId,
        status: 'COMPLETED',
        transactionType: 'EARNING',
      },
      _sum: {
        amount: true,
      },
    });

    // Get total withdrawals from database (sum of all WITHDRAWAL transactions)
    const totalWithdrawalsResult = await prisma.transactionLog.aggregate({
      where: {
        agentId: agentId,
        status: 'COMPLETED',
        transactionType: 'WITHDRAWAL',
      },
      _sum: {
        amount: true,
      },
    });

    // Get total top-up transactions (these are also earnings for the agent)
    const topUpTransactions = await prisma.topUpTransaction.findMany({
      where: {
        agentId: agentId,
        status: 'COMPLETED',
      },
    });

    // Calculate total earnings from transaction logs
    const transactionLogEarnings = totalEarningsResult._sum.amount || 0;

    // Calculate total earnings from top-up transactions (convert ETH to USD)
    let topUpEarnings = 0;
    try {
      const { priceService } = await import('@/lib/priceService');
      const ethPrice = await priceService.getEthPrice();

      for (const topUp of topUpTransactions) {
        const ethAmount = parseFloat(topUp.amountInEth);
        const usdAmount = ethAmount * ethPrice;
        topUpEarnings += usdAmount;
      }
    } catch (error) {
      console.error('Error calculating top-up earnings:', error);
      // Fallback: use ETH amount * 3000 as rough USD conversion
      for (const topUp of topUpTransactions) {
        const ethAmount = parseFloat(topUp.amountInEth);
        topUpEarnings += ethAmount * 3000;
      }
    }

    const totalEarnings = transactionLogEarnings + topUpEarnings;
    const totalWithdrawals = totalWithdrawalsResult._sum.amount || 0;

    console.log('Earnings breakdown:', {
      transactionLogEarnings,
      topUpEarnings,
      totalEarnings,
      topUpTransactionsCount: topUpTransactions.length,
    });

    // Get available balance from smart contract
    let availableBalance = 0;
    let availableBalanceEth = 0;
    try {
      const publicClient = getPublicClient('base');

      // Compute agent ID hash exactly as stored on-chain: keccak256(abi.encodePacked(slugOrUuid))
      const agentIdHash = keccak256(encodePacked(['string'], [agent.agentId]));

      // Primary attempt: call getAgentBalance(bytes32)
      let balance: bigint | undefined;
      try {
        balance = (await publicClient.readContract({
          address: CONTRACT_ADDRESS as `0x${string}`,
          abi: CONTRACT_ABI,
          functionName: 'agentBalance',
          args: [agentIdHash],
        })) as unknown as bigint;
      } catch {
        // Fallback for older deployments without getAgentBalance: use public mapping getter agentBalance(bytes32)
        try {
          balance = (await publicClient.readContract({
            address: CONTRACT_ADDRESS as `0x${string}`,
            abi: CONTRACT_ABI,
            functionName: 'agentBalance',
            args: [agentIdHash],
          })) as unknown as bigint;
        } catch (fallbackErr) {
          throw fallbackErr;
        }
      }
      console.log('balance', balance);
      availableBalanceEth = Number(balance) / 1e18;

      // Convert ETH balance to USD using current price
      try {
        const { priceService } = await import('@/lib/priceService');
        const ethPrice = await priceService.getEthPrice();
        availableBalance = availableBalanceEth * ethPrice;
        console.log('Available balance conversion:', {
          ethAmount: availableBalanceEth,
          ethPrice,
          usdAmount: availableBalance,
        });
      } catch (error) {
        console.error(
          'Error converting ETH to USD for available balance:',
          error,
        );
        // Fallback: use ETH amount * 3000 as rough USD conversion
        availableBalance = availableBalanceEth * 3000;
      }
    } catch (error) {
      console.error('Error fetching contract balance (with fallback):', error);
      availableBalance = 0;
    }

    return NextResponse.json({
      totalEarnings,
      totalWithdrawals,
      availableBalance,
      availableBalanceEth: availableBalanceEth || 0, // ETH amount for debugging
      agentEarnings: agent.totalEarnings, // This is the cached total from the agent table
      breakdown: {
        transactionLogEarnings,
        topUpEarnings,
        topUpTransactionsCount: topUpTransactions.length,
      },
    });
  } catch (error) {
    console.error('Error fetching agent earnings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
