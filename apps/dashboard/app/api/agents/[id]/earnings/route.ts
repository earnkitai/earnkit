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

    // Calculate total earnings from top-up transactions (ETH + tokens).
    // Prefer the stored amountInUSD (set at verify time, locked to the package
    // price when it matched within tolerance — see TopUpService.verifyAndCredit).
    // Only fall back to a live ETH conversion for legacy rows that never got a USD value.
    let topUpEarnings = 0;
    let liveEthPrice: number | null = null;
    for (const topUp of topUpTransactions) {
      if (topUp.amountInUSD && parseFloat(topUp.amountInUSD) > 0) {
        topUpEarnings += parseFloat(topUp.amountInUSD);
        continue;
      }
      const ethAmount = parseFloat(topUp.amountInEth);
      if (!Number.isFinite(ethAmount) || ethAmount <= 0) continue;
      if (liveEthPrice === null) {
        try {
          const { priceService } = await import('@/lib/priceService');
          liveEthPrice = await priceService.getEthPrice();
        } catch (err) {
          console.error('Earnings: live ETH price unavailable, skipping legacy ETH-only rows:', err);
          // Skip rather than guessing — a guessed price would lie about earnings.
          break;
        }
      }
      topUpEarnings += ethAmount * liveEthPrice;
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

      // Convert ETH balance to USD. If the price feed is unavailable, leave the
      // USD value at 0 rather than guessing — the ETH amount is still returned
      // separately so the UI can show what's actually in the contract.
      try {
        const ethPrice = await priceService.getEthPrice();
        availableBalance = availableBalanceEth * ethPrice;
        console.log('Available balance conversion:', {
          ethAmount: availableBalanceEth,
          ethPrice,
          usdAmount: availableBalance,
        });
      } catch (error) {
        console.error('Error converting ETH to USD (showing 0 USD, ETH amount preserved):', error);
        availableBalance = 0;
      }

      // Read every supported token's balance for this agent. Decimals are
      // pulled from the token contract (never assume 18); USD price comes from
      // CoinGecko via priceService. If anything fails for a single token, we
      // skip it rather than stranding it with a guessed value.
      const { erc20Abi, formatUnits } = await import('viem');
      const SUPPORTED_TOKENS = [
        {
          address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          symbol: 'USDC',
          coingeckoId: 'usd-coin',
        },
        {
          address: '0x534b7aad1cdb6f02ec48cabe428f0d9131e40b07',
          symbol: 'MINIDEV',
          coingeckoId: 'minidev',
        },
      ];

      for (const token of SUPPORTED_TOKENS) {
        try {
          const tokenBalanceAtomic = (await publicClient.readContract({
            address: CONTRACT_ADDRESS as `0x${string}`,
            abi: CONTRACT_ABI,
            functionName: 'agentTokenBalance',
            args: [agentIdHash, token.address as `0x${string}`],
          })) as unknown as bigint;

          if (tokenBalanceAtomic <= BigInt(0)) continue;

          const tokenDecimals = (await publicClient.readContract({
            address: token.address as `0x${string}`,
            abi: erc20Abi,
            functionName: 'decimals',
          })) as number;

          const tokenAmount = Number(formatUnits(tokenBalanceAtomic, tokenDecimals));

          let tokenUsd = 0;
          try {
            const tokenPrice = await priceService.getTokenPrice(token.coingeckoId);
            tokenUsd = tokenAmount * tokenPrice;
          } catch (priceErr) {
            console.error(`Token price unavailable for ${token.symbol}, reporting $0:`, priceErr);
            tokenUsd = 0;
          }

          tokenBalances.push({
            symbol: token.symbol,
            address: token.address,
            balance: tokenAmount.toFixed(Math.min(tokenDecimals, 6)),
            balanceUsd: tokenUsd,
          });

          availableBalance += tokenUsd;
        } catch (tokenError) {
          console.error(`Error fetching ${token.symbol} balance:`, tokenError);
        }
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
