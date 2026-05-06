import {
  EarnKitApiError,
  EarnKitInitializationError,
  EarnKitInputError,
} from './error';

export interface EarnKitConfig {
  agentId: string;
  apiKey: string;
  baseUrl?: string;
  debug?: boolean;
  requestTimeoutMs?: number;
}

interface TrackParams {
  walletAddress: string;
  idempotencyKey?: string;
  creditsToDeduct?: number;
}

interface TrackSuccessResponse {
  data: {
    eventId: string;
    insufficientCredits?: boolean;
    creditsRequired?: number;
    creditsAvailable?: number;
  };
  success: boolean;
}

interface CaptureParams {
  eventId: string;
}

interface CaptureSuccessResponse {
  success: boolean;
  eventId: string;
}

interface ReleaseParams {
  eventId: string;
}

interface ReleaseSuccessResponse {
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
    approveRequired?: boolean; // For tokens, this indicates approve step is needed
  };
}

export interface EscrowContract {
  address: string;
  depositFunction: {
    name: string;
    signature: string;
    agentIdParam: string; // The agentId to pass to the deposit function
  };
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

interface SubmitTopUpParams {
  txHash: string;
  walletAddress: string;
  amountInUSD: string;
  amountInEth: string; // Converted from USD using current ETH price
  creditsToTopUp?: number;
  // Token-specific fields (for ERC-20 payments)
  tokenAddress?: string;
  tokenSymbol?: string;
  amountInToken?: string;
}

interface SubmitTopUpResponse {
  status: string;
  message: string;
}

export interface SplitsPaymentConfig {
  paymentAddress: string;
  paymentMode: 'splits';
  network: { chainId: number; name: string; rpcUrl: string };
}

interface TopUpDetailsResponse {
  options: TopUpOption[]; // Legacy ETH options for backward compatibility
  escrowContract: EscrowContract;
  paymentMethods: PaymentMethod[];
  supportedTokens: SupportedTokenInfo[];
  // Present only for agents using Splits Protocol (new agents)
  splitsConfig?: SplitsPaymentConfig;
}

export type FreeTierConfig = {
  threshold: number;
  rate: number;
};

export type CreditBasedConfig = {
  creditsPerPrompt: number;
  topUpOptions: {
    creditAmount: number;
    pricePerCredit: number;
  }[];
};

interface PollingParams {
  walletAddress: string;
  initialBalance: UserBalance;
  onConfirmation: (newBalance: UserBalance) => void;
  onTimeout?: () => void;
  pollInterval?: number;
  maxPolls?: number;
}

interface ApiErrorResponse {
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
  // Token-specific fields (for ERC-20 payments)
  tokenAddress?: string;
  tokenSymbol?: string;
  amountInToken?: string;
}

const MAX_RETRIES = 2; // 1 initial attempt + 2 retries

/**
 * The main EarnKit SDK class.
 * Provides methods to interact with the EarnKit monetization platform.
 */
export class EarnKit {
  private agentId: string;
  private apiKey: string;
  private baseUrl: string = 'https://api.earnkit.com';
  private debug: boolean = false;
  private requestTimeoutMs: number = 30_000;

  /**
   * Initializes the EarnKit SDK with a specific agent configuration.
   * Validates the agentId is a non-empty CUID string
   * Store the agentId in the instance for future use (as a private property)
   * Synchronous operation - no network calls
   *
   * @param {EarnKitConfig} config - The configuration object for the SDK.
   * @param {string} config.agentId - The unique ID for your agent, found on the EarnKit dashboard.
   * @param {string} [config.apiKey] - The API key for authentication. Optional but recommended for production.
   * @param {string} [config.baseUrl] - The base URL of the EarnKit Backend API. Defaults to http://localhost:3000.
   * @param {boolean} [config.debug] - Whether to enable debug logging. Defaults to false.
   * @param {number} [config.requestTimeoutMs] - The maximum global request timeout in milliseconds. Defaults to 30000.
   * @returns {void}
   * @throws {EarnKitInitializationError} Throws an error if the initialization fails.
   */
  constructor(config: EarnKitConfig) {
    // input validation
    if (!config) {
      throw new EarnKitInitializationError('Configuration object is required.');
    }

    this._validateString(config.agentId, 'agentId', {
      errorType: EarnKitInitializationError,
    });

    if (config.baseUrl) {
      try {
        // validate that it's a valid URL
        new URL(config.baseUrl);
        this.baseUrl = config.baseUrl;
      } catch (error) {
        throw new EarnKitInitializationError(
          `baseUrl provided to the constructor is not a valid URL. Error: ${error}`,
        );
      }
    }

    this.debug = config.debug ?? false;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 30_000;
    this.agentId = config.agentId;
    this.apiKey = config.apiKey;

    this._log(`SDK instance created for agent: ${this.agentId}`);
    this._log(`Using API base URL: ${this.baseUrl}`);
    this._log(`Request timeout set to: ${this.requestTimeoutMs}ms`);
  }

  /**
   * Initiates a trackable event. This should be called before running the core AI logic.
   * The developer is responsible for passing in the correct wallet address of the end user. This is done to avoid tightly coupling the SDK to a specific wallet provider.
   * It checks for sufficient funds/credits and provisionally deducts them.
   * Sends a POST request to the /api/track endpoint and returns the eventId.
   *
   * @param {TrackParams} params - The parameters for the track event.
   * @param {string} params.walletAddress - The wallet address of the end user.
   * @param {string} [params.idempotencyKey] - A unique identifier for the event.
   * @param {number} [params.creditsToDeduct] - The number of credits to deduct from the user's balance.
   * @returns {Promise<{ eventId: string; insufficientCredits?: boolean; creditsRequired?: number; creditsAvailable?: number }>} A promise that resolves with the unique event ID and credit information.
   * @throws {EarnKitInputError | EarnKitApiError} Throws an error if the request fails.
   */
  public async track(params: TrackParams): Promise<{
    eventId: string;
    insufficientCredits?: boolean;
    creditsRequired?: number;
    creditsAvailable?: number;
  }> {
    if (!params) {
      throw new EarnKitInputError('Parameters object is required.');
    }

    this._validateString(params.walletAddress, 'walletAddress', {
      startsWith: '0x',
    });

    const body = {
      agentId: this.agentId,
      walletAddress: params.walletAddress,
      idempotencyKey: params.idempotencyKey,
      creditsToDeduct: params.creditsToDeduct,
    };

    const response = await this._apiCall<TrackSuccessResponse>('/track', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (response.data?.eventId) {
      return {
        eventId: response.data.eventId,
        insufficientCredits: response.data.insufficientCredits,
        creditsRequired: response.data.creditsRequired,
        creditsAvailable: response.data.creditsAvailable,
      };
    } else {
      throw new EarnKitApiError(
        'Received an unexpected response format from the server.',
        500,
        response,
      );
    }
  }

  /**
   * Captures a previously tracked event, finalizing the charge.
   * This should be called after the core AI logic has successfully completed.
   * Sends a POST request to the /api/capture endpoint and returns the success status.
   *
   * @param {CaptureParams} params - The parameters for the capture event.
   * @param {string} params.eventId - The eventId of the tracked event to capture.
   * @returns {Promise<{ success: boolean }>} A promise that resolves indicating success.
   * @throws {EarnKitInputError | EarnKitApiError} Throws an error if the event cannot be captured (e.g., not found or not pending).
   */
  public async capture(params: CaptureParams): Promise<{ success: boolean }> {
    if (!params) {
      throw new EarnKitInputError('Parameters object is required.');
    }

    this._validateString(params.eventId, 'eventId');

    const body = {
      eventId: params.eventId,
    };

    const response = await this._apiCall<CaptureSuccessResponse>('/capture', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return { success: response.success };
  }

  /**
   * Releases a previously tracked event, refunding any provisionally held funds.
   * This should be called in a catch block if the core AI logic fails after a successful track() call.
   * Sends a POST request to the /api/release endpoint and returns the success status.
   *
   * @param {ReleaseParams} params - The parameters for the release event.
   * @param {string} params.eventId - The eventId of the tracked event to release.
   * @returns {Promise<{ success: boolean }>} A promise that resolves indicating success.
   * @throws {EarnKitInputError | EarnKitApiError} Throws an error if the event cannot be released.
   */
  public async release(params: ReleaseParams): Promise<{ success: boolean }> {
    if (!params) {
      throw new EarnKitInputError('Parameters object is required.');
    }

    this._validateString(params.eventId, 'eventId');

    const body = {
      eventId: params.eventId,
    };

    const response = await this._apiCall<ReleaseSuccessResponse>('/release', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return { success: response.success };
  }

  /**
   * Fetches the pre-configured top-up options for the current agent.
   * Sends a GET request to the /api/top-up-details endpoint and returns the top-up options.
   * @returns {Promise<{ options: TopUpOption[] }>} A promise that resolves with the purchase options.
   * @throws {EarnKitApiError} Throws an error if the request fails.
   */
  public async getTopUpDetails(): Promise<TopUpDetailsResponse> {
    const url = new URL(`${this.baseUrl}/api/top-up-details`);
    url.searchParams.set('agentId', this.agentId);

    return this._apiCall<TopUpDetailsResponse>(url.toString());
  }

  /**
   * Submits a transaction hash to the backend for monitoring.
   * Sends a POST request to the /api/top-up-details endpoint and returns the backend's confirmation response.
   * @param {SubmitTopUpParams} params - The details of the submitted transaction.
   * @param {string} params.txHash - The transaction hash of the top-up.
   * @param {string} params.walletAddress - The wallet address of the end user.
   * @param {string} params.amountInUSD - The amount in USD to top up.
   * @param {string} params.amountInEth - The amount of ETH to top up (converted from USD).
   * @param {number} [params.creditsToTopUp] - The number of credits to top up.
   * @returns {Promise<SubmitTopUpResponse>} A promise that resolves with the backend's confirmation response.
   * @throws {EarnKitApiError} Throws an error if the request fails.
   */
  public async submitTopUpTransaction(
    params: SubmitTopUpParams,
  ): Promise<SubmitTopUpResponse> {
    const response = await this._apiCall<SubmitTopUpResponse>(
      '/top-up-details',
      {
        method: 'POST',
        body: JSON.stringify({
          agentId: this.agentId,
          ...params,
        }),
      },
    );

    return response;
  }

  /**
   * Fetches the current ETH and credit balance for a user.
   * Sends a GET request to the /api/balance endpoint and returns the user's balances.
   * @param {{ walletAddress: string }} params - The user's wallet address.
   * @returns {Promise<UserBalance>} A promise that resolves with the user's balances.
   * @throws {EarnKitApiError} Throws an error if the request fails.
   */
  public async getBalance(params: {
    walletAddress: string;
  }): Promise<UserBalance> {
    const url = new URL(`${this.baseUrl}/api/balance`);
    url.searchParams.set('agentId', this.agentId);
    url.searchParams.set('walletAddress', params.walletAddress);

    this._log(
      `Getting balance for agentId: ${this.agentId}, walletAddress: ${params.walletAddress}`,
    );
    this._log(`Full URL: ${url.toString()}`);

    return this._apiCall<UserBalance>(url.toString());
  }

  /**
   * Polls the backend to check for a balance update after a top-up.
   * This is a utility function to simplify the developer's workflow.
   * Sends a GET request repeatedly to the /api/balance endpoint and returns the user's balances.
   * @param {PollingParams} params - Configuration for the polling process.
   * @param {string} params.walletAddress - The wallet address of the end user.
   * @param {UserBalance} params.initialBalance - The initial balance of the user.
   * @param {function} params.onConfirmation - A callback function to be called when the balance is updated.
   * @param {function} [params.onTimeout] - A callback function to be called when the polling times out.
   * @param {number} [params.pollInterval] - The interval in milliseconds at which to poll the balance. Defaults to 10 seconds.
   * @param {number} [params.maxPolls] - The maximum number of polls to make. Defaults to 30.
   * @returns {void}
   * @throws {EarnKitApiError} Throws an error if the polling times out.
   */
  public pollForBalanceUpdate(params: PollingParams): void {
    const {
      walletAddress,
      initialBalance,
      onConfirmation,
      onTimeout,
      pollInterval = 10_000,
      maxPolls = 30,
    } = params;

    let pollCount = 0;

    const intervalId = setInterval(async () => {
      if (pollCount >= maxPolls) {
        clearInterval(intervalId);
        this._log(
          `Polling for balance update timed out after ${(maxPolls * pollInterval) / 1000} seconds.`,
        );
        if (onTimeout) onTimeout();
        return;
      }
      pollCount++;

      try {
        this._log(
          `Polling attempt ${pollCount}/${maxPolls} for balance update`,
        );
        this._log(`Current agentId in polling: ${this.agentId}`);

        const currentBalance = await this.getBalance({
          walletAddress,
        });

        const ethIncreased =
          parseFloat(currentBalance.eth) > parseFloat(initialBalance.eth);
        const creditsIncreased =
          BigInt(currentBalance.credits) > BigInt(initialBalance.credits);

        if (ethIncreased || creditsIncreased) {
          clearInterval(intervalId);
          this._log('Balance update detected!');
          onConfirmation(currentBalance);
        }
      } catch (error) {
        this._log('Error during polling, stopping.', error);
        clearInterval(intervalId);
        if (onTimeout) onTimeout();
      }
    }, pollInterval);
  }

  /**
   * Logs a message to the console if debug mode is enabled.
   * @param {string} message - The message to log.
   * @param {unknown[]} args - The arguments to log.
   */
  private _log(message: string, ...args: unknown[]): void {
    if (this.debug) {
      console.log(`[EarnKit-SDK] ${message}`, ...args);
    }
  }

  /**
   * Validates that a string parameter meets the specified criteria.
   * @param {unknown} value - The value to validate.
   * @param {string} paramName - The name of the parameter for error messages.
   * @param {object} options - Validation options.
   * @param {boolean} [options.required=true] - Whether the parameter is required.
   * @param {boolean} [options.allowEmpty=false] - Whether empty strings are allowed.
   * @param {string} [options.startsWith] - Required prefix for the string.
   * @param {typeof EarnKitInputError | typeof EarnKitInitializationError} [options.errorType=EarnKitInputError] - The type of error to throw.
   * @throws {EarnKitInputError | EarnKitInitializationError} Throws an error if validation fails.
   */
  private _validateString(
    value: unknown,
    paramName: string,
    options: {
      required?: boolean;
      allowEmpty?: boolean;
      startsWith?: string;
      errorType?: typeof EarnKitInputError | typeof EarnKitInitializationError;
    } = {},
  ): void {
    const {
      required = true,
      allowEmpty = false,
      startsWith,
      errorType = EarnKitInputError,
    } = options;

    if (!required && (value === undefined || value === null)) {
      return;
    }

    if (typeof value !== 'string') {
      throw new errorType(`\`${paramName}\` must be a valid string.`);
    }

    if (!allowEmpty && value.trim() === '') {
      throw new errorType(`\`${paramName}\` cannot be empty.`);
    }

    if (startsWith && !value.startsWith(startsWith)) {
      throw new errorType(`\`${paramName}\` must start with "${startsWith}".`);
    }
  }

  /**
   * Makes an API call to the backend with retry and timeout logic.
   * @param {string} path - The path of the API call.
   * @param {RequestInit} options - The options for the API call.
   * @returns {Promise<T>} A promise that resolves with the API call response.
   * @throws {EarnKitApiError | Error} Throws an error if the request fails.
   */
  private async _apiCall<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs,
    );

    let lastError: Error | null = null;

    for (let i = 0; i <= MAX_RETRIES; i++) {
      try {
        const url = path.startsWith('http')
          ? path
          : `${this.baseUrl}/api${path}`;

        const defaultOptions: RequestInit = {
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
          },
          signal: controller.signal,
        };

        const mergedOptions = { ...defaultOptions, ...options };

        this._log(
          `Making API call (attempt ${i + 1}/${MAX_RETRIES + 1}) to ${mergedOptions.method || 'GET'} ${url}`,
        );

        const response = await fetch(url, mergedOptions);

        if (!response.ok) {
          const errorData: ApiErrorResponse = await response.json();
          throw new EarnKitApiError(
            errorData.message || `HTTP Error: ${response.status}`,
            response.status,
            errorData,
          );
        }

        clearTimeout(timeoutId);
        return (await response.json()) as T;
      } catch (error) {
        lastError = error as Error;

        // decide if we should retry
        const isRetryable = this.isErrorRetryable(error);
        if (!isRetryable || i === MAX_RETRIES) {
          break; // exit loop to throw the error
        }

        const delay = 1000 * 2 ** i; // 1s, 2s, 4s, ...
        this._log(`Request failed, retrying in ${delay}ms...`, error);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    clearTimeout(timeoutId);

    // re-throw the last captured error
    if (lastError instanceof EarnKitApiError) {
      throw lastError;
    }

    if (lastError instanceof Error && lastError.name === 'AbortError') {
      throw new EarnKitApiError(
        `Request timed out after ${this.requestTimeoutMs}ms`,
        408, // Request Timeout
        lastError,
      );
    }

    throw new EarnKitApiError(
      `Network request failed: ${lastError instanceof Error ? lastError.message : 'Unknown error'}`,
      0, // Use 0 for status when it's a network error
      lastError,
    );
  }

  /**
   * Determines if an error is retryable.
   * @param {unknown} error - The error to check.
   * @returns {boolean} True if the error is retryable, false otherwise.
   */
  private isErrorRetryable(error: unknown): boolean {
    if (!(error instanceof EarnKitApiError)) {
      // network errors or AbortError are retryable
      return true;
    }

    const status = error.status;

    // retry on server errors (5xx) and timeouts (408)
    const isServerError = status >= 500 && status <= 599;
    const isTimeout = status === 408;

    return isServerError || isTimeout;
  }
}

export { EarnKitApiError, EarnKitInitializationError, EarnKitInputError };
