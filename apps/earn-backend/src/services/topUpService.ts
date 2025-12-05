import {
  TopUpOption,
  TopUpDetailsResponse,
  SubmitTopUpParams,
  SubmitTopUpResponse,
  TopUpTransaction,
  PaymentMethod,
  TokenPaymentOption,
  SupportedTokenInfo,
  AgentTokenConfig,
} from '../types';
import { prisma } from '../lib/prisma';
import { BalanceService } from './balanceService';
import { priceService } from './priceService';
import { tokenService, SupportedToken } from './tokenService';
import { PrivyClient } from '@privy-io/server-auth';
import {
  createPublicClient,
  http,
  decodeEventLog,
  keccak256,
  encodePacked,
  parseAbiItem,
  toEventSelector,
} from 'viem';
import { base } from 'viem/chains';

// Escrow contract address
const ESCROW_ADDRESS = (
  process.env.ESCROW_CONTRACT_ADDRESS ||
  '0xCAeB6A62D04C52E1e196E5Bdce63e43f45582aA2'
).toLowerCase();

// Event ABIs for parsing logs
const DEPOSIT_EVENT_ABI = parseAbiItem(
  'event Deposit(bytes32 indexed agentId, address indexed from, uint256 amount)',
);
const TOKEN_DEPOSIT_EVENT_ABI = parseAbiItem(
  'event TokenDeposit(bytes32 indexed agentId, address indexed token, address indexed from, uint256 amount)',
);

// Compute event signature topics dynamically from ABI
const DEPOSIT_EVENT_TOPIC = toEventSelector(DEPOSIT_EVENT_ABI);
const TOKEN_DEPOSIT_EVENT_TOPIC = toEventSelector(TOKEN_DEPOSIT_EVENT_ABI);

// Create viem public client for Base
const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
});

// Default token configs if none are set for an agent
const DEFAULT_TOKEN_CONFIGS: AgentTokenConfig[] = [
  { tokenAddress: 'eth', tokenSymbol: 'ETH', enabled: true, discountPercent: 0 },
  {
    tokenAddress: '0x534b7aad1cdb6f02ec48cabe428f0d9131e40b07',
    tokenSymbol: 'MINIDEV',
    enabled: true,
    discountPercent: 0,
  },
];

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
   * Convert SupportedToken to SupportedTokenInfo for API response
   */
  private toTokenInfo(token: SupportedToken): SupportedTokenInfo {
    return {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      chainId: token.chainId,
      logoUrl: token.logoUrl,
    };
  }

  /**
   * Get agent's token configurations from database
   */
  private async getAgentTokenConfigs(
    internalAgentId: string,
  ): Promise<AgentTokenConfig[]> {
    const configs = await prisma.agentTokenConfig.findMany({
      where: { agentId: internalAgentId },
    });

    if (configs.length === 0) {
      // Return defaults if no configs set
      return DEFAULT_TOKEN_CONFIGS;
    }

    return configs.map((c) => ({
      tokenAddress: c.tokenAddress,
      tokenSymbol: c.tokenSymbol,
      enabled: c.enabled,
      discountPercent: c.discountPercent,
    }));
  }

  /**
   * Apply discount to USD amount
   */
  private applyDiscount(usdAmount: number, discountPercent: number): number {
    if (discountPercent <= 0) return usdAmount;
    return usdAmount * (1 - discountPercent / 100);
  }

  /**
   * Get top-up options for an agent with multi-token support
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

    // Get agent's token configurations
    const tokenConfigs = await this.getAgentTokenConfigs(internalAgentId);
    console.log('Agent token configs:', tokenConfigs);

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

    // Define USD amounts and credits (from packages or defaults)
    let usdAmounts: number[] = [];
    let creditAmounts: number[] = [];

    if (packages.length > 0) {
      usdAmounts = packages.map((pkg: any) => pkg.price);
      creditAmounts = packages.map((pkg: any) => pkg.credits);
    } else {
      // Default options
      usdAmounts = [3, 15, 30];
      creditAmounts = [10, 50, 100];
    }

    // Build payment methods array
    const paymentMethods: PaymentMethod[] = [];

    // Check if ETH is enabled for this agent
    const ethConfig = tokenConfigs.find(
      (c) => c.tokenAddress.toLowerCase() === 'eth',
    );
    const ethEnabled = ethConfig ? ethConfig.enabled : true;
    const ethDiscount = ethConfig ? ethConfig.discountPercent : 0;

    // Build ETH payment options (legacy format for backward compatibility)
    const ethOptions: TopUpOption[] = usdAmounts.map((usdAmount, i) => {
      const discountedUsd = this.applyDiscount(usdAmount, ethDiscount);
      const ethAmount = discountedUsd / ethPrice;
      const weiAmount = ethAmount * 1e18;

      const option: TopUpOption = {
        label:
          ethDiscount > 0
            ? `${creditAmounts[i]} Credits - $${discountedUsd.toFixed(2)} USD (${ethDiscount}% off)`
            : `${creditAmounts[i]} Credits - $${usdAmount.toFixed(2)} USD`,
        amountInUSD: discountedUsd.toString(),
        amountInEth: ethAmount.toString(),
        value: Math.floor(weiAmount).toString(),
        creditsToTopUp: creditAmounts[i],
      };

      // Add discount info if applicable
      if (ethDiscount > 0) {
        option.discountPercent = ethDiscount;
        option.originalAmountInUSD = usdAmount.toString();
      }

      return option;
    });

    // ETH payment method (only if enabled)
    if (ethEnabled) {
      paymentMethods.push({
        type: 'eth',
        options: ethOptions,
        contractFunction: {
          name: 'deposit',
          signature: 'deposit(bytes32)',
        },
      });
    }

    // Get supported tokens and build token payment methods
    const supportedTokens = tokenService.getSupportedTokens();

    for (const token of supportedTokens) {
      // Check if this token is enabled for this agent
      const tokenConfig = tokenConfigs.find(
        (c) => c.tokenAddress.toLowerCase() === token.address.toLowerCase(),
      );

      // Skip if token is not configured or not enabled
      if (!tokenConfig || !tokenConfig.enabled) {
        console.log(`Token ${token.symbol} not enabled for agent, skipping`);
        continue;
      }

      const tokenDiscount = tokenConfig.discountPercent;

      try {
        const tokenPrice = await priceService.getTokenPrice(token.coingeckoId);
        console.log(`${token.symbol} price for top-up conversion:`, tokenPrice);

        const tokenOptions: TokenPaymentOption[] = usdAmounts.map(
          (usdAmount, i) => {
            const discountedUsd = this.applyDiscount(usdAmount, tokenDiscount);
            const tokenAmount = discountedUsd / tokenPrice;
            const smallestUnitAmount = BigInt(
              Math.floor(tokenAmount * 10 ** token.decimals),
            );

            const option: TokenPaymentOption = {
              label:
                tokenDiscount > 0
                  ? `${creditAmounts[i]} Credits - $${discountedUsd.toFixed(2)} USD (${tokenDiscount}% off)`
                  : `${creditAmounts[i]} Credits - $${usdAmount.toFixed(2)} USD`,
              amountInUSD: discountedUsd.toString(),
              amountInToken: smallestUnitAmount.toString(),
              amountInTokenHumanReadable: tokenAmount.toFixed(
                token.decimals > 6 ? 6 : token.decimals,
              ),
              creditsToTopUp: creditAmounts[i],
            };

            // Add discount info if applicable
            if (tokenDiscount > 0) {
              option.discountPercent = tokenDiscount;
              option.originalAmountInUSD = usdAmount.toString();
            }

            return option;
          },
        );

        paymentMethods.push({
          type: 'token',
          token: this.toTokenInfo(token),
          options: tokenOptions,
          contractFunction: {
            name: 'depositToken',
            signature: 'depositToken(bytes32,address,uint256)',
            approveRequired: true,
          },
        });
      } catch (error) {
        console.error(
          `Failed to get price for ${token.symbol}, skipping:`,
          error,
        );
        // Skip this token if price fetch fails
      }
    }

    // Escrow contract configuration
    const escrowContract = {
      address:
        process.env.ESCROW_CONTRACT_ADDRESS ||
        '0xCAeB6A62D04C52E1e196E5Bdce63e43f45582aA2',
      depositFunction: {
        name: 'deposit',
        signature: 'deposit(bytes32)',
        agentIdParam: agentId,
      },
      depositTokenFunction: {
        name: 'depositToken',
        signature: 'depositToken(bytes32,address,uint256)',
        agentIdParam: agentId,
      },
      network: {
        chainId: parseInt(process.env.CHAIN_ID || '8453'),
        name: process.env.NETWORK_NAME || 'Base',
        rpcUrl: process.env.RPC_URL || 'https://base-mainnet.infura.io',
      },
    };

    return {
      options: ethOptions, // Legacy field for backward compatibility
      escrowContract,
      paymentMethods,
      supportedTokens: supportedTokens.map((t) => this.toTokenInfo(t)),
    };
  }

  /**
   * Submit a top-up transaction for monitoring (supports ETH and tokens)
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
      tokenAddress,
      tokenSymbol,
      amountInToken,
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

    // Validate token if specified
    if (tokenAddress && !tokenService.isTokenSupported(tokenAddress)) {
      throw new Error(`Token ${tokenAddress} is not supported`);
    }

    // Create transaction record with token fields
    await prisma.topUpTransaction.create({
      data: {
        txHash,
        agentId: internalAgentId,
        userWalletAddress: walletAddress,
        amountInUSD,
        amountInEth,
        creditsToTopUp: creditsToTopUp ? BigInt(creditsToTopUp) : null,
        tokenAddress: tokenAddress || null,
        tokenSymbol: tokenSymbol || null,
        amountInToken: amountInToken || null,
        status: 'PENDING',
      },
    });

    // Verify the transaction on-chain (with a small delay to allow for propagation)
    setTimeout(async () => {
      await this.verifyTransactionOnChain(txHash);
    }, 3000);

    const paymentType = tokenSymbol ? `${tokenSymbol} token` : 'ETH';
    return {
      status: 'submitted',
      message: `Transaction submitted for monitoring (${paymentType} payment)`,
    };
  }

  /**
   * Mark a transaction as failed with an error message
   */
  private async markTransactionFailed(
    txHash: string,
    errorMessage: string,
  ): Promise<void> {
    console.log(`[TopUpService] Transaction ${txHash} failed: ${errorMessage}`);
    await prisma.topUpTransaction.update({
      where: { txHash },
      data: {
        status: 'FAILED',
        errorMessage,
      },
    });
  }

  /**
   * Convert agentId string to bytes32 hash (same as frontend)
   */
  private agentIdToBytes32(agentId: string): string {
    return keccak256(encodePacked(['string'], [agentId]));
  }

  /**
   * Verify transaction on-chain and credit user based on actual deposit
   * @param txHash - Transaction hash to verify
   * @param retryCount - Current retry attempt (max 5 retries = ~50 seconds total)
   */
  private async verifyTransactionOnChain(
    txHash: string,
    retryCount: number = 0,
  ): Promise<void> {
    const MAX_RETRIES = 5;
    console.log(
      `[TopUpService] Verifying transaction on-chain: ${txHash} (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`,
    );

    // Get the transaction record
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

    if (!transaction) {
      console.log(`[TopUpService] Transaction not found in DB: ${txHash}`);
      return;
    }

    try {
      // 1. Get transaction receipt from blockchain
      const receipt = await publicClient.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      // 2. Verify transaction succeeded
      if (receipt.status !== 'success') {
        await this.markTransactionFailed(txHash, 'Transaction failed on-chain');
        return;
      }

      // 3. Verify it went to our escrow contract
      if (receipt.to?.toLowerCase() !== ESCROW_ADDRESS) {
        await this.markTransactionFailed(
          txHash,
          `Transaction not to escrow contract. Expected: ${ESCROW_ADDRESS}, Got: ${receipt.to}`,
        );
        return;
      }

      // 4. Get the expected agentId hash
      const expectedAgentIdHash = this.agentIdToBytes32(
        transaction.agent.agentId,
      );
      console.log(
        `[TopUpService] Expected agentId hash: ${expectedAgentIdHash}`,
      );

      // 5. Parse logs to find deposit event
      let depositVerified = false;
      let actualAmount: bigint | null = null;
      let isTokenDeposit = false;
      let depositTokenAddress: string | null = null;

      for (const log of receipt.logs) {
        // Skip logs not from escrow contract
        if (log.address.toLowerCase() !== ESCROW_ADDRESS) continue;

        // Check event signature (topics[0]) to determine which event type
        const eventSignature = log.topics[0]?.toLowerCase();

        // Handle ETH Deposit event
        if (eventSignature === DEPOSIT_EVENT_TOPIC.toLowerCase()) {
          try {
            const decoded = decodeEventLog({
              abi: [DEPOSIT_EVENT_ABI],
              data: log.data,
              topics: log.topics,
            });

            const { agentId, from, amount } = decoded.args as {
              agentId: `0x${string}`;
              from: `0x${string}`;
              amount: bigint;
            };

            // Verify agentId matches
            if (agentId.toLowerCase() !== expectedAgentIdHash.toLowerCase()) {
              console.log(
                `[TopUpService] AgentId mismatch. Expected: ${expectedAgentIdHash}, Got: ${agentId}`,
              );
              continue;
            }

            // Verify sender matches
            if (
              from.toLowerCase() !==
              transaction.userWalletAddress.toLowerCase()
            ) {
              console.log(
                `[TopUpService] Sender mismatch. Expected: ${transaction.userWalletAddress}, Got: ${from}`,
              );
              continue;
            }

            depositVerified = true;
            actualAmount = amount;
            isTokenDeposit = false;
            console.log(
              `[TopUpService] Verified ETH deposit: ${amount.toString()} wei`,
            );
            break;
          } catch (e) {
            console.log(`[TopUpService] Failed to decode Deposit event:`, e);
          }
        }

        // Handle Token Deposit event
        if (eventSignature === TOKEN_DEPOSIT_EVENT_TOPIC.toLowerCase()) {
          try {
            const decoded = decodeEventLog({
              abi: [TOKEN_DEPOSIT_EVENT_ABI],
              data: log.data,
              topics: log.topics,
            });

            const { agentId, token, from, amount } = decoded.args as {
              agentId: `0x${string}`;
              token: `0x${string}`;
              from: `0x${string}`;
              amount: bigint;
            };

            console.log(`[TopUpService] TokenDeposit decoded:`, {
              agentId,
              token,
              from,
              amount: amount.toString(),
            });

            // Verify agentId matches
            if (agentId.toLowerCase() !== expectedAgentIdHash.toLowerCase()) {
              console.log(
                `[TopUpService] AgentId mismatch. Expected: ${expectedAgentIdHash}, Got: ${agentId}`,
              );
              continue;
            }

            // Verify sender matches
            if (
              from.toLowerCase() !==
              transaction.userWalletAddress.toLowerCase()
            ) {
              console.log(
                `[TopUpService] Sender mismatch. Expected: ${transaction.userWalletAddress}, Got: ${from}`,
              );
              continue;
            }

            depositVerified = true;
            actualAmount = amount;
            isTokenDeposit = true;
            depositTokenAddress = token.toLowerCase();
            console.log(
              `[TopUpService] Verified token deposit: ${amount.toString()} of ${token}`,
            );
            break;
          } catch (e) {
            console.log(
              `[TopUpService] Failed to decode TokenDeposit event:`,
              e,
            );
          }
        }
      }

      // 6. Verify deposit was found
      if (!depositVerified || actualAmount === null) {
        await this.markTransactionFailed(
          txHash,
          'No valid deposit event found in transaction',
        );
        return;
      }

      // 7. Calculate credits based on actual on-chain amount
      let actualUsd: number;
      let actualCredits: number;

      if (isTokenDeposit && depositTokenAddress) {
        // Token deposit - get token info and price
        const tokenInfo = tokenService.getTokenByAddress(depositTokenAddress);
        if (!tokenInfo) {
          await this.markTransactionFailed(
            txHash,
            `Unknown token: ${depositTokenAddress}`,
          );
          return;
        }

        const tokenPrice = await priceService.getTokenPrice(
          tokenInfo.coingeckoId,
        );
        const actualTokenAmount =
          Number(actualAmount) / 10 ** tokenInfo.decimals;
        actualUsd = actualTokenAmount * tokenPrice;

        console.log(
          `[TopUpService] Token: ${actualTokenAmount.toFixed(6)} ${tokenInfo.symbol} @ $${tokenPrice} = $${actualUsd.toFixed(2)}`,
        );
      } else {
        // ETH deposit
        const ethPrice = await priceService.getEthPrice();
        const actualEthAmount = Number(actualAmount) / 1e18;
        actualUsd = actualEthAmount * ethPrice;

        console.log(
          `[TopUpService] ETH: ${actualEthAmount.toFixed(6)} @ $${ethPrice} = $${actualUsd.toFixed(2)}`,
        );
      }

      // Calculate credits: use the claimed credits if USD is close enough, otherwise calculate
      const claimedUsd = parseFloat(transaction.amountInUSD);
      const usdDifference = Math.abs(actualUsd - claimedUsd);
      const usdTolerance = claimedUsd * 0.1; // 10% tolerance for price fluctuations

      if (usdDifference <= usdTolerance && transaction.creditsToTopUp) {
        // Use claimed credits if USD is within tolerance
        actualCredits = Number(transaction.creditsToTopUp);
        console.log(
          `[TopUpService] USD within tolerance, using claimed credits: ${actualCredits}`,
        );
      } else {
        // Calculate credits from actual USD (1 credit = $0.01 based on typical packages)
        // Use the package pricing: $1 = 100/3 credits approximately based on default $3 = 10 credits
        actualCredits = Math.floor((actualUsd / 3) * 10);
        console.log(
          `[TopUpService] USD outside tolerance, calculated credits: ${actualCredits}`,
        );
      }

      // Ensure at least 1 credit
      actualCredits = Math.max(actualCredits, 1);

      // 8. Update transaction as completed
      await prisma.topUpTransaction.update({
        where: { txHash },
        data: {
          status: 'COMPLETED',
          amountInUSD: actualUsd.toFixed(2),
          creditsToTopUp: BigInt(actualCredits),
        },
      });

      // 9. Credit the user
      const actualAgentId = transaction.agent.agentId;

      await this.balanceService.addCredits(
        transaction.userWalletAddress,
        actualAgentId,
        actualCredits,
      );

      // For ETH payments, also add to ETH balance
      if (!isTokenDeposit) {
        const ethAmount = (Number(actualAmount) / 1e18).toString();
        await this.balanceService.addEth(
          transaction.userWalletAddress,
          actualAgentId,
          ethAmount,
        );
      }

      const paymentType = isTokenDeposit ? 'token' : 'ETH';
      console.log(
        `[TopUpService] ✅ Transaction ${txHash} verified and credited ${actualCredits} credits (${paymentType} payment, $${actualUsd.toFixed(2)} USD)`,
      );
    } catch (error: any) {
      console.error(
        `[TopUpService] Error verifying transaction ${txHash}:`,
        error,
      );

      // Check if it's a "transaction not found" error (tx may be pending)
      if (
        error.message?.includes('could not be found') ||
        error.message?.includes('not found')
      ) {
        if (retryCount < MAX_RETRIES) {
          console.log(
            `[TopUpService] Transaction not yet confirmed, will retry in 10s...`,
          );
          // Retry after a delay
          setTimeout(
            () => this.verifyTransactionOnChain(txHash, retryCount + 1),
            10000,
          );
          return;
        } else {
          console.log(
            `[TopUpService] Max retries exceeded. Transaction not found on-chain.`,
          );
          await this.markTransactionFailed(
            txHash,
            'Transaction not found on-chain after multiple attempts. Invalid or never submitted.',
          );
          return;
        }
      }

      await this.markTransactionFailed(
        txHash,
        `Verification error: ${error.message}`,
      );
    }
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
      tokenAddress: transaction.tokenAddress || undefined,
      tokenSymbol: transaction.tokenSymbol || undefined,
      amountInToken: transaction.amountInToken || undefined,
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
      tokenAddress: transaction.tokenAddress || undefined,
      tokenSymbol: transaction.tokenSymbol || undefined,
      amountInToken: transaction.amountInToken || undefined,
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
      tokenAddress: transaction.tokenAddress || undefined,
      tokenSymbol: transaction.tokenSymbol || undefined,
      amountInToken: transaction.amountInToken || undefined,
    }));
  }

  /**
   * Get transactions by token
   */
  async getTransactionsByToken(
    tokenAddress: string,
  ): Promise<TopUpTransaction[]> {
    const transactions = await prisma.topUpTransaction.findMany({
      where: { tokenAddress: tokenAddress.toLowerCase() },
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
      tokenAddress: transaction.tokenAddress || undefined,
      tokenSymbol: transaction.tokenSymbol || undefined,
      amountInToken: transaction.amountInToken || undefined,
    }));
  }
}
