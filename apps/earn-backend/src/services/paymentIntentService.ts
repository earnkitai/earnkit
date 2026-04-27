import {
  LedgerEntryStatus,
  LedgerEntryType,
  PaymentIntentStatus,
  PaymentMethodType,
  Prisma,
} from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';

const DEFAULT_PAYMENT_INTENT_TTL_MS = 30 * 60 * 1000;

export interface CreatePaymentIntentInput {
  agentId: string;
  userId?: string;
  amountAtomic: string;
  chainId: number;
  amountInUSD?: string;
  creditsToTopUp?: bigint | number;
  customerWalletAddress?: string;
  tokenAddress?: string;
  tokenSymbol?: string;
  externalReference?: string;
  metadata?: Prisma.InputJsonValue;
  expiresAt?: Date;
}

export interface RecordPaymentSeenInput {
  paymentIntentId: string;
  txHash: string;
  customerWalletAddress?: string;
}

export class PaymentIntentService {
  static async createPaymentIntent(input: CreatePaymentIntentInput) {
    const agent = await prisma.agent.findFirst({
      where: {
        agentId: input.agentId,
        ...(input.userId ? { userId: input.userId } : {}),
      },
      select: { id: true },
    });

    if (!agent) {
      throw new Error('Agent not found');
    }

    const paymentMethodType =
      input.tokenAddress && input.tokenAddress.toLowerCase() !== 'eth'
        ? PaymentMethodType.ERC20
        : PaymentMethodType.ETH;

    const expiresAt =
      input.expiresAt ??
      new Date(Date.now() + DEFAULT_PAYMENT_INTENT_TTL_MS);
    const clientSecret = `pi_${uuidv4().replace(/-/g, '')}_secret_${uuidv4().replace(/-/g, '')}`;

    return prisma.$transaction(async (tx) => {
      const paymentIntent = await tx.paymentIntent.create({
        data: {
          agentId: agent.id,
          clientSecret,
          externalReference: input.externalReference,
          status: PaymentIntentStatus.REQUIRES_PAYMENT,
          customerWalletAddress: input.customerWalletAddress?.toLowerCase(),
          amountInUSD: input.amountInUSD,
          creditsToTopUp:
            input.creditsToTopUp === undefined
              ? undefined
              : BigInt(input.creditsToTopUp),
          paymentMethodType,
          tokenAddress: input.tokenAddress?.toLowerCase(),
          tokenSymbol: input.tokenSymbol,
          amountAtomic: input.amountAtomic,
          chainId: input.chainId,
          metadata: input.metadata,
          expiresAt,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          agentId: agent.id,
          paymentIntentId: paymentIntent.id,
          userWalletAddress: input.customerWalletAddress?.toLowerCase(),
          entryType: LedgerEntryType.PAYMENT_INTENT_CREATED,
          status: LedgerEntryStatus.POSTED,
          amountInUSD: input.amountInUSD,
          credits:
            input.creditsToTopUp === undefined
              ? undefined
              : BigInt(input.creditsToTopUp),
          paymentMethodType,
          tokenAddress: input.tokenAddress?.toLowerCase(),
          tokenSymbol: input.tokenSymbol,
          amountAtomic: input.amountAtomic,
          chainId: input.chainId,
          metadata: input.metadata,
        },
      });

      return paymentIntent;
    });
  }

  static async recordPaymentSeen(input: RecordPaymentSeenInput) {
    return prisma.$transaction(async (tx) => {
      const paymentIntent = await tx.paymentIntent.update({
        where: { id: input.paymentIntentId },
        data: {
          status: PaymentIntentStatus.PROCESSING,
          txHash: input.txHash,
          customerWalletAddress: input.customerWalletAddress?.toLowerCase(),
        },
      });

      await tx.ledgerEntry.create({
        data: {
          agentId: paymentIntent.agentId,
          paymentIntentId: paymentIntent.id,
          userWalletAddress:
            input.customerWalletAddress?.toLowerCase() ??
            paymentIntent.customerWalletAddress,
          entryType: LedgerEntryType.PAYMENT_RECEIVED,
          status: LedgerEntryStatus.PENDING,
          amountInUSD: paymentIntent.amountInUSD,
          credits: paymentIntent.creditsToTopUp,
          paymentMethodType: paymentIntent.paymentMethodType,
          tokenAddress: paymentIntent.tokenAddress,
          tokenSymbol: paymentIntent.tokenSymbol,
          amountAtomic: paymentIntent.amountAtomic,
          chainId: paymentIntent.chainId,
          txHash: input.txHash,
        },
      });

      return paymentIntent;
    });
  }

  static async getByClientSecret(clientSecret: string, userId?: string) {
    return prisma.paymentIntent.findFirst({
      where: {
        clientSecret,
        ...(userId ? { agent: { userId } } : {}),
      },
    });
  }
}
