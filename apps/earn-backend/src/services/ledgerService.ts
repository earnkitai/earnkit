import {
  LedgerEntryStatus,
  LedgerEntryType,
  PaymentMethodType,
  Prisma,
} from '@prisma/client';
import { prisma } from '../lib/prisma';

export interface CreateLedgerEntryInput {
  agentId: string;
  paymentIntentId?: string;
  userWalletAddress?: string;
  entryType: LedgerEntryType;
  status?: LedgerEntryStatus;
  amountInUSD?: string;
  credits?: bigint | number;
  paymentMethodType?: PaymentMethodType;
  tokenAddress?: string;
  tokenSymbol?: string;
  amountAtomic?: string;
  chainId?: number;
  txHash?: string;
  idempotencyKey?: string;
  metadata?: Prisma.InputJsonValue;
}

export class LedgerService {
  static async record(input: CreateLedgerEntryInput) {
    return prisma.ledgerEntry.create({
      data: {
        agentId: input.agentId,
        paymentIntentId: input.paymentIntentId,
        userWalletAddress: input.userWalletAddress?.toLowerCase(),
        entryType: input.entryType,
        status: input.status ?? LedgerEntryStatus.POSTED,
        amountInUSD: input.amountInUSD,
        credits:
          input.credits === undefined ? undefined : BigInt(input.credits),
        paymentMethodType: input.paymentMethodType ?? PaymentMethodType.ETH,
        tokenAddress: input.tokenAddress?.toLowerCase(),
        tokenSymbol: input.tokenSymbol,
        amountAtomic: input.amountAtomic,
        chainId: input.chainId,
        txHash: input.txHash,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      },
    });
  }

  static async listForAgent(agentId: string, limit = 50) {
    return prisma.ledgerEntry.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
  }
}
