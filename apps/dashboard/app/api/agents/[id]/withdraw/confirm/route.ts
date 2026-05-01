import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

interface ConfirmWithdrawRequest {
  transactionHash: string;
  agentId: string;
  fromAddress: string;
  toAddress: string;
  amount: number; // USD amount
  fee: number; // USD fee
  netAmount: number; // USD net amount
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

    const body: ConfirmWithdrawRequest = await request.json();
    const { transactionHash, fromAddress, toAddress, fee, amount } = body;

    if (!transactionHash || !fromAddress || !toAddress) {
      return NextResponse.json(
        {
          error: 'Transaction hash, from address, and to address are required',
        },
        { status: 400 },
      );
    }

    // Get agent details
    const agent = await prisma.agent.findUnique({
      where: { agentId: agentId },
      select: {
        agentId: true,
        id: true,
        userId: true,
      },
    });

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Idempotency: a re-submitted confirm for the same on-chain tx must not
    // create a duplicate WITHDRAWAL log (which would inflate "Total Withdrawals"
    // on the dashboard).
    const existing = await prisma.transactionLog.findFirst({
      where: {
        transactionHash: transactionHash,
        transactionType: 'WITHDRAWAL',
      },
    });

    if (existing) {
      return NextResponse.json({
        success: true,
        transaction: existing,
        message: 'Withdrawal transaction already recorded',
      });
    }

    // Record withdrawal transaction in database
    const transactionLog = await prisma.transactionLog.create({
      data: {
        agentId: agentId,
        userId: agent.userId,
        fromAddress: fromAddress,
        toAddress: toAddress,
        amount: amount, // Record net amount in USD
        transactionHash: transactionHash,
        transactionType: 'WITHDRAWAL',
        status: 'COMPLETED',
        description: `Withdrawal of $${amount.toFixed(2)} (fee: $${fee.toFixed(2)}) to ${toAddress.slice(0, 6)}...${toAddress.slice(-4)}`,
      },
    });

    return NextResponse.json({
      success: true,
      transaction: transactionLog,
      message: 'Withdrawal transaction recorded successfully',
    });
  } catch (error) {
    console.error('Error recording withdrawal transaction:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
