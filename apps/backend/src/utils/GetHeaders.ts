import { Request } from 'express';

export const getApiKeyFromHeader = (req: Request): string | null => {
  // Check for x-api-key header first
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    return apiKey.toString();
  }

  // Fallback to Authorization header if x-api-key is not present
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    console.log('No Authorization header found');
    return null;
  }

  const [bearer, token] = authHeader.split(' ');
  if (bearer !== 'Bearer' || !token) {
    console.log('Invalid Authorization format. Expected: Bearer <token>');
    return null;
  }

  return token;
};
