import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Params = Promise<{ id: string }>;

export async function PUT(
  request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const agentId = (await params).id;
    const body = await request.json();
    const { status } = body;

    if (!agentId) {
      return NextResponse.json(
        { error: 'Agent ID is required' },
        { status: 400 },
      );
    }

    if (!status || !['ACTIVE', 'PAUSED', 'DELETED'].includes(status)) {
      return NextResponse.json(
        { error: 'Valid status is required (ACTIVE, PAUSED, DELETED)' },
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

    // Update only the status
    const updatedAgent = await prisma.agent.update({
      where: { id: agentId },
      data: { status },
    });

    return NextResponse.json({
      success: true,
      agent: {
        id: updatedAgent.id,
        name: updatedAgent.name,
        agentId: updatedAgent.agentId,
        status: updatedAgent.status,
        feeModel: updatedAgent.feeModel,
      },
    });
  } catch (error) {
    console.error('Error updating agent status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
