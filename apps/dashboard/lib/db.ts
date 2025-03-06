import { DataSource } from 'typeorm';
import { User } from '@/types/user';
import { env } from '@/env.mjs';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: env.DATABASE_HOST,
  port: parseInt(env.DATABASE_PORT),
  username: env.DATABASE_USER,
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME,
  synchronize: false, // Set to false in production
  logging: false,
  entities: [User],
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
