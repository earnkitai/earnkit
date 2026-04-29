/**
 * Token Registry Service
 * Manages supported ERC-20 tokens for the EarnKit platform
 */

export interface SupportedToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;
  coingeckoId: string;
  logoUrl?: string;
}

/**
 * Supported tokens configuration
 * Add new tokens here to support them in the platform
 */
const SUPPORTED_TOKENS: SupportedToken[] = [
  {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    chainId: 8453,
    coingeckoId: 'usd-coin',
    logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
  },
  {
    address: '0x534b7aad1cdb6f02ec48cabe428f0d9131e40b07',
    symbol: 'MINIDEV',
    name: 'MiniDev',
    decimals: 18,
    chainId: 8453,
    coingeckoId: 'minidev',
    logoUrl: 'https://assets.coingecko.com/coins/images/39824/small/MINIDEV.jpg',
  },
];

/**
 * Token Registry Service Class
 */
export class TokenService {
  private tokens: Map<string, SupportedToken>;
  private tokensBySymbol: Map<string, SupportedToken>;

  constructor() {
    this.tokens = new Map();
    this.tokensBySymbol = new Map();

    // Initialize token maps
    for (const token of SUPPORTED_TOKENS) {
      const addressLower = token.address.toLowerCase();
      this.tokens.set(addressLower, token);
      this.tokensBySymbol.set(token.symbol.toUpperCase(), token);
    }
  }

  /**
   * Get all supported tokens
   */
  getSupportedTokens(): SupportedToken[] {
    return Array.from(this.tokens.values());
  }

  /**
   * Get a token by its contract address
   */
  getTokenByAddress(address: string): SupportedToken | undefined {
    return this.tokens.get(address.toLowerCase());
  }

  /**
   * Get a token by its symbol
   */
  getTokenBySymbol(symbol: string): SupportedToken | undefined {
    return this.tokensBySymbol.get(symbol.toUpperCase());
  }

  /**
   * Check if a token is supported
   */
  isTokenSupported(address: string): boolean {
    return this.tokens.has(address.toLowerCase());
  }

  /**
   * Get token addresses for a specific chain
   */
  getTokensForChain(chainId: number): SupportedToken[] {
    return Array.from(this.tokens.values()).filter(
      (token) => token.chainId === chainId,
    );
  }

  /**
   * Get the coingecko ID for a token address
   */
  getCoingeckoId(address: string): string | undefined {
    const token = this.getTokenByAddress(address);
    return token?.coingeckoId;
  }

  /**
   * Format token amount from smallest unit to human-readable
   */
  formatTokenAmount(amount: bigint | string, address: string): string {
    const token = this.getTokenByAddress(address);
    if (!token) return '0';

    const amountBigInt =
      typeof amount === 'string' ? BigInt(amount) : amount;
    const divisor = BigInt(10 ** token.decimals);
    const wholePart = amountBigInt / divisor;
    const fractionalPart = amountBigInt % divisor;

    if (fractionalPart === BigInt(0)) {
      return wholePart.toString();
    }

    const fractionalStr = fractionalPart
      .toString()
      .padStart(token.decimals, '0')
      .replace(/0+$/, '');
    return `${wholePart}.${fractionalStr}`;
  }

  /**
   * Parse human-readable token amount to smallest unit
   */
  parseTokenAmount(amount: string, address: string): bigint {
    const token = this.getTokenByAddress(address);
    if (!token) return BigInt(0);

    const [whole, fractional = ''] = amount.split('.');
    const paddedFractional = fractional
      .padEnd(token.decimals, '0')
      .slice(0, token.decimals);
    const fullAmount = whole + paddedFractional;
    return BigInt(fullAmount);
  }
}

// Export singleton instance
export const tokenService = new TokenService();

// Export types and constants
export { SUPPORTED_TOKENS };

