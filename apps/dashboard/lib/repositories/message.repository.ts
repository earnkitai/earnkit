import { Repository } from 'typeorm';
import { AppDataSource } from '../db';
import { Message } from '@/types/message';

export class MessageRepository {
  private repository: Repository<Message>;

  constructor() {
    this.repository = AppDataSource.getRepository(Message);
  }

  async create(messageData: Partial<Message>): Promise<Message> {
    const message = this.repository.create(messageData);
    return await this.repository.save(message);
  }

  async findByChatId(chatId: string): Promise<Message[]> {
    return await this.repository.find({
      where: { chatId },
      order: { createdAt: 'ASC' },
    });
  }

  async deleteByChatId(chatId: string): Promise<boolean> {
    const result = await this.repository.delete({ chatId });
    return result.affected ? result.affected > 0 : false;
  }
}
