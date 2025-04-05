import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

// Create Redis client
const redis = new Redis(process.env.REDIS_URL + '?family=0');

// Handle Redis connection events
redis.on('connect', () => {
  console.log('Connected to Redis');
});

redis.on('error', (error) => {
  console.error('Redis connection error:', error);
});

// Export Redis client
export const getRedisClient = () => redis;

// Initialize Redis
export const initializeRedis = () => {
  // You can add any additional Redis setup here
  console.log('Redis initialized');
};
