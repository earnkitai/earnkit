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

    // Live ETH price is only needed to value legacy rows that never got a USD
    // amount stamped on them. Lazy-fetch and fail-closed: if the feed is down,
    // we report the stable USD totals and leave legacy rows out rather than
    // multiplying by a guessed price.
    let liveEthPrice: number | null = null;
    let priceFeedAvailable = true;
    const getLiveEthPrice = async (): Promise<number | null> => {
      if (!priceFeedAvailable) return null;
      if (liveEthPrice !== null) return liveEthPrice;
      try {
        liveEthPrice = await priceService.getEthPrice();
        return liveEthPrice;
      } catch (err) {
        console.error('User earnings: live ETH price unavailable:', err);
        priceFeedAvailable = false;
        return null;
      }
    };

    // Calculate comprehensive earnings for each agent
    const agentsWithEarnings = await Promise.all(
      agents.map(async (agent) => {
        // Calculate transaction log earnings (already in USD)
        const transactionLogEarnings = agent.transactionLogs.reduce(
          (sum, log) => sum + log.amount,
          0,
        );

        let topUpEarnings = 0;
        for (const topUp of agent.topUpTransactions) {
          if (topUp.amountInUSD && parseFloat(topUp.amountInUSD) > 0) {
            topUpEarnings += parseFloat(topUp.amountInUSD);
            continue;
          }
          const ethAmount = parseFloat(topUp.amountInEth);
          if (!Number.isFinite(ethAmount) || ethAmount <= 0) continue;
          const price = await getLiveEthPrice();
          if (price === null) continue;
          topUpEarnings += ethAmount * price;
        }

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
      ethPrice: liveEthPrice ?? null,
    });
  } catch (error) {
    console.error('Error fetching comprehensive earnings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
