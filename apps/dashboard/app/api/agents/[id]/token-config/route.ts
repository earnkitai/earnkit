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
    const { userId, ...rest } = body;
    const internalSecret = process.env.INTERNAL_API_SECRET;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (internalSecret && userId) {
      headers['x-internal-secret'] = internalSecret;
      headers['x-user-id'] = userId;
    }

    const response = await fetch(`${backendUrl}/api/agents/${agentId}/token-config`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(rest),
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
