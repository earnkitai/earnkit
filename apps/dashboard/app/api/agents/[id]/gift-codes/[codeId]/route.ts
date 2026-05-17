import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Params = Promise<{ id: string; codeId: string }>;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const { id: agentId, codeId } = await params;
    const body = await request.json();
    const { isActive } = body as { isActive?: boolean };

    if (typeof isActive !== 'boolean') {
      return NextResponse.json(
        { error: 'isActive (boolean) is required' },
        { status: 400 },
      );
    }

    const existing = await prisma.giftCode.findUnique({ where: { id: codeId } });
    if (!existing || existing.agentId !== agentId) {
      return NextResponse.json({ error: 'Gift code not found' }, { status: 404 });
    }

    const updated = await prisma.giftCode.update({
      where: { id: codeId },
      data: { isActive },
    });

    return NextResponse.json({ code: updated });
  } catch (error) {
    console.error('Error updating gift code:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const { id: agentId, codeId } = await params;

    const existing = await prisma.giftCode.findUnique({ where: { id: codeId } });
    if (!existing || existing.agentId !== agentId) {
      return NextResponse.json({ error: 'Gift code not found' }, { status: 404 });
    }

    await prisma.giftCode.delete({ where: { id: codeId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting gift code:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
