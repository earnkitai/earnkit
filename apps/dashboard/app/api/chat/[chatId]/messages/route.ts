import { NextResponse } from 'next/server';
import { ChatService } from '@/lib/services/chat.service';
import { initializeDatabase } from '@/lib/db';

const chatService = new ChatService();

type Params = Promise<{ chatId: string }>;

export async function POST(request: Request, context: { params: Params }) {
  try {
    await initializeDatabase();
    const { content, responseFrom, userId, toolName } = await request.json();
    const { chatId } = await context.params;

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 },
      );
    }

    // Verify that the chat belongs to the user
    const chat = await chatService.getChatById(chatId);
    if (!chat || chat.userId !== userId) {
      return NextResponse.json(
        { error: 'Chat not found or unauthorized' },
        { status: 404 },
      );
    }

    const message = await chatService.addMessage(chatId, {
      content,
      responseFrom,
      toolName: toolName || undefined,
    });

    return NextResponse.json({ message });
  } catch (error) {
    console.error('Error adding message:', error);
    return NextResponse.json(
      { error: 'Failed to add message' },
      { status: 500 },
    );
  }
}

export async function GET(request: Request, context: { params: Params }) {
  try {
    await initializeDatabase();
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const { chatId } = await context.params;

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 },
      );
    }

    // Verify that the chat belongs to the user
    const chat = await chatService.getChatById(chatId);
    if (!chat || chat.userId !== userId) {
      return NextResponse.json(
        { error: 'Chat not found or unauthorized' },
        { status: 404 },
      );
    }

    const messages = await chatService.getMessagesByChatId(chatId);
    return NextResponse.json({ messages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch messages' },
      { status: 500 },
    );
  }
}
