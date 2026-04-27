import {
  PaymentIntent,
  WebhookDeliveryStatus,
  WebhookEndpoint,
} from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';

export interface RegisterWebhookEndpointInput {
  agentId: string;
  userId?: string;
  url: string;
  events?: string[];
}

export class WebhookService {
  static async registerEndpoint(input: RegisterWebhookEndpointInput) {
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

    return prisma.webhookEndpoint.create({
      data: {
        agentId: agent.id,
        url: input.url,
        secret: `whsec_${uuidv4().replace(/-/g, '')}`,
        events: input.events ?? [],
      },
    });
  }

  static async enqueuePaymentIntentEvent(
    paymentIntent: PaymentIntent,
    eventType: string,
  ) {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: {
        agentId: paymentIntent.agentId,
        enabled: true,
      },
    });

    const interestedEndpoints = endpoints.filter((endpoint) =>
      this.shouldDeliver(endpoint, eventType),
    );

    if (interestedEndpoints.length === 0) {
      return [];
    }

    const payload = {
      id: `evt_${uuidv4().replace(/-/g, '')}`,
      type: eventType,
      createdAt: new Date().toISOString(),
      data: {
        object: 'payment_intent',
        paymentIntent: {
          id: paymentIntent.id,
          agentId: paymentIntent.agentId,
          status: paymentIntent.status,
          externalReference: paymentIntent.externalReference,
          customerWalletAddress: paymentIntent.customerWalletAddress,
          amountInUSD: paymentIntent.amountInUSD?.toString() ?? null,
          creditsToTopUp: paymentIntent.creditsToTopUp?.toString() ?? null,
          paymentMethodType: paymentIntent.paymentMethodType,
          tokenAddress: paymentIntent.tokenAddress,
          tokenSymbol: paymentIntent.tokenSymbol,
          amountAtomic: paymentIntent.amountAtomic,
          chainId: paymentIntent.chainId,
          txHash: paymentIntent.txHash,
          expiresAt: paymentIntent.expiresAt?.toISOString() ?? null,
          confirmedAt: paymentIntent.confirmedAt?.toISOString() ?? null,
          cancelledAt: paymentIntent.cancelledAt?.toISOString() ?? null,
          createdAt: paymentIntent.createdAt.toISOString(),
          updatedAt: paymentIntent.updatedAt.toISOString(),
        },
      },
    };

    await prisma.webhookDelivery.createMany({
      data: interestedEndpoints.map((endpoint) => ({
        endpointId: endpoint.id,
        paymentIntentId: paymentIntent.id,
        eventType,
        status: WebhookDeliveryStatus.PENDING,
        payload,
      })),
    });

    return interestedEndpoints;
  }

  private static shouldDeliver(
    endpoint: Pick<WebhookEndpoint, 'events'>,
    eventType: string,
  ) {
    return endpoint.events.length === 0 || endpoint.events.includes(eventType);
  }
}
