import { NextRequest, NextResponse } from 'next/server';

type Params = Promise<{ id: string }>;

const backendUrl = process.env.EARNKIT_BACKEND_URL || 'http://localhost:3001';

export async function POST(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { id } = await params;
    const response = await fetch(`${backendUrl}/api/shared-buyback/${id}/check-activation`, { method: 'POST' });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error proxying check-activation:', error);
    return NextResponse.json({ error: 'Failed to check activation' }, { status: 500 });
  }
}
