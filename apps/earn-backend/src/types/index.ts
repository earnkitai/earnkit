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
}

export interface CaptureSuccessResponse {
  success: boolean;
  eventId: string;
}

export interface ReleaseParams {
  eventId: string;
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
}

export interface EscrowContract {
  address: string;
  depositFunction: {
    name: string;
    signature: string;
    agentIdParam: string; // The agentId to pass to the deposit function
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
}

export interface SubmitTopUpResponse {
  status: string;
  message: string;
}

export interface TopUpDetailsResponse {
  options: TopUpOption[];
  escrowContract: EscrowContract;
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
}
