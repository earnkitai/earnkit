import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { v4 as uuidv4 } from 'uuid';

interface TopUpPackage {
  id: string;
  credits: string;
  price: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      agentName,
      feeModel,
      freePromptThreshold,
      ratePerPrompt,
      creditsPerPrompt,
      topUpPackages,
      userId, // This should come from the authenticated user session
    } = body;

    // Validate required fields
    if (!agentName || !feeModel || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 },
      );
    }

    // Generate unique agent ID using UUID v4
    const agentId = uuidv4();

    // Check if agent ID already exists (very unlikely with UUID v4, but good practice)
    const existingAgent = await prisma.agent.findUnique({
      where: { agentId },
    });

    if (existingAgent) {
      return NextResponse.json(
        { error: 'Agent ID already exists' },
        { status: 409 },
      );
    }

    // Create the agent with transaction
    const agent = await prisma.$transaction(async (tx) => {
      // Create the main agent
      const newAgent = await tx.agent.create({
        data: {
          userId,
          name: agentName,
          agentId,
          status: 'ACTIVE',
          feeModel: feeModel === 'free-tier' ? 'FREE_TIER' : 'CREDIT_BASED',
          freePromptThreshold: freePromptThreshold
            ? parseInt(freePromptThreshold)
            : null,
          ratePerPrompt: ratePerPrompt ? parseFloat(ratePerPrompt) : null,
          creditsPerPrompt: creditsPerPrompt
            ? parseInt(creditsPerPrompt)
            : null,
          totalEarnings: 0,
        },
      });

      // Create top-up packages if they exist and fee model is credit-based
      if (
        feeModel === 'credit-based' &&
        topUpPackages &&
        topUpPackages.length > 0
      ) {
        const packagesToCreate = topUpPackages
          .filter((pkg: TopUpPackage) => pkg.credits && pkg.price) // Only create packages with valid data
          .map((pkg: TopUpPackage) => ({
            agentId: newAgent.id,
            name: `${pkg.credits} Credits`,
            credits: parseInt(pkg.credits),
            price: parseFloat(pkg.price),
            isActive: true,
          }));

        if (packagesToCreate.length > 0) {
          await tx.topUpPackage.createMany({
            data: packagesToCreate,
          });
        }
      }

      return newAgent;
    });

    return NextResponse.json(
      {
        success: true,
        agent: {
          id: agent.id,
          name: agent.name,
          agentId: agent.agentId,
          status: agent.status,
          feeModel: agent.feeModel,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error creating agent:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

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

    const agents = await prisma.agent.findMany({
      where: {
        userId,
        status: {
          in: ['ACTIVE', 'PAUSED'],
        },
      },
      include: {
        topUpPackages: {
          where: { isActive: true },
        },
        transactionLogs: {
          where: {
            status: 'COMPLETED',
            transactionType: 'EARNING',
          },
          orderBy: { createdAt: 'desc' },
          take: 30, // Get last 30 transactions for graph data
        },
        _count: {
          select: {
            transactionLogs: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ agents });
  } catch (error) {
    console.error('Error fetching agents:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
