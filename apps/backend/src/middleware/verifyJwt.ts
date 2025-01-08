import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/JwtUtils';

export const verifyJwt = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      res.status(401).json({
        success: false,
        error: 'No token provided',
      });
      return;
    }

    const decoded = await verifyToken(token);
    if (!decoded) {
      res.status(401).json({
        success: false,
        error: 'Invalid token or signature',
      });
      return;
    }

    // Add decoded address to request
    req.user = { address: decoded.address };
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Token verification failed',
    });
  }
};
