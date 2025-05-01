'use server';

import { prisma } from '@/lib/prisma';
import { Chat } from '@/types/chat';

export async function createChat(chatData: Partial<Chat>) {
  const prismaChat = await prisma.chat.create({
    data: {
      userId: chatData.userId!,
      title: chatData.title,
      isActive: chatData.isActive ?? true,
      createdAt: chatData.createdAt ?? new Date(),
      updatedAt: chatData.updatedAt ?? new Date(),
    },
    include: {
      user: true,
      messages: true,
    },
  });

  return {
    id: prismaChat.id,
    userId: prismaChat.userId,
    title: prismaChat.title,
    isActive: prismaChat.isActive,
    createdAt: prismaChat.createdAt,
    updatedAt: prismaChat.updatedAt,
    user: {
      id: prismaChat.user.id,
      username: prismaChat.user.username,
      email: prismaChat.user.email,
      createdAt: prismaChat.user.createdAt.toISOString(),
      mfaMethods: prismaChat.user.mfaMethods,
      hasAcceptedTerms: prismaChat.user.hasAcceptedTerms,
      isGuest: prismaChat.user.isGuest,
    },
    messages: prismaChat.messages.map((msg) => ({
      id: msg.id,
      chatId: msg.chatId,
      responseFrom: msg.responseFrom,
      toolName: msg.toolName,
      content: msg.content,
      metadata: msg.metadata as object | null,
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    })),
  };
}

export async function getChat(id: string) {
  const prismaChat = await prisma.chat.findUnique({
    where: { id },
    include: {
      user: true,
      messages: true,
    },
  });

  if (!prismaChat) return null;

  return {
    id: prismaChat.id,
    userId: prismaChat.userId,
    title: prismaChat.title,
    isActive: prismaChat.isActive,
    createdAt: prismaChat.createdAt,
    updatedAt: prismaChat.updatedAt,
    user: {
      id: prismaChat.user.id,
      username: prismaChat.user.username,
      email: prismaChat.user.email,
      createdAt: prismaChat.user.createdAt.toISOString(),
      mfaMethods: prismaChat.user.mfaMethods,
      hasAcceptedTerms: prismaChat.user.hasAcceptedTerms,
      isGuest: prismaChat.user.isGuest,
    },
    messages: prismaChat.messages.map((msg) => ({
      id: msg.id,
      chatId: msg.chatId,
      responseFrom: msg.responseFrom,
      toolName: msg.toolName,
      content: msg.content,
      metadata: msg.metadata as object | null,
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    })),
  };
}

export async function getChatsByUserId(userId: string) {
  const prismaChats = await prisma.chat.findMany({
    where: {
      userId,
      isActive: true,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      user: true,
      messages: true,
    },
  });

  return prismaChats.map((prismaChat) => ({
    id: prismaChat.id,
    userId: prismaChat.userId,
    title: prismaChat.title,
    isActive: prismaChat.isActive,
    createdAt: prismaChat.createdAt,
    updatedAt: prismaChat.updatedAt,
    user: {
      id: prismaChat.user.id,
      username: prismaChat.user.username,
      email: prismaChat.user.email,
      createdAt: prismaChat.user.createdAt.toISOString(),
      mfaMethods: prismaChat.user.mfaMethods,
      hasAcceptedTerms: prismaChat.user.hasAcceptedTerms,
      isGuest: prismaChat.user.isGuest,
    },
    messages: prismaChat.messages.map((msg) => ({
      id: msg.id,
      chatId: msg.chatId,
      responseFrom: msg.responseFrom,
      toolName: msg.toolName,
      content: msg.content,
      metadata: msg.metadata as object | null,
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    })),
  }));
}

export async function updateChat(id: string, chatData: Partial<Chat>) {
  const prismaChat = await prisma.chat.update({
    where: { id },
    data: {
      title: chatData.title,
      isActive: chatData.isActive,
    },
    include: {
      user: true,
      messages: true,
    },
  });

  return {
    id: prismaChat.id,
    userId: prismaChat.userId,
    title: prismaChat.title,
    isActive: prismaChat.isActive,
    createdAt: prismaChat.createdAt,
    updatedAt: prismaChat.updatedAt,
    user: {
      id: prismaChat.user.id,
      username: prismaChat.user.username,
      email: prismaChat.user.email,
      createdAt: prismaChat.user.createdAt.toISOString(),
      mfaMethods: prismaChat.user.mfaMethods,
      hasAcceptedTerms: prismaChat.user.hasAcceptedTerms,
      isGuest: prismaChat.user.isGuest,
    },
    messages: prismaChat.messages.map((msg) => ({
      id: msg.id,
      chatId: msg.chatId,
      responseFrom: msg.responseFrom,
      toolName: msg.toolName,
      content: msg.content,
      metadata: msg.metadata as object | null,
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    })),
  };
}

export async function deleteChat(id: string) {
  await prisma.chat.delete({ where: { id } });
  return true;
}
