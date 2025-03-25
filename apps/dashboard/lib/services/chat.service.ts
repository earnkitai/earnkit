import { Chat } from '@/types/chat';
import { Message } from '@/types/message';
import { ChatRepository } from '../repositories/chat.repository';
import { MessageRepository } from '../repositories/message.repository';

export class ChatService {
  private chatRepository: ChatRepository;
  private messageRepository: MessageRepository;

  constructor() {
    this.chatRepository = new ChatRepository();
    this.messageRepository = new MessageRepository();
  }

  async createChat(userId: string, title: string = 'New Chat'): Promise<Chat> {
    return await this.chatRepository.create({
      userId,
      title,
      isActive: true,
    });
  }

  async getChatsByUserId(userId: string): Promise<Chat[]> {
    return await this.chatRepository.findByUserId(userId);
  }

  async getChatById(id: string): Promise<Chat | null> {
    return await this.chatRepository.findById(id);
  }

  async addMessage(
    chatId: string,
    messageData: {
      content: string;
      responseFrom: string;
      toolName?: string;
    },
  ): Promise<Message> {
    return await this.messageRepository.create({
      chatId,
      ...messageData,
    });
  }

  async deleteChat(id: string): Promise<boolean> {
    // Delete all messages first
    await this.messageRepository.deleteByChatId(id);
    // Then delete the chat
    return await this.chatRepository.delete(id);
  }

  async getMessagesByChatId(chatId: string): Promise<Message[]> {
    return await this.messageRepository.findByChatId(chatId);
  }
}
