import {
  LedgerEntryStatus,
  LedgerEntryType,
  PaymentIntentStatus,
  PaymentMethodType,
  Prisma,
} from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { WebhookService } from './webhookService';

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
    if (!input.userId) throw new Error('Authentication required');

    const agent = await prisma.agent.findFirst({
      where: { agentId: input.agentId, userId: input.userId },
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
    const paymentIntent = await prisma.$transaction(async (tx) => {
      const pi = await tx.paymentIntent.update({
        where: { id: input.paymentIntentId },
        data: {
          status: PaymentIntentStatus.PROCESSING,
          txHash: input.txHash,
          customerWalletAddress: input.customerWalletAddress?.toLowerCase(),
        },
      });

      await tx.ledgerEntry.create({
        data: {
          agentId: pi.agentId,
          paymentIntentId: pi.id,
          userWalletAddress:
            input.customerWalletAddress?.toLowerCase() ??
            pi.customerWalletAddress,
          entryType: LedgerEntryType.PAYMENT_RECEIVED,
          status: LedgerEntryStatus.PENDING,
          amountInUSD: pi.amountInUSD,
          credits: pi.creditsToTopUp,
          paymentMethodType: pi.paymentMethodType,
          tokenAddress: pi.tokenAddress,
          tokenSymbol: pi.tokenSymbol,
          amountAtomic: pi.amountAtomic,
          chainId: pi.chainId,
          txHash: input.txHash,
        },
      });

      return pi;
    });

    // Enqueue webhook outside the transaction — non-fatal if it fails
    WebhookService.enqueuePaymentIntentEvent(paymentIntent, 'payment_intent.processing').catch((e) =>
      console.error('[PaymentIntentService] Webhook enqueue failed (processing):', e),
    );

    return paymentIntent;
  }

  static async getByClientSecret(clientSecret: string, userId?: string) {
    return prisma.paymentIntent.findFirst({
      where: {
        clientSecret,
        ...(userId ? { agent: { userId } } : {}),
      },
    });
  }

  /**
   * Mark a payment intent SUCCEEDED, grant credits atomically, and post a
   * ledger entry. Call this once on-chain confirmation is verified.
   *
   * Cross-path double-credit guard: writes a LedgerEntry with
   * idempotencyKey=txHash (or PI id when no txHash). The
   * @@unique([agentId, idempotencyKey]) constraint serializes against the
   * top-up worker's verifyAndCredit, so a single on-chain payment can be
   * credited at most once across the two paths.
   */
  static async confirmPayment(paymentIntentId: string) {
    let confirmedPi;
    try {
      confirmedPi = await prisma.$transaction(async (tx) => {
        const pi = await tx.paymentIntent.update({
          where: {
            id: paymentIntentId,
            status: PaymentIntentStatus.PROCESSING,
          },
          data: {
            status: PaymentIntentStatus.SUCCEEDED,
            confirmedAt: new Date(),
          },
        });

        // Lock-style guard: this insert is the single point at which credits
        // are issued. If another path already credited the same txHash, the
        // unique constraint trips and the entire transaction rolls back.
        await tx.ledgerEntry.create({
          data: {
            agentId: pi.agentId,
            paymentIntentId: pi.id,
            userWalletAddress: pi.customerWalletAddress,
            entryType: LedgerEntryType.CREDIT_GRANTED,
            status: LedgerEntryStatus.POSTED,
            amountInUSD: pi.amountInUSD,
            credits: pi.creditsToTopUp,
            paymentMethodType: pi.paymentMethodType,
            tokenAddress: pi.tokenAddress,
            tokenSymbol: pi.tokenSymbol,
            amountAtomic: pi.amountAtomic,
            chainId: pi.chainId,
            txHash: pi.txHash,
            idempotencyKey: pi.txHash ?? pi.id,
          },
        });

        if (pi.creditsToTopUp && pi.customerWalletAddress) {
          await tx.userBalance.upsert({
            where: {
              userWalletAddress_agentId: {
                userWalletAddress: pi.customerWalletAddress,
                agentId: pi.agentId,
              },
            },
            update: { creditBalance: { increment: pi.creditsToTopUp } },
            create: {
              userWalletAddress: pi.customerWalletAddress,
              agentId: pi.agentId,
              creditBalance: pi.creditsToTopUp,
              ethBalance: 0,
            },
          });
        }

        return pi;
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Cross-path duplicate. Mark the PI succeeded for the operator view
        // (no credit grant — already happened on the other path) and return.
        const pi = await prisma.paymentIntent.update({
          where: { id: paymentIntentId },
          data: {
            status: PaymentIntentStatus.SUCCEEDED,
            confirmedAt: new Date(),
          },
        });
        console.log(
          `[PaymentIntentService] ${paymentIntentId} already credited (idempotency hit); status set to SUCCEEDED.`,
        );
        return pi;
      }
      throw err;
    }

    // Enqueue webhook outside the transaction — non-fatal if it fails
    WebhookService.enqueuePaymentIntentEvent(confirmedPi, 'payment_intent.succeeded').catch((e) =>
      console.error('[PaymentIntentService] Webhook enqueue failed (succeeded):', e),
    );

    return confirmedPi;
  }
}
