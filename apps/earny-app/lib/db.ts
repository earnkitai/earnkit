import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma = global.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

export const initializeDatabase = async () => {
  try {
    await prisma.$connect();
    console.log('Database connection has been established successfully.');
  } catch (error) {
    console.error('Error during database connection:', error);
    throw error;
  }
};
