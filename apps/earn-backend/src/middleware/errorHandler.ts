import { Request, Response, NextFunction } from 'express';

export interface ApiError {
  message: string;
  status: number;
  success: boolean;
}

export class AppError extends Error {
  public status: number;
  public success: boolean;

  constructor(message: string, status: number = 500) {
    super(message);
    this.status = status;
    this.success = false;
  }
}

// See docs/06_RELIABILITY_FIXES_2026_05_14.md §9. Keep this list conservative.
const SENSITIVE_KEYS = new Set([
  'password',
  'pwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'auth',
  'privatekey',
  'private_key',
  'mnemonic',
  'seed',
  'signature',
  'sig',
  'cookie',
  'session',
  'jwt',
  'bearer',
]);

function redactValue(): string {
  return '[REDACTED]';
}

function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[depth-limit]';
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = redactValue();
      } else {
        out[k] = sanitize(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export const errorHandler = (
  error: Error | AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void => {
  let status = 500;
  let message = 'Internal Server Error';

  if (error instanceof AppError) {
    status = error.status;
    message = error.message;
  } else if (error instanceof Error) {
    message = error.message;
  }

  console.error(`[${new Date().toISOString()}] Error:`, {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    body: sanitize(req.body),
    query: sanitize(req.query),
  });

  res.status(status).json({
    success: false,
    message,
  });
};

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
};
