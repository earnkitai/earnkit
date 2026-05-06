import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import {
  TrackedEvent,
  TrackParams,
  CaptureParams,
  ReleaseParams,
} from '../types';

export class EventService {
  /**
   * Tracks a new event and provisionally deducts credits
   */
  async track(params: TrackParams): Promise<{
    eventId: string;
    insufficientCredits: boolean;
    creditsRequired: number;
    creditsAvailable: number;
  }> {
    const { agentId, walletAddress, idempotencyKey, creditsToDeduct, userId } =
      params;

    return prisma.$transaction(async (tx) => {
      if (!userId) throw new Error('Authentication required');

      const agent = await tx.agent.findFirst({
        where: { agentId, userId },
        select: {
          id: true,
          creditsPerPrompt: true,
        },
      });

      if (!agent) {
        throw new Error(`Agent with agentId ${agentId} not found`);
      }

      const internalAgentId = agent.id;
      const creditsToDeductFinal =
        creditsToDeduct ?? agent.creditsPerPrompt ?? 1;
      const creditsToDeductBigInt = BigInt(creditsToDeductFinal);

      if (idempotencyKey) {
        const existingEvent = await tx.usageEvent.findFirst({
          where: {
            agentId: internalAgentId,
            idempotencyKey,
          },
        });

        if (existingEvent) {
          return {
            eventId: existingEvent.id,
            insufficientCredits: existingEvent.status === 'INSUFFICIENT_CREDITS',
            creditsRequired: Number(existingEvent.creditsDeducted || 0),
            creditsAvailable: 0,
          };
        }
      }

      let userBalance = await tx.userBalance.findUnique({
        where: {
          userWalletAddress_agentId: {
            userWalletAddress: walletAddress,
            agentId: internalAgentId,
          },
        },
      });

      if (!userBalance) {
        userBalance = await tx.userBalance.create({
          data: {
            userWalletAddress: walletAddress,
            agentId: internalAgentId,
            creditBalance: BigInt(0),
            ethBalance: 0,
          },
        });
      }

      const currentCredits = userBalance.creditBalance;
      const hasInsufficientCredits = currentCredits < creditsToDeductBigInt;
      const eventId = uuidv4();

      if (hasInsufficientCredits) {
        const event = await tx.usageEvent.create({
          data: {
            id: eventId,
            agentId: internalAgentId,
            userWalletAddress: walletAddress,
            idempotencyKey,
            creditsDeducted: BigInt(0),
            status: 'INSUFFICIENT_CREDITS',
          },
        });

        return {
          eventId: event.id,
          insufficientCredits: true,
          creditsRequired: creditsToDeductFinal,
          creditsAvailable: Number(currentCredits),
        };
      }

      const updatedBalance = await tx.userBalance.updateMany({
        where: {
          userWalletAddress: walletAddress,
          agentId: internalAgentId,
          creditBalance: {
            gte: creditsToDeductBigInt,
          },
        },
        data: {
          creditBalance: {
            decrement: creditsToDeductBigInt,
          },
        },
      });

      if (updatedBalance.count === 0) {
        const freshBalance = await tx.userBalance.findUnique({
          where: {
            userWalletAddress_agentId: {
              userWalletAddress: walletAddress,
              agentId: internalAgentId,
            },
          },
        });

        const event = await tx.usageEvent.create({
          data: {
            id: eventId,
            agentId: internalAgentId,
            userWalletAddress: walletAddress,
            idempotencyKey,
            creditsDeducted: BigInt(0),
            status: 'INSUFFICIENT_CREDITS',
          },
        });

        return {
          eventId: event.id,
          insufficientCredits: true,
          creditsRequired: creditsToDeductFinal,
          creditsAvailable: Number(freshBalance?.creditBalance || 0),
        };
      }

      const event = await tx.usageEvent.create({
        data: {
          id: eventId,
          agentId: internalAgentId,
          userWalletAddress: walletAddress,
          idempotencyKey,
          creditsDeducted: creditsToDeductBigInt,
          status: 'PENDING',
        },
      });

      return {
        eventId: event.id,
        insufficientCredits: false,
        creditsRequired: creditsToDeductFinal,
        creditsAvailable: Number(currentCredits),
      };
    });
  }

  /**
   * Captures a tracked event, finalizing the charge
   */
  async capture(params: CaptureParams): Promise<{ success: boolean }> {
    const { eventId, userId } = params;

    const event = await prisma.usageEvent.findUnique({
      where: { id: eventId },
      include: {
        agent: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!event) {
      throw new Error(`Event not found: ${eventId}`);
    }

    if (!userId) throw new Error('Authentication required');
    if (event.agent.userId !== userId) {
      throw new Error('Event not found for this API key');
    }

    if (event.status === ('INSUFFICIENT_CREDITS' as const)) {
      throw new Error(
        `Event cannot be captured due to insufficient credits. Please top up your account.`,
      );
    }

    if (event.status !== 'PENDING') {
      throw new Error(
        `Event cannot be captured. Current status: ${event.status}`,
      );
    }

    const update = await prisma.usageEvent.updateMany({
      where: { id: eventId, status: 'PENDING' },
      data: { status: 'COMPLETED' },
    });

    if (update.count === 0) {
      throw new Error(`Event cannot be captured. Current status: ${event.status}`);
    }

    return { success: true };
  }

  /**
   * Releases a tracked event, refunding provisionally held credits
   */
  async release(params: ReleaseParams): Promise<{ success: boolean }> {
    const { eventId, userId } = params;

    return prisma.$transaction(async (tx) => {
      const event = await tx.usageEvent.findUnique({
        where: { id: eventId },
        include: {
          agent: {
            select: {
              userId: true,
            },
          },
        },
      });

      if (!event) {
        throw new Error(`Event not found: ${eventId}`);
      }

      if (!userId) throw new Error('Authentication required');
      if (event.agent.userId !== userId) {
        throw new Error('Event not found for this API key');
      }

      if (event.status === ('INSUFFICIENT_CREDITS' as const)) {
        await tx.usageEvent.update({
          where: { id: eventId },
          data: { status: 'CANCELLED' },
        });
        return { success: true };
      }

      if (event.status !== 'PENDING') {
        throw new Error(
          `Event cannot be released. Current status: ${event.status}`,
        );
      }

      const update = await tx.usageEvent.updateMany({
        where: { id: eventId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });

      if (update.count === 0) {
        throw new Error(
          `Event cannot be released. Current status: ${event.status}`,
        );
      }

      if (event.creditsDeducted && event.creditsDeducted > BigInt(0)) {
        await tx.userBalance.update({
          where: {
            userWalletAddress_agentId: {
              userWalletAddress: event.userWalletAddress,
              agentId: event.agentId,
            },
          },
          data: {
            creditBalance: {
              increment: event.creditsDeducted,
            },
          },
        });
      }

      return { success: true };
    });
  }

  /**
   * Get event by ID
   */
  async getEvent(eventId: string): Promise<TrackedEvent | null> {
    const event = await prisma.usageEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) return null;

    return {
      eventId: event.id,
      agentId: event.agentId,
      walletAddress: event.userWalletAddress,
      idempotencyKey: event.idempotencyKey || undefined,
      creditsToDeduct: event.creditsDeducted
        ? Number(event.creditsDeducted)
        : undefined,
      status: event.status.toLowerCase() as
        | 'pending'
        | 'captured'
        | 'released'
        | 'insufficient_credits',
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
  }

  /**
   * Get all events for debugging
   */
  async getAllEvents(): Promise<TrackedEvent[]> {
    const events = await prisma.usageEvent.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return events.map((event: any) => ({
      eventId: event.id,
      agentId: event.agentId,
      walletAddress: event.userWalletAddress,
      idempotencyKey: event.idempotencyKey || undefined,
      creditsToDeduct: event.creditsDeducted
        ? Number(event.creditsDeducted)
        : undefined,
      status: event.status.toLowerCase() as
        | 'pending'
        | 'captured'
        | 'released'
        | 'insufficient_credits',
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    }));
  }
}
