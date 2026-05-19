import {
  LedgerEntryStatus,
  LedgerEntryType,
  PaymentIntentStatus,
  PaymentMethodType,
  Prisma,
} from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { parseUnits } from 'viem';
import { prisma } from '../lib/prisma';
import { WebhookService } from './webhookService';
import { priceService } from './priceService';
import { tokenService } from './tokenService';
import { normalizeWalletOptional } from '../lib/wallet';

const DEFAULT_PAYMENT_INTENT_TTL_MS = 30 * 60 * 1000;

export interface CreatePaymentIntentInput {
  agentId: string;
  userId?: string;
  // When packageId is provided the server derives amountAtomic / credits /
  // USD from the TopUpPackage + AgentTokenConfig discount + live token price.
  // Client-supplied amountAtomic / creditsToTopUp / amountInUSD are ignored
  // in that case — the package is the contract, not the request body.
  packageId?: string;
  amountAtomic?: string;
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

    const normalizedCustomerWallet = normalizeWalletOptional(
      input.customerWalletAddress,
    );

    const agent = await prisma.agent.findFirst({
      where: { agentId: input.agentId, userId: input.userId },
      select: { id: true },
    });

    if (!agent) {
      throw new Error('Agent not found');
    }

    // When packageId is supplied, derive the canonical quote on the server
    // from package + agent token config + live price. This is the path used
    // by the top-up modal — it means the verifier never has to reprice
    // on-chain amounts, eliminating the partial-credit drift bug.
    let resolvedAmountAtomic = input.amountAtomic;
    let resolvedCredits: bigint | number | undefined = input.creditsToTopUp;
    let resolvedAmountInUSD = input.amountInUSD;
    let resolvedTokenAddress = input.tokenAddress;
    let resolvedTokenSymbol = input.tokenSymbol;

    if (input.packageId) {
      const pkg = await prisma.topUpPackage.findFirst({
        where: { id: input.packageId, agentId: agent.id, isActive: true },
      });
      if (!pkg) throw new Error('Top-up package not found for this agent');

      // Resolve the chosen token: undefined or "eth" means ETH; anything
      // else must match a supported token (case-insensitive).
      const isEth =
        !input.tokenAddress || input.tokenAddress.toLowerCase() === 'eth';

      // Pull the agent's per-token config to discover the discountPercent
      // for this token. Missing config falls back to 0% (no discount), which
      // matches getTopUpDetails' default-token behaviour.
      const tokenKey = isEth ? 'eth' : input.tokenAddress!.toLowerCase();
      const tokenConfig = await prisma.agentTokenConfig.findFirst({
        where: { agentId: agent.id, tokenAddress: tokenKey },
      });

      if (tokenConfig && !tokenConfig.enabled) {
        throw new Error('Selected token is disabled for this agent');
      }

      const discountPercent = tokenConfig?.discountPercent ?? 0;
      const effectiveUsd =
        discountPercent > 0
          ? pkg.price * (1 - discountPercent / 100)
          : pkg.price;

      if (isEth) {
        const ethPrice = await priceService.getEthPrice();
        const ethAmount = effectiveUsd / ethPrice;
        // Floor to whole wei to avoid asking the user to send a fractional unit.
        resolvedAmountAtomic = BigInt(Math.floor(ethAmount * 1e18)).toString();
        resolvedTokenAddress = undefined;
        resolvedTokenSymbol = undefined;
      } else {
        const tokenInfo = tokenService.getTokenByAddress(tokenKey);
        if (!tokenInfo) {
          throw new Error(`Token ${tokenKey} is not supported`);
        }
        const tokenPrice = await priceService.getTokenPrice(
          tokenInfo.coingeckoPlatformId,
          tokenInfo.address,
        );
        const tokenAmount = effectiveUsd / tokenPrice;
        // parseUnits avoids float drift when multiplying by 10^decimals for
        // high-decimal tokens (USDC is 6, but generic ERC-20s commonly 18).
        const tokenAmountFixed = tokenAmount.toFixed(tokenInfo.decimals);
        resolvedAmountAtomic = parseUnits(
          tokenAmountFixed,
          tokenInfo.decimals,
        ).toString();
        resolvedTokenAddress = tokenInfo.address.toLowerCase();
        resolvedTokenSymbol = tokenInfo.symbol;
      }

      resolvedCredits = pkg.credits;
      resolvedAmountInUSD = effectiveUsd.toFixed(2);
    }

    if (!resolvedAmountAtomic) {
      throw new Error('amountAtomic or packageId is required');
    }

    const paymentMethodType =
      resolvedTokenAddress && resolvedTokenAddress.toLowerCase() !== 'eth'
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
          customerWalletAddress: normalizedCustomerWallet,
          amountInUSD: resolvedAmountInUSD,
          creditsToTopUp:
            resolvedCredits === undefined
              ? undefined
              : BigInt(resolvedCredits),
          paymentMethodType,
          tokenAddress: resolvedTokenAddress?.toLowerCase(),
          tokenSymbol: resolvedTokenSymbol,
          amountAtomic: resolvedAmountAtomic,
          chainId: input.chainId,
          metadata: input.metadata,
          expiresAt,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          agentId: agent.id,
          paymentIntentId: paymentIntent.id,
          userWalletAddress: normalizedCustomerWallet,
          entryType: LedgerEntryType.PAYMENT_INTENT_CREATED,
          status: LedgerEntryStatus.POSTED,
          amountInUSD: resolvedAmountInUSD,
          credits:
            resolvedCredits === undefined
              ? undefined
              : BigInt(resolvedCredits),
          paymentMethodType,
          tokenAddress: resolvedTokenAddress?.toLowerCase(),
          tokenSymbol: resolvedTokenSymbol,
          amountAtomic: resolvedAmountAtomic,
          chainId: input.chainId,
          metadata: input.metadata,
        },
      });

      return paymentIntent;
    });
  }

  // Idempotent on retry — see docs/06_RELIABILITY_FIXES_2026_05_14.md §8.
  static async recordPaymentSeen(input: RecordPaymentSeenInput) {
    const normalizedCustomerWallet = normalizeWalletOptional(
      input.customerWalletAddress,
    );

    let isDuplicate = false;
    let paymentIntent;
    try {
      paymentIntent = await prisma.$transaction(async (tx) => {
        const pi = await tx.paymentIntent.update({
          where: { id: input.paymentIntentId },
          data: {
            status: PaymentIntentStatus.PROCESSING,
            txHash: input.txHash,
            customerWalletAddress: normalizedCustomerWallet,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            agentId: pi.agentId,
            paymentIntentId: pi.id,
            userWalletAddress:
              normalizedCustomerWallet ?? pi.customerWalletAddress,
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
            // Distinct namespace from confirmPayment's key (pi.txHash ?? pi.id).
            idempotencyKey: `processing:${pi.id}`,
          },
        });

        return pi;
      });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'P2002') {
        isDuplicate = true;
        const existing = await prisma.paymentIntent.findUnique({
          where: { id: input.paymentIntentId },
        });
        if (!existing) throw err;
        paymentIntent = existing;
      } else {
        throw err;
      }
    }

    if (!isDuplicate) {
      WebhookService.enqueuePaymentIntentEvent(paymentIntent, 'payment_intent.processing').catch((e) =>
        console.error('[PaymentIntentService] Webhook enqueue failed (processing):', e),
      );
    }

    return paymentIntent;
  }

  // userId required — see docs §10 (IDOR via missing ownership filter).
  static async getByClientSecret(clientSecret: string, userId: string) {
    if (!userId) throw new Error('Authentication required');
    return prisma.paymentIntent.findFirst({
      where: {
        clientSecret,
        agent: { userId },
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

        if (pi.creditsToTopUp) {
          if (!pi.customerWalletAddress) {
            throw new Error(
              `PI ${pi.id} has creditsToTopUp but no customerWalletAddress — cannot grant credits`,
            );
          }
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
