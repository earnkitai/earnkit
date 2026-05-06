export interface EarnKitConfig {
  agentId: string;
  baseUrl?: string;
  debug?: boolean;
  requestTimeoutMs?: number;
}

export interface TrackParams {
  agentId: string;
  walletAddress: string;
  idempotencyKey?: string;
  creditsToDeduct?: number;
  userId?: string;
}

export interface TrackSuccessResponse {
  data: {
    eventId: string;
    insufficientCredits?: boolean;
    creditsRequired?: number;
    creditsAvailable?: number;
  };
  success: boolean;
}

export interface CaptureParams {
  eventId: string;
  userId?: string;
}

export interface CaptureSuccessResponse {
  success: boolean;
  eventId: string;
}

export interface ReleaseParams {
  eventId: string;
  userId?: string;
}

export interface ReleaseSuccessResponse {
  success: boolean;
  eventId: string;
}

export interface TopUpOption {
  label: string;
  amountInUSD: string;
  amountInEth: string; // Converted from USD using current ETH price
  value: string; // Amount in WEI
  creditsToTopUp?: number;
  // Discount info
  discountPercent?: number; // e.g., 10 = 10% discount
  originalAmountInUSD?: string; // Pre-discount price
}

/**
 * Token payment option for ERC-20 token payments
 */
export interface TokenPaymentOption {
  label: string;
  amountInUSD: string;
  amountInToken: string; // Amount in token's smallest unit
  amountInTokenHumanReadable: string; // Human-readable token amount
  creditsToTopUp?: number;
  // Discount info
  discountPercent?: number; // e.g., 10 = 10% discount
  originalAmountInUSD?: string; // Pre-discount price
}

/**
 * Agent token configuration for per-agent payment settings
 */
export interface AgentTokenConfig {
  tokenAddress: string; // "eth" for ETH, contract address for tokens
  tokenSymbol: string;
  enabled: boolean;
  discountPercent: number; // e.g., 10 = 10% discount
}

/**
 * Supported token information
 */
export interface SupportedTokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;
  logoUrl?: string;
}

/**
 * Payment method configuration (ETH or ERC-20 token)
 */
export interface PaymentMethod {
  type: 'eth' | 'token';
  token?: SupportedTokenInfo;
  options: TopUpOption[] | TokenPaymentOption[];
  contractFunction: {
    name: string;
    signature: string;
    // For tokens, this includes approve step
    approveRequired?: boolean;
  };
}

export interface EscrowContract {
  address: string;
  depositFunction: {
    name: string;
    signature: string;
    agentIdParam: string; // The agentId to pass to the deposit function
  };
  // Token deposit function info
  depositTokenFunction?: {
    name: string;
    signature: string;
    agentIdParam: string;
  };
  network: {
    chainId: number;
    name: string;
    rpcUrl: string;
  };
}

export interface UserBalance {
  eth: string;
  credits: string;
}

export interface SubmitTopUpParams {
  agentId: string;
  txHash: string;
  walletAddress: string;
  amountInUSD: string;
  amountInEth: string; // Converted from USD using current ETH price
  creditsToTopUp?: number;
  // Token-specific fields
  tokenAddress?: string; // If paying with ERC-20 token
  tokenSymbol?: string; // Token symbol (e.g., 'MINIDEV')
  amountInToken?: string; // Amount in token's smallest unit
  userId?: string;
}

export interface SubmitTopUpResponse {
  status: string;
  message: string;
}

/**
 * Payment config for agents using Splits Protocol (new agents only).
 * Present only when the agent has a splitAddress.
 */
export interface SplitsPaymentConfig {
  paymentAddress: string;
  paymentMode: 'splits';
  network: { chainId: number; name: string; rpcUrl: string };
}

/**
 * Updated TopUpDetailsResponse with multi-token support
 */
export interface TopUpDetailsResponse {
  options: TopUpOption[]; // Legacy ETH options only; empty when ETH is disabled
  escrowContract: EscrowContract;
  // New multi-token payment methods
  paymentMethods: PaymentMethod[];
  supportedTokens: SupportedTokenInfo[];
  // Present only for agents using Splits Protocol
  splitsConfig?: SplitsPaymentConfig;
}

export interface ApiErrorResponse {
  message: string;
  success: boolean;
}

export interface TrackedEvent {
  eventId: string;
  agentId: string;
  walletAddress: string;
  idempotencyKey?: string;
  creditsToDeduct?: number;
  status: 'pending' | 'captured' | 'released' | 'insufficient_credits';
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  walletAddress: string;
  ethBalance: string;
  creditsBalance: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TopUpTransaction {
  txHash: string;
  agentId: string;
  walletAddress: string;
  amountInUSD: string;
  amountInEth: string; // Converted from USD using current ETH price
  creditsToTopUp?: number;
  status: 'pending' | 'confirmed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
  // Token-specific fields
  tokenAddress?: string;
  tokenSymbol?: string;
  amountInToken?: string;
}
