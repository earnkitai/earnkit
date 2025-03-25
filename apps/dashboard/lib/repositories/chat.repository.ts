import { Repository } from 'typeorm';
import { AppDataSource } from '../db';
import { Chat } from '@/types/chat';

export class ChatRepository {
  private repository: Repository<Chat>;

  constructor() {
    this.repository = AppDataSource.getRepository(Chat);
  }

  async create(chatData: Partial<Chat>): Promise<Chat> {
    const chat = this.repository.create(chatData);
    return await this.repository.save(chat);
  }

  async findById(id: string): Promise<Chat | null> {
    return await this.repository.findOne({
      where: { id },
      relations: ['messages'],
    });
  }

  async findByUserId(userId: string): Promise<Chat[]> {
    return await this.repository.find({
      where: { userId, isActive: true },
      order: { createdAt: 'DESC' },
      relations: ['messages'],
    });
  }

  async update(id: string, chatData: Partial<Chat>): Promise<Chat | null> {
    await this.repository.update(id, chatData);
    return await this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.repository.delete(id);
    return result.affected ? result.affected > 0 : false;
  }
}
