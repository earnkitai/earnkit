import {
  TopUpOption,
  TopUpDetailsResponse,
  SubmitTopUpParams,
  SubmitTopUpResponse,
  TopUpTransaction,
} from '../types';
import { prisma } from '../lib/prisma';
import { BalanceService } from './balanceService';

export class TopUpService {
  private balanceService: BalanceService;

  constructor(balanceService: BalanceService) {
    this.balanceService = balanceService;
  }

  /**
   * Get top-up options for an agent
   */
  async getTopUpDetails(agentId: string): Promise<TopUpDetailsResponse> {
    // Get top-up packages from database
    const packages = await prisma.topUpPackage.findMany({
      where: {
        agentId,
        isActive: true,
      },
      orderBy: {
        credits: 'asc',
      },
    });

    // Convert packages to TopUpOption format
    const options: TopUpOption[] = packages.map((pkg: any) => ({
      label: `${pkg.credits} Credits - ${pkg.price} ETH`,
      amountInEth: pkg.price.toString(),
      to: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6', // Example wallet
      value: (pkg.price * 1e18).toString(), // Convert to WEI
      creditsToTopUp: pkg.credits,
    }));

    // If no packages found, return default options
    if (options.length === 0) {
      return {
        options: [
          {
            label: '10 Credits - 0.001 ETH',
            amountInEth: '0.001',
            to: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6',
            value: '1000000000000000',
            creditsToTopUp: 10,
          },
          {
            label: '50 Credits - 0.005 ETH',
            amountInEth: '0.005',
            to: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6',
            value: '5000000000000000',
            creditsToTopUp: 50,
          },
          {
            label: '100 Credits - 0.01 ETH',
            amountInEth: '0.01',
            to: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6',
            value: '10000000000000000',
            creditsToTopUp: 100,
          },
        ],
      };
    }

    return { options };
  }

  /**
   * Submit a top-up transaction for monitoring
   */
  async submitTopUpTransaction(
    params: SubmitTopUpParams,
  ): Promise<SubmitTopUpResponse> {
    const { txHash, agentId, walletAddress, amountInEth, creditsToTopUp } =
      params;

    // Check if transaction already exists
    const existingTransaction = await prisma.topUpTransaction.findUnique({
      where: { txHash },
    });

    if (existingTransaction) {
      return {
        status: 'already_submitted',
        message: 'Transaction already submitted for monitoring',
      };
    }

    // Create transaction record
    await prisma.topUpTransaction.create({
      data: {
        txHash,
        agentId,
        userWalletAddress: walletAddress,
        amountInEth,
        creditsToTopUp: creditsToTopUp ? BigInt(creditsToTopUp) : null,
        status: 'PENDING',
      },
    });

    // In a real implementation, you would:
    // 1. Validate the transaction on the blockchain
    // 2. Monitor for confirmations
    // 3. Update user balance when confirmed

    // For demo purposes, we'll simulate a successful transaction after a delay
    setTimeout(async () => {
      await this.simulateTransactionConfirmation(txHash);
    }, 5000);

    return {
      status: 'submitted',
      message: 'Transaction submitted for monitoring',
    };
  }

  /**
   * Simulate transaction confirmation (for demo purposes)
   */
  private async simulateTransactionConfirmation(txHash: string): Promise<void> {
    const transaction = await prisma.topUpTransaction.findUnique({
      where: { txHash },
    });

    if (!transaction) return;

    // Update transaction status
    await prisma.topUpTransaction.update({
      where: { txHash },
      data: { status: 'COMPLETED' },
    });

    // Update user balance
    if (transaction.creditsToTopUp) {
      await this.balanceService.addCredits(
        transaction.userWalletAddress,
        transaction.agentId,
        Number(transaction.creditsToTopUp),
      );
    }
    await this.balanceService.addEth(
      transaction.userWalletAddress,
      transaction.agentId,
      transaction.amountInEth,
    );

    console.log(`Transaction ${txHash} confirmed and balance updated`);
  }

  /**
   * Get transaction by hash
   */
  async getTransaction(txHash: string): Promise<TopUpTransaction | null> {
    const transaction = await prisma.topUpTransaction.findUnique({
      where: { txHash },
    });

    if (!transaction) return null;

    return {
      txHash: transaction.txHash,
      agentId: transaction.agentId,
      walletAddress: transaction.userWalletAddress,
      amountInEth: transaction.amountInEth,
      creditsToTopUp: transaction.creditsToTopUp
        ? Number(transaction.creditsToTopUp)
        : undefined,
      status: transaction.status.toLowerCase() as
        | 'pending'
        | 'confirmed'
        | 'failed',
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };
  }

  /**
   * Get all transactions for debugging
   */
  async getAllTransactions(): Promise<TopUpTransaction[]> {
    const transactions = await prisma.topUpTransaction.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return transactions.map((transaction: any) => ({
      txHash: transaction.txHash,
      agentId: transaction.agentId,
      walletAddress: transaction.userWalletAddress,
      amountInEth: transaction.amountInEth,
      creditsToTopUp: transaction.creditsToTopUp
        ? Number(transaction.creditsToTopUp)
        : undefined,
      status: transaction.status.toLowerCase() as
        | 'pending'
        | 'confirmed'
        | 'failed',
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    }));
  }

  /**
   * Get transactions for a specific wallet
   */
  async getTransactionsByWallet(
    walletAddress: string,
  ): Promise<TopUpTransaction[]> {
    const transactions = await prisma.topUpTransaction.findMany({
      where: { userWalletAddress: walletAddress },
      orderBy: { createdAt: 'desc' },
    });

    return transactions.map((transaction: any) => ({
      txHash: transaction.txHash,
      agentId: transaction.agentId,
      walletAddress: transaction.userWalletAddress,
      amountInEth: transaction.amountInEth,
      creditsToTopUp: transaction.creditsToTopUp
        ? Number(transaction.creditsToTopUp)
        : undefined,
      status: transaction.status.toLowerCase() as
        | 'pending'
        | 'confirmed'
        | 'failed',
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    }));
  }
}
