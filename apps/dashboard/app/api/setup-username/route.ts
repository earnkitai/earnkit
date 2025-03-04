import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { auth } from '@/auth.config';

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { username } = await request.json();

    // Validate username
    if (!username || username.length < 3 || username.length > 15) {
      return NextResponse.json({ error: 'Invalid username' }, { status: 400 });
    }

    // Set username
    await db.setUsername(session.user.email, username);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error setting username:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Error setting username';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
