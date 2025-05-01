/* eslint-disable @typescript-eslint/no-explicit-any */
'use server';

import { prisma } from '@/lib/prisma';
import { Message } from '@/types/message';

export async function createMessage(messageData: Partial<Message>) {
  const prismaMessage = await prisma.message.create({
    data: {
      chatId: messageData.chatId!,
      content: messageData.content!,
      responseFrom: messageData.responseFrom!,
      toolName: messageData.toolName,
      metadata: messageData.metadata as any,
    },
    include: {
      chat: {
        include: {
          user: true,
          messages: true,
        },
      },
    },
  });

  return {
    id: prismaMessage.id,
    chatId: prismaMessage.chatId,
    responseFrom: prismaMessage.responseFrom,
    toolName: prismaMessage.toolName,
    content: prismaMessage.content,
    metadata: prismaMessage.metadata as object | null,
    createdAt: prismaMessage.createdAt,
    updatedAt: prismaMessage.updatedAt,
    chat: {
      id: prismaMessage.chat.id,
      userId: prismaMessage.chat.userId,
      title: prismaMessage.chat.title,
      isActive: prismaMessage.chat.isActive,
      createdAt: prismaMessage.chat.createdAt,
      updatedAt: prismaMessage.chat.updatedAt,
      user: {
        id: prismaMessage.chat.user.id,
        username: prismaMessage.chat.user.username,
        email: prismaMessage.chat.user.email,
        createdAt: prismaMessage.chat.user.createdAt.toISOString(),
        mfaMethods: prismaMessage.chat.user.mfaMethods,
        hasAcceptedTerms: prismaMessage.chat.user.hasAcceptedTerms,
        isGuest: prismaMessage.chat.user.isGuest,
      },
      messages: [],
    },
  };
}

export async function getMessagesByChatId(chatId: string) {
  const messages = await prisma.message.findMany({
    where: { chatId },
    orderBy: { createdAt: 'asc' },
    include: {
      chat: {
        include: {
          user: true,
          messages: true,
        },
      },
    },
  });

  return messages.map((msg: any) => ({
    id: msg.id,
    chatId: msg.chatId,
    responseFrom: msg.responseFrom,
    toolName: msg.toolName,
    content: msg.content,
    metadata: msg.metadata as object | null,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
    chat: {
      id: msg.chat.id,
      userId: msg.chat.userId,
      title: msg.chat.title,
      isActive: msg.chat.isActive,
      createdAt: msg.chat.createdAt,
      updatedAt: msg.chat.updatedAt,
      user: {
        id: msg.chat.user.id,
        username: msg.chat.user.username,
        email: msg.chat.user.email,
        createdAt: msg.chat.user.createdAt.toISOString(),
        mfaMethods: msg.chat.user.mfaMethods,
        hasAcceptedTerms: msg.chat.user.hasAcceptedTerms,
        isGuest: msg.chat.user.isGuest,
      },
      messages: [],
    },
  }));
}

export async function deleteMessagesByChatId(chatId: string) {
  await prisma.message.deleteMany({ where: { chatId } });
  return true;
}
