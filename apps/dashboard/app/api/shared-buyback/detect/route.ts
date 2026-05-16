import { NextRequest, NextResponse } from 'next/server';

const backendUrl = process.env.EARNKIT_BACKEND_URL || 'http://localhost:3001';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const response = await fetch(`${backendUrl}/api/shared-buyback/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error proxying shared-buyback detect:', error);
    return NextResponse.json({ error: 'Failed to detect' }, { status: 500 });
  }
}
