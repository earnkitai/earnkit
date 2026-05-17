import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';

type Params = Promise<{ id: string }>;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
    if (i === 3 || i === 7) out += '-';
  }
  return `EK-${out}`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const agentId = (await params).id;
    if (!agentId) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 });
    }

    const codes = await prisma.giftCode.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { redemptions: true } },
      },
    });

    const now = new Date();
    const result = codes.map((c) => {
      const exhausted = c.maxRedemptions !== null && c.redemptionCount >= c.maxRedemptions;
      const expired = c.expiresAt !== null && c.expiresAt < now;
      let status: 'active' | 'inactive' | 'exhausted' | 'expired';
      if (!c.isActive) status = 'inactive';
      else if (expired) status = 'expired';
      else if (exhausted) status = 'exhausted';
      else status = 'active';
      return {
        id: c.id,
        code: c.code,
        creditsPerRedemption: c.creditsPerRedemption,
        maxRedemptions: c.maxRedemptions,
        redemptionCount: c.redemptionCount,
        isActive: c.isActive,
        expiresAt: c.expiresAt,
        createdAt: c.createdAt,
        status,
      };
    });

    return NextResponse.json({ codes: result });
  } catch (error) {
    console.error('Error fetching gift codes:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const agentId = (await params).id;
    const body = await request.json();
    const { creditsPerRedemption, maxRedemptions, expiresAt } = body as {
      creditsPerRedemption: number;
      maxRedemptions?: number | null;
      expiresAt?: string | null;
    };

    if (!agentId) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 });
    }
    if (!Number.isInteger(creditsPerRedemption) || creditsPerRedemption <= 0) {
      return NextResponse.json(
        { error: 'creditsPerRedemption must be a positive integer' },
        { status: 400 },
      );
    }
    if (maxRedemptions != null && (!Number.isInteger(maxRedemptions) || maxRedemptions <= 0)) {
      return NextResponse.json(
        { error: 'maxRedemptions must be a positive integer or null' },
        { status: 400 },
      );
    }

    const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true } });
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Retry on the off chance of a code collision (extremely unlikely).
    let created;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      try {
        created = await prisma.giftCode.create({
          data: {
            code,
            agentId,
            creditsPerRedemption,
            maxRedemptions: maxRedemptions ?? null,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
          },
        });
        break;
      } catch (err: unknown) {
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code?: string }).code === 'P2002' &&
          attempt < 4
        ) {
          continue;
        }
        throw err;
      }
    }

    return NextResponse.json({ code: created });
  } catch (error) {
    console.error('Error creating gift code:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
