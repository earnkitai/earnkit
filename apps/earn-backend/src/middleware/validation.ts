import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';

export const validateWalletAddress = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const { walletAddress } = req.body;

  if (!walletAddress) {
    throw new AppError('walletAddress is required', 400);
  }

  if (typeof walletAddress !== 'string') {
    throw new AppError('walletAddress must be a string', 400);
  }

  if (!walletAddress.startsWith('0x')) {
    throw new AppError('walletAddress must start with 0x', 400);
  }

  if (walletAddress.length !== 42) {
    throw new AppError('walletAddress must be 42 characters long', 400);
  }

  next();
};

export const validateAgentId = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const { agentId } = req.body;

  if (!agentId) {
    throw new AppError('agentId is required', 400);
  }

  if (typeof agentId !== 'string') {
    throw new AppError('agentId must be a string', 400);
  }

  if (agentId.trim() === '') {
    throw new AppError('agentId cannot be empty', 400);
  }

  next();
};

export const validateEventId = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const { eventId } = req.body;

  if (!eventId) {
    throw new AppError('eventId is required', 400);
  }

  if (typeof eventId !== 'string') {
    throw new AppError('eventId must be a string', 400);
  }

  if (eventId.trim() === '') {
    throw new AppError('eventId cannot be empty', 400);
  }

  next();
};

export const validateTransactionHash = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const { txHash } = req.body;

  if (!txHash) {
    throw new AppError('txHash is required', 400);
  }

  if (typeof txHash !== 'string') {
    throw new AppError('txHash must be a string', 400);
  }

  if (!txHash.startsWith('0x')) {
    throw new AppError('txHash must start with 0x', 400);
  }

  if (txHash.length !== 66) {
    throw new AppError('txHash must be 66 characters long', 400);
  }

  next();
};

export const validateAmount = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const { amountInEth } = req.body;

  if (!amountInEth) {
    throw new AppError('amountInEth is required', 400);
  }

  if (typeof amountInEth !== 'string') {
    throw new AppError('amountInEth must be a string', 400);
  }

  const amount = parseFloat(amountInEth);
  if (isNaN(amount) || amount <= 0) {
    throw new AppError('amountInEth must be a positive number', 400);
  }

  next();
};
