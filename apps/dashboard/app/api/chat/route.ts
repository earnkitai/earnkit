import { NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/db';
import { createChat, getChatsByUserId } from '@/actions/chat';

// const chatService = new ChatService();

export async function POST(request: Request) {
  try {
    await initializeDatabase();
    const { userId, title } = await request.json();

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 },
      );
    }

    // Create a new chat
    const chat = await createChat({ userId, title });

    return NextResponse.json({ chat });
  } catch (error) {
    console.error('Error creating chat:', error);
    return NextResponse.json(
      { error: 'Failed to create chat' },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  try {
    await initializeDatabase();
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    console.log(userId, 'userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 },
      );
    }

    // Get all chats for the user
    const chats = await getChatsByUserId(userId);

    return NextResponse.json({ chats });
  } catch (error) {
    console.error('Error fetching chats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch chats' },
      { status: 500 },
    );
  }
}
