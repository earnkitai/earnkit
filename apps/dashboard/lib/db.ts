import { DataSource } from 'typeorm';
import { User } from '@/types/user';
import { Chat } from '@/types/chat';
import { Message } from '@/types/message';
import { env } from '@/env.mjs';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: env.DATABASE_URL,
  synchronize: false, // Set to false in production
  logging: false,
  entities: [User, Chat, Message],
  migrations: [],
  subscribers: [],
});

export const initializeDatabase = async () => {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log('Data Source has been initialized!');
    }
  } catch (error) {
    console.error('Error during Data Source initialization:', error);
    throw error;
  }
};
