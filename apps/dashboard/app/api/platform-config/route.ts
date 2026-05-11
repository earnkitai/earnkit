import { NextResponse } from 'next/server';

const backendUrl = process.env.EARNKIT_BACKEND_URL || 'http://localhost:3001';

export async function GET() {
  try {
    const res = await fetch(`${backendUrl}/api/config`, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    // Fallback so the frontend always gets a usable response
    return NextResponse.json({ platformFeeRateBps: 100, minThresholdUsd: 10 });
  }
}
