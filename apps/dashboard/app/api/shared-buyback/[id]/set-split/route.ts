import { NextRequest, NextResponse } from 'next/server';

type Params = Promise<{ id: string }>;

const backendUrl = process.env.EARNKIT_BACKEND_URL || 'http://localhost:3001';

export async function POST(req: NextRequest, { params }: { params: Params }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const response = await fetch(`${backendUrl}/api/shared-buyback/${id}/set-split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error proxying shared-buyback set-split:', error);
    return NextResponse.json({ error: 'Failed to attach split' }, { status: 500 });
  }
}
