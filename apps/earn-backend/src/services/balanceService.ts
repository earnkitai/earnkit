import { prisma } from '../lib/prisma';
import { UserBalance } from '../types';

export class BalanceService {
  /**
   * Get user balance by wallet address
   */
  async getBalance(
    walletAddress: string,
    agentId: string,
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
          agentId: agent.id, // Use the internal ID, not the agent_id
          creditBalance: BigInt(10), // Default 0 credits
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
   * Add credits to user balance
   */
  async addCredits(
    walletAddress: string,
    agentId: string,
    creditsToAdd: number,
  ): Promise<UserBalance> {
    const currentBalance = await this.getBalance(walletAddress, agentId);
    const newCredits = (
      parseInt(currentBalance.credits) + creditsToAdd
    ).toString();

    return this.updateBalance(walletAddress, agentId, { credits: newCredits });
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
   * Add ETH to user balance
   */
  async addEth(
    walletAddress: string,
    agentId: string,
    ethToAdd: string,
  ): Promise<UserBalance> {
    const currentBalance = await this.getBalance(walletAddress, agentId);
    const currentEth = parseFloat(currentBalance.eth);
    const ethToAddNum = parseFloat(ethToAdd);
    const newEth = (currentEth + ethToAddNum).toString();

    return this.updateBalance(walletAddress, agentId, { eth: newEth });
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
