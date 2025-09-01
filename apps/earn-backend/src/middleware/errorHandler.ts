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

export const errorHandler = (
  error: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction,
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
    body: req.body,
    query: req.query,
  });

  res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
  });
};

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
};
