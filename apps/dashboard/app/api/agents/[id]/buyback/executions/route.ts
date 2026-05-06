import { NextRequest, NextResponse } from 'next/server';

type Params = Promise<{ id: string }>;

const backendUrl = process.env.EARNKIT_BACKEND_URL || 'http://localhost:3001';

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const agentId = (await params).id;
    const response = await fetch(
      `${backendUrl}/api/agents/${agentId}/buyback/executions`,
      { cache: 'no-store' },
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error proxying buyback executions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch buyback executions' },
      { status: 500 },
    );
  }
}
