import { Request, Response, NextFunction } from 'express';
import { ApiKeyService } from '../services/apiKeyService';
import { AppError } from './errorHandler';

function extractApiKey(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.substring(7);
  const header = req.headers['x-api-key'];
  if (typeof header === 'string') return header;
  return undefined;
}

export const validateApiKey = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const apiKey = extractApiKey(req);

    if (!apiKey || apiKey.trim() === '') {
      throw new AppError('API key is required', 401);
    }

    const user = await ApiKeyService.getUserByApiKey(apiKey);

    if (!user) {
      throw new AppError('Invalid API key', 401);
    }

    (req as any).user = user;
    next();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('API key validation failed', 401);
  }
};

export const optionalApiKeyAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const apiKey = extractApiKey(req);

    if (apiKey && apiKey.trim() !== '') {
      const user = await ApiKeyService.getUserByApiKey(apiKey);
      if (user) (req as any).user = user;
    }

    next();
  } catch {
    next();
  }
};
