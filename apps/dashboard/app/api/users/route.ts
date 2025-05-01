import { NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/db';
import { createUser, findAllUsers } from '@/actions/user';

// const userService = new UserService();

export async function GET() {
  try {
    await initializeDatabase();
    const users = await findAllUsers();
    return NextResponse.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await initializeDatabase();
    const userData = await request.json();
    const user = await createUser(userData);
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Failed to create user' },
      { status: 500 },
    );
  }
}
