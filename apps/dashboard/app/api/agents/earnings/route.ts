import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { priceService } from '@/lib/priceService';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 },
      );
    }

    // Get all agents for the user
    const agents = await prisma.agent.findMany({
      where: {
        userId,
        status: {
          in: ['ACTIVE', 'PAUSED'],
        },
      },
      include: {
        transactionLogs: {
          where: {
            status: 'COMPLETED',
            transactionType: 'EARNING',
          },
        },
        topUpTransactions: {
          where: {
            status: 'COMPLETED',
          },
        },
      },
    });

    // Get ETH price for conversion
    const ethPrice = await priceService.getEthPrice();

    // Calculate comprehensive earnings for each agent
    const agentsWithEarnings = await Promise.all(
      agents.map(async (agent) => {
        // Calculate transaction log earnings (already in USD)
        const transactionLogEarnings = agent.transactionLogs.reduce(
          (sum, log) => sum + log.amount,
          0,
        );

        // Calculate top-up earnings (use amountInUSD for accuracy, includes tokens)
        const topUpEarnings = agent.topUpTransactions.reduce((sum, topUp) => {
          // Prefer amountInUSD (works for both ETH and token payments)
          if (topUp.amountInUSD && parseFloat(topUp.amountInUSD) > 0) {
            return sum + parseFloat(topUp.amountInUSD);
          }
          // Fallback to ETH conversion
          const ethAmount = parseFloat(topUp.amountInEth);
          const usdAmount = ethAmount * ethPrice;
          return sum + usdAmount;
        }, 0);

        // Total earnings = transaction logs + top-up transactions
        const totalEarnings = transactionLogEarnings + topUpEarnings;

        return {
          id: agent.id,
          name: agent.name,
          agentId: agent.agentId,
          status: agent.status,
          feeModel: agent.feeModel,
          totalEarnings,
          transactionLogEarnings,
          topUpEarnings,
          createdAt: agent.createdAt,
        };
      }),
    );

    // Calculate overall totals
    const overallTotals = {
      totalEarnings: agentsWithEarnings.reduce(
        (sum, agent) => sum + agent.totalEarnings,
        0,
      ),
      transactionLogEarnings: agentsWithEarnings.reduce(
        (sum, agent) => sum + agent.transactionLogEarnings,
        0,
      ),
      topUpEarnings: agentsWithEarnings.reduce(
        (sum, agent) => sum + agent.topUpEarnings,
        0,
      ),
    };

    return NextResponse.json({
      success: true,
      agents: agentsWithEarnings,
      totals: overallTotals,
      ethPrice,
    });
  } catch (error) {
    console.error('Error fetching comprehensive earnings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
