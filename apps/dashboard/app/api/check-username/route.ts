import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get('username');

  if (!username) {
    return NextResponse.json(
      { available: false, error: 'Username is required' },
      { status: 400 },
    );
  }

  try {
    const isAvailable = await db.isUsernameAvailable(username);
    return NextResponse.json({ available: isAvailable });
  } catch (error) {
    console.error('Error checking username:', error);
    return NextResponse.json(
      { available: false, error: 'Error checking username' },
      { status: 500 },
    );
  }
}
