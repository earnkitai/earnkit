import { NextRequest, NextResponse } from 'next/server';

const backendUrl = process.env.EARNKIT_BACKEND_URL || 'http://localhost:3001';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const res = await fetch(`${backendUrl}/api/token-buyback/${params.id}/check`, {
      method: 'POST',
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[api/token-buyback/[id]/check]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
