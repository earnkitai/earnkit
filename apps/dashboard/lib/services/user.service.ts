import { User } from '@/types/user';
import { UserRepository } from '../repositories/user.repository';

export class UserService {
  private userRepository: UserRepository;

  constructor() {
    this.userRepository = new UserRepository();
  }

  async createUser(userData: Partial<User>): Promise<User> {
    // Check if user with email already exists
    const existingUser = await this.userRepository.findByEmail(userData.email!);
    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    // Check if user with username already exists
    const existingUsername = await this.userRepository.findByUsername(
      userData.username!,
    );
    if (existingUsername) {
      throw new Error('Username is already taken');
    }

    return await this.userRepository.create(userData);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return await this.userRepository.findByEmail(email);
  }

  async getUserByUsername(username: string): Promise<User | null> {
    return await this.userRepository.findByUsername(username);
  }

  async getUserByTurnkeyId(turnkeyUserId: string): Promise<User | null> {
    return await this.userRepository.findByTurnkeyId(turnkeyUserId);
  }

  async updateUser(
    turnkeyUserId: string,
    userData: Partial<User>,
  ): Promise<User | null> {
    // If email is being updated, check if it's already taken
    if (userData.email) {
      const existingUser = await this.userRepository.findByEmail(
        userData.email,
      );
      if (existingUser && existingUser.turnkeyUserId !== turnkeyUserId) {
        throw new Error('Email is already taken');
      }
    }

    // If username is being updated, check if it's already taken
    if (userData.username) {
      const existingUser = await this.userRepository.findByUsername(
        userData.username,
      );
      if (existingUser && existingUser.turnkeyUserId !== turnkeyUserId) {
        throw new Error('Username is already taken');
      }
    }

    return await this.userRepository.update(turnkeyUserId, userData);
  }

  async deleteUser(turnkeyUserId: string): Promise<boolean> {
    return await this.userRepository.delete(turnkeyUserId);
  }

  async getAllUsers(): Promise<User[]> {
    return await this.userRepository.findAll();
  }
}
