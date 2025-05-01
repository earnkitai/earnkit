import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/db';
import { deleteUser, findUserById, updateUser } from '@/actions/user';

// const userService = new UserService();

type Params = Promise<{ id: string }>;

export async function GET(
  request: NextRequest,
  segmentData: { params: Params },
) {
  try {
    await initializeDatabase();
    const params = await segmentData.params;
    const user = await findUserById(params.id);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error('Error fetching user by ID:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user' },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  segmentData: { params: Params },
) {
  try {
    await initializeDatabase();
    const params = await segmentData.params;
    const userData = await request.json();
    const user = await updateUser(params.id, userData);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error('Error updating user:', error);
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Failed to update user' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  segmentData: { params: Params },
) {
  try {
    await initializeDatabase();
    const params = await segmentData.params;
    const deleted = await deleteUser(params.id);

    if (!deleted) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { error: 'Failed to delete user' },
      { status: 500 },
    );
  }
}
