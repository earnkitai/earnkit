import { NextRequest, NextResponse } from 'next/server';

type Params = Promise<{ id: string }>;

const backendUrl = process.env.EARNKIT_BACKEND_URL || 'http://localhost:3001';

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const agentId = (await params).id;
    const response = await fetch(`${backendUrl}/api/agents/${agentId}/buyback`, {
      cache: 'no-store',
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error proxying buyback GET:', error);
    return NextResponse.json(
      { error: 'Failed to fetch buyback config' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: Params }) {
  try {
    const agentId = (await params).id;
    const body = await req.json();
    const response = await fetch(`${backendUrl}/api/agents/${agentId}/buyback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error proxying buyback POST:', error);
    return NextResponse.json(
      { error: 'Failed to save buyback config' },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const agentId = (await params).id;
    const response = await fetch(`${backendUrl}/api/agents/${agentId}/buyback`, {
      method: 'DELETE',
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error proxying buyback DELETE:', error);
    return NextResponse.json(
      { error: 'Failed to disable buyback' },
      { status: 500 },
    );
  }
}
