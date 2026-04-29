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
          creditBalance: BigInt(0),
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
   * Update user balance
   */
  async updateBalance(
    walletAddress: string,
    agentId: string,
    balance: Partial<UserBalance>,
  ): Promise<UserBalance> {
    // First, get the agent's internal ID using the agent_id field
    const agent = await prisma.agent.findUnique({
      where: {
        agentId: agentId,
      },
      select: {
        id: true,
      },
    });

    if (!agent) {
      throw new Error(`Agent with agentId ${agentId} not found`);
    }

    const currentBalance = await this.getBalance(walletAddress, agentId);
    const updatedBalance: UserBalance = {
      eth: balance.eth ?? currentBalance.eth,
      credits: balance.credits ?? currentBalance.credits,
    };

    await prisma.userBalance.upsert({
      where: {
        userWalletAddress_agentId: {
          userWalletAddress: walletAddress,
          agentId: agent.id, // Use the internal ID, not the agent_id
        },
      },
      update: {
        ethBalance: parseFloat(updatedBalance.eth),
        creditBalance: BigInt(updatedBalance.credits),
      },
      create: {
        userWalletAddress: walletAddress,
        agentId: agent.id, // Use the internal ID, not the agent_id
        ethBalance: parseFloat(updatedBalance.eth),
        creditBalance: BigInt(updatedBalance.credits),
      },
    });

    return updatedBalance;
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
   * Deduct credits from user balance
   */
  async deductCredits(
    walletAddress: string,
    agentId: string,
    creditsToDeduct: number,
  ): Promise<UserBalance> {
    const currentBalance = await this.getBalance(walletAddress, agentId);
    const currentCredits = parseInt(currentBalance.credits);

    if (currentCredits < creditsToDeduct) {
      throw new Error(
        `Insufficient credits. Required: ${creditsToDeduct}, Available: ${currentCredits}`,
      );
    }

    const newCredits = (currentCredits - creditsToDeduct).toString();
    return this.updateBalance(walletAddress, agentId, { credits: newCredits });
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
