import { NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/db';
import { getChat } from '@/actions/chat';
import { updateMessage } from '@/actions/message';

type Params = Promise<{ chatId: string; messageId: string }>;

export async function PATCH(request: Request, context: { params: Params }) {
  try {
    await initializeDatabase();
    const { content, userId, metadata } = await request.json();
    const { chatId, messageId } = await context.params;

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 },
      );
    }

    // Verify that the chat belongs to the user
    const chat = await getChat(chatId);
    if (!chat || chat.userId !== userId) {
      return NextResponse.json(
        { error: 'Chat not found or unauthorized' },
        { status: 404 },
      );
    }

    const message = await updateMessage(messageId, {
      content,
      metadata,
    });

    return NextResponse.json({ message });
  } catch (error) {
    console.error('Error updating message:', error);
    return NextResponse.json(
      { error: 'Failed to update message' },
      { status: 500 },
    );
  }
}
