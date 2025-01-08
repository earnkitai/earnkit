import { Request } from 'express';

export const getApiKeyFromHeader = (req: Request): string | null => {
  // Check for x-api-key header first
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    return apiKey.toString();
  }

  return null;
};
