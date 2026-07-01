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
  SplitsPaymentConfig,
} from '../types';
import { prisma } from '../lib/prisma';
import { BalanceService } from './balanceService';
import { priceService } from './priceService';
import { tokenService, SupportedToken } from './tokenService';
import { normalizeWallet } from '../lib/wallet';
import {
  createPublicClient,
  http,
  decodeEventLog,
  keccak256,
  encodePacked,
  parseAbiItem,
  toEventSelector,
  parseUnits,
  formatUnits,
} from 'viem';
import { base } from 'viem/chains';
import { LedgerEntryStatus, LedgerEntryType, PaymentMethodType } from '@prisma/client';

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
    tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    tokenSymbol: 'USDC',
    enabled: true,
    discountPercent: 0,
  },
  {
    tokenAddress: '0x534b7aad1cdb6f02ec48cabe428f0d9131e40b07',
    tokenSymbol: 'MINIDEV',
    enabled: true,
    discountPercent: 0,
  },
  {
    tokenAddress: '0xf4d97f2da56e8c3098f3a8d538db630a2606a024',
    tokenSymbol: 'DIEM',
    enabled: true,
    discountPercent: 0,
  },
];

export class TopUpService {
  private balanceService: BalanceService;

  constructor(balanceService: BalanceService) {
    this.balanceService = balanceService;
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
  async getTopUpDetails(
    agentId: string,
    userId?: string,
  ): Promise<TopUpDetailsResponse> {
    // First, get the agent's internal ID using the agent_id field
    if (!userId) throw new Error('Authentication required');

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId },
      select: { id: true, splitAddress: true },
    });

    if (!agent) {
      throw new Error(`Agent with agentId ${agentId} not found`);
    }

    const internalAgentId = agent.id;

    // Get agent's token configurations
    const tokenConfigs = await this.getAgentTokenConfigs(internalAgentId);

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

    // Define USD amounts and credits (from packages or defaults). Keep a
    // parallel packageIds array so emitted options can echo the chosen
    // package back to the server when a PaymentIntent is created.
    let usdAmounts: number[] = [];
    let creditAmounts: number[] = [];
    let packageIds: (string | undefined)[] = [];

    if (packages.length > 0) {
      usdAmounts = packages.map((pkg: any) => pkg.price);
      creditAmounts = packages.map((pkg: any) => pkg.credits);
      packageIds = packages.map((pkg: any) => pkg.id);
    } else {
      // Default options
      usdAmounts = [3, 15, 30];
      creditAmounts = [10, 50, 100];
      packageIds = [undefined, undefined, undefined];
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
            ? `${creditAmounts[i]} Credits - $${discountedUsd.toFixed(2)} (${ethDiscount}% off)`
            : `${creditAmounts[i]} Credits - $${usdAmount.toFixed(2)} USD`,
        amountInUSD: discountedUsd.toString(),
        amountInEth: ethAmount.toString(),
        value: Math.floor(weiAmount).toString(),
        creditsToTopUp: creditAmounts[i],
        packageId: packageIds[i],
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
        const tokenPrice = await priceService.getTokenPrice(token.coingeckoPlatformId, token.address);

        const tokenOptions: TokenPaymentOption[] = usdAmounts.map(
          (usdAmount, i) => {
            const discountedUsd = this.applyDiscount(usdAmount, tokenDiscount);
            const tokenAmount = discountedUsd / tokenPrice;
            // Use viem parseUnits to avoid float precision loss
            const tokenAmountFixed = tokenAmount.toFixed(token.decimals);
            const smallestUnitAmount = parseUnits(tokenAmountFixed, token.decimals);

            const option: TokenPaymentOption = {
              label:
                tokenDiscount > 0
                  ? `${creditAmounts[i]} Credits - $${discountedUsd.toFixed(2)} (${tokenDiscount}% off)`
                  : `${creditAmounts[i]} Credits - $${usdAmount.toFixed(2)} USD`,
              amountInUSD: discountedUsd.toString(),
              amountInToken: smallestUnitAmount.toString(),
              amountInTokenHumanReadable: tokenAmount.toFixed(
                token.decimals > 6 ? 6 : token.decimals,
              ),
              creditsToTopUp: creditAmounts[i],
              packageId: packageIds[i],
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

    // Network config shared by both paths
    const network = {
      chainId: parseInt(process.env.CHAIN_ID || '8453'),
      name: process.env.NETWORK_NAME || 'Base',
      rpcUrl: process.env.RPC_URL || 'https://base-mainnet.infura.io',
    };

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
      network,
    };

    let splitsConfig: SplitsPaymentConfig | undefined;

    if (agent.splitAddress) {
      // Splits mode: payment target is the split contract; plain transfer semantics
      escrowContract.address = agent.splitAddress;
      escrowContract.depositFunction = {
        name: 'send',
        signature: '',
        agentIdParam: '',
      };
      escrowContract.depositTokenFunction = {
        name: 'transfer',
        signature: 'transfer(address,uint256)',
        agentIdParam: agent.splitAddress,
      };

      // ERC-20 in splits mode: direct transfer, no approve needed
      for (const pm of paymentMethods) {
        if (pm.type === 'token' && pm.contractFunction?.approveRequired) {
          pm.contractFunction.approveRequired = false;
        }
      }

      splitsConfig = {
        paymentAddress: agent.splitAddress,
        paymentMode: 'splits',
        network,
      };
    }

    return {
      // Only expose legacy ETH options when ETH is actually enabled for the agent.
      // Token-only agents should rely on paymentMethods to avoid stale ETH pricing data.
      options: ethEnabled ? ethOptions : [],
      escrowContract,
      paymentMethods,
      supportedTokens: supportedTokens.map((t) => this.toTokenInfo(t)),
      splitsConfig,
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
      amountInUSD,
      amountInEth,
      creditsToTopUp,
      tokenAddress,
      tokenSymbol,
      amountInToken,
      userId,
    } = params;
    const walletAddress = normalizeWallet(params.walletAddress);

    // First, get the agent's internal ID using the agent_id field
    if (!userId) throw new Error('Authentication required');

    const agent = await prisma.agent.findFirst({
      where: { agentId, userId },
      select: { id: true },
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

    // Verification is handled by the TopUpVerificationWorker which polls DB.
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
   * Verify a single pending transaction on-chain and credit the user.
   * Called by TopUpVerificationWorker — do not call with setTimeout.
   */
  async verifyAndCredit(txHash: string): Promise<void> {
    console.log(`[TopUpService] Verifying transaction on-chain: ${txHash}`);

    // Get the transaction record
    const transaction = await prisma.topUpTransaction.findUnique({
      where: { txHash },
      include: {
        agent: {
          select: {
            agentId: true,
            splitAddress: true,
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

      let depositVerified = false;
      let actualAmount: bigint | null = null;
      let isTokenDeposit = false;
      let depositTokenAddress: string | null = null;

      if (!transaction.agent.splitAddress) {
        // ── LEGACY ESCROW PATH ──────────────────────────────────────────────
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
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== ESCROW_ADDRESS) continue;

          const eventSignature = log.topics[0]?.toLowerCase();

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

              if (agentId.toLowerCase() !== expectedAgentIdHash.toLowerCase()) {
                console.log(
                  `[TopUpService] AgentId mismatch. Expected: ${expectedAgentIdHash}, Got: ${agentId}`,
                );
                continue;
              }

              if (from.toLowerCase() !== transaction.userWalletAddress.toLowerCase()) {
                console.log(
                  `[TopUpService] Sender mismatch. Expected: ${transaction.userWalletAddress}, Got: ${from}`,
                );
                continue;
              }

              depositVerified = true;
              actualAmount = amount;
              isTokenDeposit = false;
              console.log(`[TopUpService] Verified ETH deposit: ${amount.toString()} wei`);
              break;
            } catch (e) {
              console.log(`[TopUpService] Failed to decode Deposit event:`, e);
            }
          }

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
                agentId, token, from, amount: amount.toString(),
              });

              if (agentId.toLowerCase() !== expectedAgentIdHash.toLowerCase()) {
                console.log(
                  `[TopUpService] AgentId mismatch. Expected: ${expectedAgentIdHash}, Got: ${agentId}`,
                );
                continue;
              }

              if (from.toLowerCase() !== transaction.userWalletAddress.toLowerCase()) {
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
              console.log(`[TopUpService] Failed to decode TokenDeposit event:`, e);
            }
          }
        }
      } else {
        // ── SPLITS PATH ─────────────────────────────────────────────────────
        const splitAddr = transaction.agent.splitAddress.toLowerCase();

        if (!transaction.tokenAddress) {
          // ETH: receipt.to must equal splitAddress
          if (receipt.to?.toLowerCase() !== splitAddr) {
            await this.markTransactionFailed(
              txHash,
              `receipt.to does not match splitAddress. Expected: ${splitAddr}, Got: ${receipt.to}`,
            );
            return;
          }

          const tx = await publicClient.getTransaction({
            hash: txHash as `0x${string}`,
          });

          if (tx.from.toLowerCase() !== transaction.userWalletAddress.toLowerCase()) {
            await this.markTransactionFailed(
              txHash,
              `Sender mismatch. Expected: ${transaction.userWalletAddress}, Got: ${tx.from}`,
            );
            return;
          }

          actualAmount = tx.value;
          depositVerified = true;
          isTokenDeposit = false;
          console.log(`[TopUpService] Splits ETH deposit verified: ${tx.value.toString()} wei`);
        } else {
          // ERC-20: find Transfer(from=userWallet, to=splitAddr) in logs
          const ERC20_TRANSFER_ABI = parseAbiItem(
            'event Transfer(address indexed from, address indexed to, uint256 value)',
          );
          const ERC20_TRANSFER_TOPIC = toEventSelector(ERC20_TRANSFER_ABI);

          for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== transaction.tokenAddress!.toLowerCase()) continue;
            if (log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC.toLowerCase()) continue;

            try {
              const decoded = decodeEventLog({
                abi: [ERC20_TRANSFER_ABI],
                data: log.data,
                topics: log.topics,
              });

              const { from, to, value } = decoded.args as {
                from: `0x${string}`;
                to: `0x${string}`;
                value: bigint;
              };

              if (from.toLowerCase() !== transaction.userWalletAddress.toLowerCase()) continue;
              if (to.toLowerCase() !== splitAddr) continue;

              actualAmount = value;
              depositVerified = true;
              isTokenDeposit = true;
              depositTokenAddress = transaction.tokenAddress!.toLowerCase();
              console.log(
                `[TopUpService] Splits ERC-20 deposit verified: ${value.toString()} of ${transaction.tokenAddress}`,
              );
              break;
            } catch (e) {
              console.log(`[TopUpService] Failed to decode Transfer event:`, e);
            }
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

        const tokenPrice = await priceService.getTokenPrice(tokenInfo.coingeckoPlatformId, tokenInfo.address);
        // Use viem formatUnits to avoid float precision loss on large token amounts
        const actualTokenAmount = parseFloat(formatUnits(actualAmount, tokenInfo.decimals));
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
      const withinTolerance =
        usdDifference <= usdTolerance && !!transaction.creditsToTopUp;

      if (withinTolerance) {
        // Use claimed credits if USD is within tolerance
        actualCredits = Number(transaction.creditsToTopUp);
        console.log(
          `[TopUpService] USD within tolerance, using claimed credits: ${actualCredits}`,
        );
      } else {
        // Outside tolerance — derive credits from the agent's actual configured
        // packages, not a hardcoded global ratio. Otherwise developers who
        // configured (e.g.) $0.50 = 10 credits would see users credited at the
        // legacy $3 = 10 ratio whenever ETH price moved >10% between intent and
        // verification — silent under-crediting on volatile days.
        const packages = await prisma.topUpPackage.findMany({
          where: {
            agentId: transaction.agentId,
            isActive: true,
          },
          orderBy: { price: 'asc' },
        });

        if (packages.length === 0) {
          // No packages configured — last-resort default matches the
          // getTopUpDetails fallback so behavior stays consistent across both
          // entry points: $3 = 10 credits, ratio 10/3.
          actualCredits = Math.floor((actualUsd / 3) * 10);
          console.log(
            `[TopUpService] USD outside tolerance, no packages configured, using default ratio: ${actualCredits}`,
          );
        } else {
          // Find the package whose price is closest to actualUsd, then use its
          // credits/USD ratio. This means devs who priced $0.5 = 10 credits get
          // their users credited at 20 credits/USD even when verification falls
          // back, instead of the legacy 10/3 default.
          const closest = packages.reduce((best, pkg) =>
            Math.abs(pkg.price - actualUsd) < Math.abs(best.price - actualUsd) ? pkg : best,
          );
          // If actualUsd is essentially the package price (within 1 cent),
          // grant exactly that package's credits — don't lose precision to
          // float math. Otherwise scale by the ratio.
          if (Math.abs(closest.price - actualUsd) < 0.01) {
            actualCredits = closest.credits;
          } else {
            actualCredits = Math.floor(
              (actualUsd / closest.price) * closest.credits,
            );
          }
          console.log(
            `[TopUpService] USD outside tolerance, using package ${closest.id} (${closest.credits} credits @ $${closest.price}) ratio: ${actualCredits} credits for $${actualUsd.toFixed(2)}`,
          );
        }
      }

      // Ensure at least 1 credit
      actualCredits = Math.max(actualCredits, 1);

      // Persist the claimed (package) USD when within tolerance so dashboard
      // earnings reflect what the developer priced, not a re-converted figure
      // that drifts with ETH price moves between intent and verification.
      const recordedUsd = withinTolerance
        ? claimedUsd.toFixed(2)
        : actualUsd.toFixed(2);

      const actualAgentId = transaction.agent.agentId;

      // 8. Single-transaction credit grant, gated by the LedgerEntry
      // (agentId, idempotencyKey) unique constraint.
      //
      // Why: there are two paths that grant credits — this top-up flow and
      // PaymentIntentService.confirmPayment. Both write a LedgerEntry with
      // idempotencyKey=txHash. By creating that ledger entry FIRST inside
      // the transaction, a duplicate grant from either path becomes a
      // P2002 unique-violation that rolls the whole grant back. Net effect:
      // any given on-chain txHash can be credited at most once, regardless
      // of which path picks it up first.
      try {
        await prisma.$transaction(async (tx) => {
          // Lock-style guard: succeeds at most once per (agent, txHash).
          await tx.ledgerEntry.create({
            data: {
              agentId: transaction.agentId,
              userWalletAddress: transaction.userWalletAddress,
              entryType: LedgerEntryType.CREDIT_GRANTED,
              status: LedgerEntryStatus.POSTED,
              credits: BigInt(actualCredits),
              amountInUSD: recordedUsd,
              paymentMethodType: isTokenDeposit
                ? PaymentMethodType.ERC20
                : PaymentMethodType.ETH,
              tokenAddress: isTokenDeposit ? depositTokenAddress : null,
              tokenSymbol: isTokenDeposit ? transaction.tokenSymbol : null,
              amountAtomic: actualAmount!.toString(),
              chainId: 8453,
              txHash,
              idempotencyKey: txHash,
            },
          });

          // Move TopUpTransaction PENDING -> COMPLETED in the same tx.
          await tx.topUpTransaction.updateMany({
            where: { txHash, status: 'PENDING' },
            data: {
              status: 'COMPLETED',
              amountInUSD: recordedUsd,
              creditsToTopUp: BigInt(actualCredits),
            },
          });

          // Find the agent's internal id for UserBalance keying. We already
          // have it on `transaction.agentId`.
          await tx.userBalance.upsert({
            where: {
              userWalletAddress_agentId: {
                userWalletAddress: transaction.userWalletAddress,
                agentId: transaction.agentId,
              },
            },
            update: { creditBalance: { increment: BigInt(actualCredits) } },
            create: {
              userWalletAddress: transaction.userWalletAddress,
              agentId: transaction.agentId,
              creditBalance: BigInt(actualCredits),
              ethBalance: 0,
            },
          });

          if (!isTokenDeposit) {
            const ethAmount = Number(actualAmount) / 1e18;
            await tx.userBalance.update({
              where: {
                userWalletAddress_agentId: {
                  userWalletAddress: transaction.userWalletAddress,
                  agentId: transaction.agentId,
                },
              },
              data: { ethBalance: { increment: ethAmount } },
            });
          }
        });
      } catch (err: any) {
        // P2002 = unique constraint failed on (agentId, idempotencyKey).
        // That's the cross-path double-credit guard tripping — already
        // credited by another verify run or by PaymentIntent.confirmPayment.
        if (err?.code === 'P2002') {
          console.log(
            `[TopUpService] ${txHash} already credited (idempotency hit); skipping.`,
          );
          // Still want the row to look COMPLETED for the operator view;
          // do that outside the failed transaction.
          await prisma.topUpTransaction.updateMany({
            where: { txHash, status: 'PENDING' },
            data: {
              status: 'COMPLETED',
              amountInUSD: recordedUsd,
              creditsToTopUp: BigInt(actualCredits),
            },
          });
          return;
        }
        throw err;
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

      // Re-throw so the worker can record the attempt and schedule retry
      throw error;
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
      where: { userWalletAddress: normalizeWallet(walletAddress) },
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
