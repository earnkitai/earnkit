import type { Chat } from './chat';

export interface Message {
  id: string;
  chatId: string;
  responseFrom: string;
  toolName?: string | null;
  content: string;
  metadata?: object | null;
  createdAt: Date;
  updatedAt: Date;
  chat: Chat;
}
