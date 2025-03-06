import { Repository } from 'typeorm';
import { AppDataSource } from '../db';
import { User } from '@/types/user';

export class UserRepository {
  private repository: Repository<User>;

  constructor() {
    this.repository = AppDataSource.getRepository(User);
  }

  async create(userData: Partial<User>): Promise<User> {
    const user = this.repository.create(userData);
    return await this.repository.save(user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return await this.repository.findOne({ where: { email } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return await this.repository.findOne({ where: { username } });
  }

  async findByTurnkeyId(turnkeyUserId: string): Promise<User | null> {
    return await this.repository.findOne({ where: { turnkeyUserId } });
  }

  async update(
    turnkeyUserId: string,
    userData: Partial<User>,
  ): Promise<User | null> {
    await this.repository.update(turnkeyUserId, userData);
    return await this.findByTurnkeyId(turnkeyUserId);
  }

  async delete(turnkeyUserId: string): Promise<boolean> {
    const result = await this.repository.delete(turnkeyUserId);
    return result.affected ? result.affected > 0 : false;
  }

  async findAll(): Promise<User[]> {
    return await this.repository.find();
  }
}
