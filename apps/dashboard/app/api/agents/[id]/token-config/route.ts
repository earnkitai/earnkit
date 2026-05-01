import { NextRequest, NextResponse } from 'next/server';

type Params = Promise<{ id: string }>;

const backendUrl = process.env.EARNKIT_BACKEND_URL || 'http://localhost:3001';

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const agentId = (await params).id;
    const response = await fetch(`${backendUrl}/api/agents/${agentId}/token-config`, {
      cache: 'no-store',
    });
    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error proxying token config request:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch token configuration' },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Params },
) {
  try {
    const agentId = (await params).id;
    const body = await request.json();
    const response = await fetch(`${backendUrl}/api/agents/${agentId}/token-config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error proxying token config update:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to save token configuration' },
      { status: 500 },
    );
  }
}
