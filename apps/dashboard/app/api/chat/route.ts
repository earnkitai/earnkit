import { NextResponse } from 'next/server';
import { ChatService } from '@/lib/services/chat.service';
import { initializeDatabase } from '@/lib/db';

const chatService = new ChatService();

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
    const chat = await chatService.createChat(userId, title);

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

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 },
      );
    }

    // Get all chats for the user
    const chats = await chatService.getChatsByUserId(userId);

    return NextResponse.json({ chats });
  } catch (error) {
    console.error('Error fetching chats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch chats' },
      { status: 500 },
    );
  }
}
