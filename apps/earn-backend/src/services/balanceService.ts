import { prisma } from '../lib/prisma';
import { UserBalance } from '../types';

export class BalanceService {
  /**
   * Get user balance by wallet address
   */
  async getBalance(
    walletAddress: string,
    agentId: string,
    userId?: string,
  ): Promise<UserBalance> {
    if (!userId) throw new Error('Authentication required');

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId },
      select: { id: true },
    });

    if (!agent) {
      throw new Error(`Agent with agentId ${agentId} not found`);
    }

    const balance = await prisma.userBalance.findUnique({
      where: {
        userWalletAddress_agentId: {
          userWalletAddress: walletAddress,
          agentId: agent.id, // Use the internal ID, not the agent_id
        },
      },
    });

    if (!balance) {
      // Create new user balance with default credits
      const newBalance = await prisma.userBalance.create({
        data: {
          userWalletAddress: walletAddress,
          agentId: agent.id,
          creditBalance: BigInt(10),
          ethBalance: 0,
        },
      });

      return {
        eth: newBalance.ethBalance.toString(),
        credits: newBalance.creditBalance.toString(),
      };
    }

    return {
      eth: balance.ethBalance.toString(),
      credits: balance.creditBalance.toString(),
    };
  }

  /**
   * Add credits to user balance — atomic increment, no read-then-write race.
   */
  async addCredits(
    walletAddress: string,
    agentId: string,
    creditsToAdd: number,
  ): Promise<UserBalance> {
    const agent = await prisma.agent.findFirst({
      where: { agentId },
      select: { id: true },
    });
    if (!agent) throw new Error(`Agent with agentId ${agentId} not found`);

    const result = await prisma.userBalance.upsert({
      where: {
        userWalletAddress_agentId: {
          userWalletAddress: walletAddress,
          agentId: agent.id,
        },
      },
      update: { creditBalance: { increment: BigInt(creditsToAdd) } },
      create: {
        userWalletAddress: walletAddress,
        agentId: agent.id,
        creditBalance: BigInt(creditsToAdd),
        ethBalance: 0,
      },
    });

    return {
      eth: result.ethBalance.toString(),
      credits: result.creditBalance.toString(),
    };
  }

  /**
   * Deduct credits from user balance — atomic conditional decrement so
   * concurrent track() calls cannot oversubscribe credits.
   */
  async deductCredits(
    walletAddress: string,
    agentId: string,
    creditsToDeduct: number,
  ): Promise<UserBalance> {
    const agent = await prisma.agent.findFirst({
      where: { agentId },
      select: { id: true },
    });
    if (!agent) throw new Error(`Agent with agentId ${agentId} not found`);

    const amount = BigInt(creditsToDeduct);

    // Conditional update: only succeeds if the row exists AND has enough credits.
    const result = await prisma.userBalance.updateMany({
      where: {
        userWalletAddress: walletAddress,
        agentId: agent.id,
        creditBalance: { gte: amount },
      },
      data: { creditBalance: { decrement: amount } },
    });

    if (result.count === 0) {
      const existing = await prisma.userBalance.findUnique({
        where: {
          userWalletAddress_agentId: {
            userWalletAddress: walletAddress,
            agentId: agent.id,
          },
        },
      });
      const available = existing ? existing.creditBalance.toString() : '0';
      throw new Error(
        `Insufficient credits. Required: ${creditsToDeduct}, Available: ${available}`,
      );
    }

    const updated = await prisma.userBalance.findUnique({
      where: {
        userWalletAddress_agentId: {
          userWalletAddress: walletAddress,
          agentId: agent.id,
        },
      },
    });

    return {
      eth: updated!.ethBalance.toString(),
      credits: updated!.creditBalance.toString(),
    };
  }

  /**
   * Add ETH to user balance — atomic increment.
   */
  async addEth(
    walletAddress: string,
    agentId: string,
    ethToAdd: string,
  ): Promise<UserBalance> {
    const agent = await prisma.agent.findFirst({
      where: { agentId },
      select: { id: true },
    });
    if (!agent) throw new Error(`Agent with agentId ${agentId} not found`);

    const result = await prisma.userBalance.upsert({
      where: {
        userWalletAddress_agentId: {
          userWalletAddress: walletAddress,
          agentId: agent.id,
        },
      },
      update: { ethBalance: { increment: parseFloat(ethToAdd) } },
      create: {
        userWalletAddress: walletAddress,
        agentId: agent.id,
        creditBalance: BigInt(0),
        ethBalance: parseFloat(ethToAdd),
      },
    });

    return {
      eth: result.ethBalance.toString(),
      credits: result.creditBalance.toString(),
    };
  }

  /**
   * Get all user balances for debugging
   */
  async getAllBalances(): Promise<Map<string, UserBalance>> {
    const balances = await prisma.userBalance.findMany();
    const balanceMap = new Map<string, UserBalance>();

    balances.forEach((balance: any) => {
      const key = `${balance.userWalletAddress}_${balance.agentId}`;
      balanceMap.set(key, {
        eth: balance.ethBalance.toString(),
        credits: balance.creditBalance.toString(),
      });
    });

    return balanceMap;
  }
}
