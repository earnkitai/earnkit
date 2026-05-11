import { NextRequest, NextResponse } from 'next/server';

const backendUrl = process.env.EARNKIT_BACKEND_URL || 'http://localhost:3001';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${backendUrl}/api/token-buyback/detect`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[api/token-buyback/detect]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
