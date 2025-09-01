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
  async track(params: TrackParams): Promise<{ eventId: string }> {
    const {
      agentId,
      walletAddress,
      idempotencyKey,
      creditsToDeduct = 1,
    } = params;

    // Check for idempotency
    if (idempotencyKey) {
      const existingEvent = await prisma.usageEvent.findFirst({
        where: {
          agentId,
          idempotencyKey,
        },
      });
      if (existingEvent) {
        return { eventId: existingEvent.id };
      }
    }

    // Get or create user balance
    let userBalance = await prisma.userBalance.findUnique({
      where: {
        userWalletAddress_agentId: {
          userWalletAddress: walletAddress,
          agentId,
        },
      },
    });

    if (!userBalance) {
      // Create new user balance with default credits
      userBalance = await prisma.userBalance.create({
        data: {
          userWalletAddress: walletAddress,
          agentId,
          creditBalance: BigInt(100), // Default 100 credits
          ethBalance: 0,
        },
      });
    }

    // Check if user has enough credits
    const currentCredits = Number(userBalance.creditBalance);
    if (currentCredits < creditsToDeduct) {
      throw new Error(
        `Insufficient credits. Required: ${creditsToDeduct}, Available: ${currentCredits}`,
      );
    }

    // Create new event
    const eventId = uuidv4();
    const event = await prisma.usageEvent.create({
      data: {
        id: eventId,
        agentId,
        userWalletAddress: walletAddress,
        idempotencyKey,
        creditsDeducted: BigInt(creditsToDeduct),
        status: 'PENDING',
      },
    });

    // Provisionally deduct credits
    await prisma.userBalance.update({
      where: {
        userWalletAddress_agentId: {
          userWalletAddress: walletAddress,
          agentId,
        },
      },
      data: {
        creditBalance: BigInt(currentCredits - creditsToDeduct),
      },
    });

    return { eventId: event.id };
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
      status: event.status.toLowerCase() as 'pending' | 'captured' | 'released',
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
      status: event.status.toLowerCase() as 'pending' | 'captured' | 'released',
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    }));
  }
}
