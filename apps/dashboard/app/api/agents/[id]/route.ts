import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

interface TopUpPackage {
  id: string;
  credits: string;
  price: string;
}

type Params = Promise<{ id: string }>;

export async function GET(
  request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const agentId = (await params).id;

    if (!agentId) {
      return NextResponse.json(
        { error: 'Agent ID is required' },
        { status: 400 },
      );
    }

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
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
    });

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json({ agent });
  } catch (error) {
    console.error('Error fetching agent:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const agentId = (await params).id;
    const body = await request.json();
    const {
      name,
      freePromptThreshold,
      ratePerPrompt,
      creditsPerPrompt,
      topUpPackages,
    } = body;

    if (!agentId) {
      return NextResponse.json(
        { error: 'Agent ID is required' },
        { status: 400 },
      );
    }

    // Check if agent exists
    const existingAgent = await prisma.agent.findUnique({
      where: { id: agentId },
    });

    if (!existingAgent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Update the agent with transaction
    const agent = await prisma.$transaction(async (tx) => {
      // Prepare update data - only update provided fields
      const updateData: {
        name: string;
        freePromptThreshold?: number | null;
        ratePerPrompt?: number | null;
        creditsPerPrompt?: number | null;
      } = {
        name: name || existingAgent.name,
      };

      // Only update fee model specific fields if they are provided
      if (freePromptThreshold !== undefined) {
        updateData.freePromptThreshold = freePromptThreshold
          ? parseInt(freePromptThreshold)
          : null;
      }
      if (ratePerPrompt !== undefined) {
        updateData.ratePerPrompt = ratePerPrompt
          ? parseFloat(ratePerPrompt)
          : null;
      }
      if (creditsPerPrompt !== undefined) {
        updateData.creditsPerPrompt = creditsPerPrompt
          ? parseInt(creditsPerPrompt)
          : null;
      }

      // Update the main agent
      const updatedAgent = await tx.agent.update({
        where: { id: agentId },
        data: updateData,
      });

      // Update top-up packages only if they are provided
      if (topUpPackages && topUpPackages.length > 0) {
        // First, deactivate all existing packages
        await tx.topUpPackage.updateMany({
          where: { agentId },
          data: { isActive: false },
        });

        // Then create new packages
        const packagesToCreate = topUpPackages
          .filter((pkg: TopUpPackage) => pkg.credits && pkg.price)
          .map((pkg: TopUpPackage) => ({
            agentId,
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

      return updatedAgent;
    });

    return NextResponse.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        agentId: agent.agentId,
        status: agent.status,
        feeModel: agent.feeModel,
      },
    });
  } catch (error) {
    console.error('Error updating agent:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const agentId = (await params).id;

    if (!agentId) {
      return NextResponse.json(
        { error: 'Agent ID is required' },
        { status: 400 },
      );
    }

    // Check if agent exists
    const existingAgent = await prisma.agent.findUnique({
      where: { id: agentId },
    });

    if (!existingAgent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Soft delete by updating status to DELETED
    await prisma.agent.update({
      where: { id: agentId },
      data: { status: 'DELETED' },
    });

    return NextResponse.json({
      success: true,
      message: 'Agent deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting agent:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
