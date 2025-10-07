import {
  TopUpOption,
  TopUpDetailsResponse,
  SubmitTopUpParams,
  SubmitTopUpResponse,
  TopUpTransaction,
} from '../types';
import { prisma } from '../lib/prisma';
import { BalanceService } from './balanceService';
import { priceService } from './priceService';
import { PrivyClient } from '@privy-io/server-auth';

export class TopUpService {
  private balanceService: BalanceService;
  private privyClient: PrivyClient;

  constructor(balanceService: BalanceService) {
    this.balanceService = balanceService;
    // Initialize Privy client with environment variables
    this.privyClient = new PrivyClient(
      process.env.PRIVY_APP_ID || '',
      process.env.PRIVY_APP_SECRET || '',
    );
  }

  /**
   * Get top-up options for an agent
   */
  async getTopUpDetails(agentId: string): Promise<TopUpDetailsResponse> {
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

    const internalAgentId = agent.id;

    // Get top-up packages from database
    const packages = await prisma.topUpPackage.findMany({
      where: {
        agentId: internalAgentId,
        isActive: true,
      },
      orderBy: {
        credits: 'asc',
      },
    });

    // Get current ETH price for conversion
    const ethPrice = await priceService.getEthPrice();
    console.log('Current ETH price for top-up conversion:', ethPrice);

    // Convert packages to TopUpOption format
    const options: TopUpOption[] = await Promise.all(
      packages.map(async (pkg: any) => {
        const usdAmount = pkg.price; // Price is stored in USD
        const ethAmount = usdAmount / ethPrice; // Convert USD to ETH
        const weiAmount = ethAmount * 1e18; // Convert ETH to WEI

        return {
          label: `${pkg.credits} Credits - $${usdAmount.toFixed(2)} USD`,
          amountInUSD: usdAmount.toString(),
          amountInEth: ethAmount.toString(),
          value: Math.floor(weiAmount).toString(), // Convert to WEI
          creditsToTopUp: pkg.credits,
        };
      }),
    );

    // If no packages found, return default options
    if (options.length === 0) {
      const defaultUsdAmounts = [3, 15, 30]; // $3, $15, $30 USD
      const defaultCredits = [10, 50, 100];

      for (let i = 0; i < defaultUsdAmounts.length; i++) {
        const usdAmount = defaultUsdAmounts[i];
        const ethAmount = usdAmount / ethPrice;
        const weiAmount = ethAmount * 1e18;

        options.push({
          label: `${defaultCredits[i]} Credits - $${usdAmount} USD`,
          amountInUSD: usdAmount.toString(),
          amountInEth: ethAmount.toString(),
          value: Math.floor(weiAmount).toString(),
          creditsToTopUp: defaultCredits[i],
        });
      }
    }

    // Escrow contract configuration
    const escrowContract = {
      address:
        process.env.ESCROW_CONTRACT_ADDRESS ||
        '0x8076E4444D6AE75396Dcf1E201Dbc6a4cd01FDC8',
      depositFunction: {
        name: 'deposit',
        signature: 'deposit(bytes32)',
        agentIdParam: agentId, // The agentId to pass to the deposit function
      },
      network: {
        chainId: parseInt(process.env.CHAIN_ID || '8453'), // Ethereum mainnet by default
        name: process.env.NETWORK_NAME || 'Base',
        rpcUrl: process.env.RPC_URL || 'https://base-mainnet.infura.io',
      },
    };

    return {
      options,
      escrowContract,
    };
  }

  /**
   * Submit a top-up transaction for monitoring
   */
  async submitTopUpTransaction(
    params: SubmitTopUpParams,
  ): Promise<SubmitTopUpResponse> {
    const {
      txHash,
      agentId,
      walletAddress,
      amountInUSD,
      amountInEth,
      creditsToTopUp,
    } = params;

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

    const internalAgentId = agent.id;

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
        agentId: internalAgentId,
        userWalletAddress: walletAddress,
        amountInUSD,
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
      include: {
        agent: {
          select: {
            agentId: true,
          },
        },
      },
    });

    if (!transaction) return;

    // Update transaction status
    await prisma.topUpTransaction.update({
      where: { txHash },
      data: { status: 'COMPLETED' },
    });

    // Get the actual agentId (not the internal ID)
    const actualAgentId = transaction.agent.agentId;

    // Update user balance
    if (transaction.creditsToTopUp) {
      await this.balanceService.addCredits(
        transaction.userWalletAddress,
        actualAgentId,
        Number(transaction.creditsToTopUp),
      );
    }
    await this.balanceService.addEth(
      transaction.userWalletAddress,
      actualAgentId,
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
      amountInUSD: transaction.amountInUSD,
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
      amountInUSD: transaction.amountInUSD,
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
      amountInUSD: transaction.amountInUSD,
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
