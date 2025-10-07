import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from './errorHandler';

/**
 * Middleware to validate API key authentication
 * Expects API key in the Authorization header as "Bearer <api_key>"
 * or in the x-api-key header
 */
export const validateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    let apiKey: string | undefined;

    // Check Authorization header first (Bearer token format)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.substring(7);
    }
    // Fallback to x-api-key header
    else if (req.headers['x-api-key']) {
      apiKey = req.headers['x-api-key'] as string;
    }

    if (!apiKey) {
      throw new AppError('API key is required', 401);
    }

    // Validate API key format (should be a non-empty string)
    if (typeof apiKey !== 'string' || apiKey.trim() === '') {
      throw new AppError('Invalid API key format', 401);
    }

    // Look up the user by API key
    const user = await prisma.user.findUnique({
      where: { apiKey },
      select: {
        id: true,
        username: true,
        email: true,
        apiKey: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new AppError('Invalid API key', 401);
    }

    // Add user info to request object for use in route handlers
    (req as any).user = user;
    (req as any).apiKey = apiKey;

    next();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('API key validation failed', 401);
  }
};

/**
 * Optional API key validation - doesn't throw error if API key is missing
 * Useful for routes that can work with or without authentication
 */
export const optionalApiKeyAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    let apiKey: string | undefined;

    // Check Authorization header first (Bearer token format)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.substring(7);
    }
    // Fallback to x-api-key header
    else if (req.headers['x-api-key']) {
      apiKey = req.headers['x-api-key'] as string;
    }

    if (apiKey && typeof apiKey === 'string' && apiKey.trim() !== '') {
      // Look up the user by API key
      const user = await prisma.user.findUnique({
        where: { apiKey },
        select: {
          id: true,
          username: true,
          email: true,
          apiKey: true,
          createdAt: true,
        },
      });

      if (user) {
        // Add user info to request object for use in route handlers
        (req as any).user = user;
        (req as any).apiKey = apiKey;
      }
    }

    next();
  } catch (error) {
    // For optional auth, we don't throw errors, just continue
    next();
  }
};
