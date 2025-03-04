import { DataSource } from 'typeorm';
import {
  UserEntity,
  SessionEntity,
  AccountEntity,
  VerificationTokenEntity,
} from './entities';

// Create TypeORM DataSource
const AppDataSource = new DataSource({
  type: 'postgres', // or your database type
  url: process.env.DATABASE_URL,
  entities: [UserEntity, SessionEntity, AccountEntity, VerificationTokenEntity],
  synchronize: process.env.NODE_ENV !== 'production', // Don't use synchronize in production
  logging: process.env.NODE_ENV === 'development',
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
});

// Initialize connection
let initialized = false;

async function initializeDB() {
  if (!initialized) {
    try {
      await AppDataSource.initialize();
      initialized = true;
      console.log('Database connection initialized');
    } catch (error) {
      console.error('Error initializing database:', error);
      throw error;
    }
  }
}

// Export database helper functions
export const db = {
  // Get user by email
  async getUserByEmail(email: string) {
    await initializeDB();
    return AppDataSource.getRepository(UserEntity).findOne({
      where: { email },
    });
  },

  // Get user by username
  async getUserByUsername(username: string) {
    await initializeDB();
    return AppDataSource.getRepository(UserEntity).findOne({
      where: { username },
    });
  },

  // Update user
  async updateUser(email: string, data: Partial<UserEntity>) {
    await initializeDB();
    const userRepository = AppDataSource.getRepository(UserEntity);
    const user = await userRepository.findOne({ where: { email } });
    if (!user) throw new Error('User not found');

    Object.assign(user, data);
    return userRepository.save(user);
  },

  // Check username availability
  async isUsernameAvailable(username: string) {
    await initializeDB();
    const user = await AppDataSource.getRepository(UserEntity).findOne({
      where: { username },
    });
    return !user;
  },

  // Set username
  async setUsername(email: string, username: string) {
    await initializeDB();
    const userRepository = AppDataSource.getRepository(UserEntity);

    // Check if username is already taken
    const existingUser = await userRepository.findOne({ where: { username } });
    if (existingUser) throw new Error('Username already taken');

    // Update user
    const user = await userRepository.findOne({ where: { email } });
    if (!user) throw new Error('User not found');

    user.username = username;
    return userRepository.save(user);
  },

  // Get DataSource instance
  getDataSource() {
    return AppDataSource;
  },
};

// Export types
export type { UserEntity as User };
