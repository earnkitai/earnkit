import { NextRequest, NextResponse } from 'next/server';

const SAFE_BASE = 'https://safe-transaction-base.safe.global';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const url = `${SAFE_BASE}/api/v1/${path.join('/')}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const url = `${SAFE_BASE}/api/v1/${path.join('/')}`;
  const body = await req.text();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return NextResponse.json(data, { status: res.status });
}
