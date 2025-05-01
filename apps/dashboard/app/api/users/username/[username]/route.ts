import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/db';
import { findUserByUsername } from '@/actions/user';

// const userService = new UserService();

type Params = Promise<{ username: string }>;

export async function GET(
  request: NextRequest,
  segmentData: { params: Params },
) {
  try {
    await initializeDatabase();
    const params = await segmentData.params;
    const user = await findUserByUsername(params.username);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error('Error fetching user by username:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user' },
      { status: 500 },
    );
  }
}
