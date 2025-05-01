import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/db';
import { deleteChat, getChat, updateChat } from '@/actions/chat';

// const chatService = new ChatService();

type Params = Promise<{ chatId: string }>;

export async function DELETE(
  request: NextRequest,
  segmentData: { params: Params },
) {
  try {
    await initializeDatabase();
    const params = await segmentData.params;
    const deleted = await deleteChat(params.chatId);

    if (!deleted) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Chat deleted successfully' });
  } catch (error) {
    console.error('Error deleting chat:', error);
    return NextResponse.json(
      { error: 'Failed to delete chat' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  segmentData: { params: Params },
) {
  try {
    await initializeDatabase();
    const params = await segmentData.params;
    const { title } = await request.json();

    const chat = await getChat(params.chatId);
    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    const updatedChat = await updateChat(params.chatId, { title });
    if (!updatedChat) {
      return NextResponse.json(
        { error: 'Failed to update chat' },
        { status: 500 },
      );
    }

    return NextResponse.json(updatedChat);
  } catch (error) {
    console.error('Error updating chat:', error);
    return NextResponse.json(
      { error: 'Failed to update chat' },
      { status: 500 },
    );
  }
}
