import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolvedParams = await params;
    const agentId = resolvedParams.id;

    console.log('Fetching transactions for agent ID:', agentId);

    if (!agentId) {
      return NextResponse.json(
        { error: 'Agent ID is required' },
        { status: 400 },
      );
    }

    // Get all transaction logs for the agent
    const transactionLogs = await prisma.transactionLog.findMany({
      where: {
        agentId: agentId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Get all top-up transactions for the agent
    const topUpTransactions = await prisma.topUpTransaction.findMany({
      where: {
        agentId: agentId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log(
      'Found transaction logs:',
      transactionLogs.length,
      'transactions',
    );
    console.log(
      'Found top-up transactions:',
      topUpTransactions.length,
      'transactions',
    );

    // Debug: Let's also check if there are any transactions at all
    const allTransactionLogs = await prisma.transactionLog.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
    });
    const allTopUpTransactions = await prisma.topUpTransaction.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
    });
    console.log(
      'Total transaction logs in database:',
      allTransactionLogs.length,
    );
    console.log(
      'Total top-up transactions in database:',
      allTopUpTransactions.length,
    );

    // Transform transaction logs
    const transformedTransactionLogs = transactionLogs.map((log) => {
      const date = new Date(log.createdAt);
      const formattedDate = date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      const formattedTime = date.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      // Format amount with proper sign based on transaction type
      const amountSign = log.transactionType === 'WITHDRAWAL' ? '-' : '+';
      const formattedAmount = `${amountSign}$${log.amount.toFixed(2)}`;

      return {
        id: log.id,
        address: log.fromAddress,
        network: 'Base',
        status: log.status === 'COMPLETED' ? 'completed' : 'pending',
        date: formattedDate,
        time: formattedTime,
        amount: formattedAmount,
        transactionHash: log.transactionHash,
        transactionType: log.transactionType,
        description: log.description,
        toAddress: log.toAddress,
      };
    });

    // No need for ETH price conversion since we're using USD amounts directly

    // Transform top-up transactions
    const transformedTopUpTransactions = await Promise.all(
      topUpTransactions.map(async (topUp) => {
        const date = new Date(topUp.createdAt);
        const formattedDate = date.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
        const formattedTime = date.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });

        // Use amountInUSD directly (no conversion needed)
        const usdAmount = parseFloat(topUp.amountInUSD);
        const formattedAmount = `+$${usdAmount.toFixed(2)}`;

        return {
          id: topUp.txHash,
          address: topUp.userWalletAddress,
          network: 'Base',
          status: topUp.status === 'COMPLETED' ? 'completed' : 'pending',
          date: formattedDate,
          time: formattedTime,
          amount: formattedAmount,
          transactionHash: topUp.txHash,
          transactionType: 'TOP_UP',
          description: `Top-up: ${topUp.creditsToTopUp?.toString() || 'N/A'} credits ($${usdAmount.toFixed(2)} USD)`,
          toAddress: topUp.userWalletAddress,
        };
      }),
    );

    // Combine and sort all transactions by date
    const allTransactions = [
      ...transformedTransactionLogs,
      ...transformedTopUpTransactions,
    ];
    const transactions = allTransactions.sort((a, b) => {
      const dateA = new Date(`${a.date} ${a.time}`);
      const dateB = new Date(`${b.date} ${b.time}`);
      return dateB.getTime() - dateA.getTime();
    });

    console.log(
      'Transformed transactions:',
      transactions.length,
      'transactions',
    );
    console.log('Sample transaction:', transactions[0]);

    // No price service needed since we're using USD amounts directly

    return NextResponse.json({
      transactions,
      total: transactions.length,
      breakdown: {
        transactionLogs: transactionLogs.length,
        topUpTransactions: topUpTransactions.length,
      },
    });
  } catch (error) {
    console.error('Error fetching agent transactions:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
