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
    const { agentId, walletAddress, idempotencyKey, creditsToDeduct } = params;

    // First, get the agent's internal ID and creditsPerPrompt using the agent_id field
    const agent = await prisma.agent.findUnique({
      where: {
        agentId: agentId,
      },
      select: {
        id: true,
        creditsPerPrompt: true,
      },
    });

    if (!agent) {
      throw new Error(`Agent with agentId ${agentId} not found`);
    }

    const internalAgentId = agent.id;

    // Use the agent's creditsPerPrompt if not specified in params, fallback to 1 if not set
    const creditsToDeductFinal = creditsToDeduct ?? agent.creditsPerPrompt ?? 1;

    // Check for idempotency
    if (idempotencyKey) {
      const existingEvent = await prisma.usageEvent.findFirst({
        where: {
          agentId: internalAgentId,
          idempotencyKey,
        },
      });
      if (existingEvent) {
        return {
          eventId: existingEvent.id,
          insufficientCredits: false,
          creditsRequired: 0,
          creditsAvailable: 0,
        };
      }
    }

    // Get or create user balance
    let userBalance = await prisma.userBalance.findUnique({
      where: {
        userWalletAddress_agentId: {
          userWalletAddress: walletAddress,
          agentId: internalAgentId,
        },
      },
    });

    if (!userBalance) {
      // Create new user balance with default credits
      userBalance = await prisma.userBalance.create({
        data: {
          userWalletAddress: walletAddress,
          agentId: internalAgentId,
          creditBalance: BigInt(100), // Default 100 credits
          ethBalance: 0,
        },
      });
    }

    // Check if user has enough credits
    const currentCredits = Number(userBalance.creditBalance);
    const hasInsufficientCredits = currentCredits < creditsToDeductFinal;

    // Create new event
    const eventId = uuidv4();
    const event = await prisma.usageEvent.create({
      data: {
        id: eventId,
        agentId: internalAgentId,
        userWalletAddress: walletAddress,
        idempotencyKey,
        creditsDeducted: BigInt(
          hasInsufficientCredits ? 0 : creditsToDeductFinal,
        ),
        status: hasInsufficientCredits
          ? ('INSUFFICIENT_CREDITS' as const)
          : ('PENDING' as const),
      },
    });

    // Only deduct credits if user has enough
    if (!hasInsufficientCredits) {
      await prisma.userBalance.update({
        where: {
          userWalletAddress_agentId: {
            userWalletAddress: walletAddress,
            agentId: internalAgentId,
          },
        },
        data: {
          creditBalance: BigInt(currentCredits - creditsToDeductFinal),
        },
      });
    }

    return {
      eventId: event.id,
      insufficientCredits: hasInsufficientCredits,
      creditsRequired: creditsToDeductFinal,
      creditsAvailable: currentCredits,
    };
  }

  /**
   * Captures a tracked event, finalizing the charge
   */
  async capture(params: CaptureParams): Promise<{ success: boolean }> {
    const { eventId } = params;

    const event = await prisma.usageEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new Error(`Event not found: ${eventId}`);
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

    // Update event status
    await prisma.usageEvent.update({
      where: { id: eventId },
      data: { status: 'COMPLETED' },
    });

    return { success: true };
  }

  /**
   * Releases a tracked event, refunding provisionally held credits
   */
  async release(params: ReleaseParams): Promise<{ success: boolean }> {
    const { eventId } = params;

    const event = await prisma.usageEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new Error(`Event not found: ${eventId}`);
    }

    if (event.status === ('INSUFFICIENT_CREDITS' as const)) {
      // For insufficient credits events, just update status to cancelled (no refund needed)
      await prisma.usageEvent.update({
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

    // Refund credits
    if (event.creditsDeducted) {
      const userBalance = await prisma.userBalance.findUnique({
        where: {
          userWalletAddress_agentId: {
            userWalletAddress: event.userWalletAddress,
            agentId: event.agentId,
          },
        },
      });

      if (userBalance) {
        const currentCredits = Number(userBalance.creditBalance);
        await prisma.userBalance.update({
          where: {
            userWalletAddress_agentId: {
              userWalletAddress: event.userWalletAddress,
              agentId: event.agentId,
            },
          },
          data: {
            creditBalance: BigInt(
              currentCredits + Number(event.creditsDeducted),
            ),
          },
        });
      }
    }

    // Update event status
    await prisma.usageEvent.update({
      where: { id: eventId },
      data: { status: 'CANCELLED' },
    });

    return { success: true };
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
