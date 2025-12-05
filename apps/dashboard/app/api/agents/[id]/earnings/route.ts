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
  '0xCAeB6A62D04C52E1e196E5Bdce63e43f45582aA2';

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

    // Calculate total earnings from top-up transactions (ETH + tokens)
    let topUpEarnings = 0;
    try {
      const { priceService } = await import('@/lib/priceService');
      const ethPrice = await priceService.getEthPrice();

      for (const topUp of topUpTransactions) {
        // Use amountInUSD directly if available (most accurate)
        if (topUp.amountInUSD && parseFloat(topUp.amountInUSD) > 0) {
          topUpEarnings += parseFloat(topUp.amountInUSD);
        } else {
          // Fallback to ETH conversion
          const ethAmount = parseFloat(topUp.amountInEth);
          const usdAmount = ethAmount * ethPrice;
          topUpEarnings += usdAmount;
        }
      }
    } catch (error) {
      console.error('Error calculating top-up earnings:', error);
      // Fallback: use amountInUSD or ETH * 3000
      for (const topUp of topUpTransactions) {
        if (topUp.amountInUSD && parseFloat(topUp.amountInUSD) > 0) {
          topUpEarnings += parseFloat(topUp.amountInUSD);
        } else {
          const ethAmount = parseFloat(topUp.amountInEth);
          topUpEarnings += ethAmount * 3000;
        }
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

    // Get available balance from smart contract (ETH + tokens)
    let availableBalance = 0;
    let availableBalanceEth = 0;
    const tokenBalances: { symbol: string; address: string; balance: string; balanceUsd: number }[] = [];
    
    try {
      const publicClient = getPublicClient('base');
      const { priceService } = await import('@/lib/priceService');

      // Compute agent ID hash exactly as stored on-chain: keccak256(abi.encodePacked(slugOrUuid))
      const agentIdHash = keccak256(encodePacked(['string'], [agent.agentId]));

      // Get ETH balance
      let balance: bigint | undefined;
      try {
        balance = (await publicClient.readContract({
          address: CONTRACT_ADDRESS as `0x${string}`,
          abi: CONTRACT_ABI,
          functionName: 'agentBalance',
          args: [agentIdHash],
        })) as unknown as bigint;
      } catch {
        balance = BigInt(0);
      }
      console.log('ETH balance', balance);
      availableBalanceEth = Number(balance) / 1e18;

      // Convert ETH balance to USD
      try {
        const ethPrice = await priceService.getEthPrice();
        availableBalance = availableBalanceEth * ethPrice;
        console.log('Available balance conversion:', {
          ethAmount: availableBalanceEth,
          ethPrice,
          usdAmount: availableBalance,
        });
      } catch (error) {
        console.error('Error converting ETH to USD:', error);
        availableBalance = availableBalanceEth * 3000;
      }

      // Get MINIDEV token balance
      const MINIDEV_TOKEN = '0x534b7aad1cdb6f02ec48cabe428f0d9131e40b07';
      try {
        const tokenBalance = (await publicClient.readContract({
          address: CONTRACT_ADDRESS as `0x${string}`,
          abi: CONTRACT_ABI,
          functionName: 'agentTokenBalance',
          args: [agentIdHash, MINIDEV_TOKEN],
        })) as unknown as bigint;

        console.log('MINIDEV balance', tokenBalance);

        if (tokenBalance > BigInt(0)) {
          const tokenAmount = Number(tokenBalance) / 1e18;
          let tokenUsd = 0;
          try {
            // Rough MINIDEV price - in production, fetch from CoinGecko
            const minidevPrice = 0.00000342; // fallback price
            tokenUsd = tokenAmount * minidevPrice;
          } catch {
            tokenUsd = 0;
          }

          tokenBalances.push({
            symbol: 'MINIDEV',
            address: MINIDEV_TOKEN,
            balance: tokenAmount.toFixed(6),
            balanceUsd: tokenUsd,
          });

          // Add token value to total available balance
          availableBalance += tokenUsd;
        }
      } catch (tokenError) {
        console.error('Error fetching MINIDEV balance:', tokenError);
      }
    } catch (error) {
      console.error('Error fetching contract balance:', error);
      availableBalance = 0;
    }

    return NextResponse.json({
      totalEarnings,
      totalWithdrawals,
      availableBalance,
      availableBalanceEth: availableBalanceEth || 0,
      tokenBalances, // NEW: Token balances for withdrawal
      agentEarnings: agent.totalEarnings,
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
