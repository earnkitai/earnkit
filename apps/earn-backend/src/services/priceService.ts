import { tokenService, SupportedToken } from './tokenService';
import { parseUnits, formatUnits } from 'viem';

interface PriceCache {
  ethPrice: number;
  timestamp: number;
}

interface TokenPriceCache {
  price: number;
  timestamp: number;
}

export class PriceService {
  private cache: PriceCache | null = null;
  private tokenCache: Map<string, TokenPriceCache> = new Map();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes — short cache so a bad/stale ETH price clears quickly and doesn't overcharge users
  private readonly TOKEN_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes for tokens (more volatile)
  // Sanity bounds to reject obviously broken price feed responses (units bug, garbled value, etc.)
  private readonly MIN_REASONABLE_ETH_PRICE = 200;
  private readonly MAX_REASONABLE_ETH_PRICE = 50_000;
  private readonly ALCHEMY_API_KEY: string;
  private readonly ALCHEMY_API_URL =
    'https://api.g.alchemy.com/prices/v1/tokens/by-symbol';
  private readonly COINGECKO_API_KEY: string | undefined;
  private readonly COINGECKO_API_URL: string;

  constructor() {
    this.ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || '';
    
    // CoinGecko API configuration
    // If API key is provided, use Pro API with better rate limits
    this.COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
    this.COINGECKO_API_URL = this.COINGECKO_API_KEY
      ? 'https://pro-api.coingecko.com/api/v3'
      : 'https://api.coingecko.com/api/v3';
    
    if (this.COINGECKO_API_KEY) {
      console.log('CoinGecko Pro API enabled');
    } else {
      console.log('Using CoinGecko free API (consider adding COINGECKO_API_KEY for better rate limits)');
    }
  }

  /**
   * Get current ETH price in USD
   * Uses caching to avoid excessive API calls
   */
  async getEthPrice(): Promise<number> {
    const now = Date.now();

    // Check if we have valid cached data
    if (this.cache && now - this.cache.timestamp < this.CACHE_DURATION) {
      console.log('Using cached ETH price:', this.cache.ethPrice);
      return this.cache.ethPrice;
    }

    try {
      console.log('Fetching fresh ETH price from Alchemy API...');

      if (!this.ALCHEMY_API_KEY) {
        throw new Error('ALCHEMY_API_KEY is not configured');
      }

      const response = await fetch(`${this.ALCHEMY_API_URL}?symbols=ETH`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${this.ALCHEMY_API_KEY}`,
        },
      });

      if (!response.ok) {
        throw new Error(
          `Alchemy API error: ${response.status} ${response.statusText}`,
        );
      }

      const data: any = await response.json();
      const usdPrice = data?.data[0]?.prices[0].value;
      console.log('usdPrice', data?.data[0]?.prices);
      if (!usdPrice) {
        throw new Error('Invalid response format from Alchemy API');
      }
      const ethData = data.data[0];
      if (
        !ethData?.prices ||
        !Array.isArray(ethData.prices) ||
        ethData.prices.length === 0
      ) {
        throw new Error('No price data found in Alchemy response');
      }

      const ethPrice = Number(ethData.prices[0].value);

      if (
        !Number.isFinite(ethPrice) ||
        ethPrice < this.MIN_REASONABLE_ETH_PRICE ||
        ethPrice > this.MAX_REASONABLE_ETH_PRICE
      ) {
        throw new Error(
          `Alchemy returned out-of-range ETH price: ${ethPrice}`,
        );
      }

      // Cache the result
      this.cache = {
        ethPrice,
        timestamp: now,
      };

      console.log('Fresh ETH price fetched:', ethPrice);
      return ethPrice;
    } catch (error) {
      console.error('Error fetching ETH price:', error);

      // If we have cached data, use it even if expired
      if (this.cache) {
        console.log(
          'Using expired cached ETH price as fallback:',
          this.cache.ethPrice,
        );
        return this.cache.ethPrice;
      }

      // No cache and no live price: fail loudly rather than silently charging
      // users at a guessed rate that can be wildly wrong.
      throw new Error(
        'ETH price unavailable: live fetch failed and no cached value. Refusing to use a hardcoded fallback.',
      );
    }
  }

  /**
   * Get token price in USD using CoinGecko's contract-address endpoint.
   * This is more reliable than the slug-based /simple/price because it
   * works for any token with on-chain liquidity — no CoinGecko slug needed.
   *
   * @param platformId  CoinGecko platform ID for the chain (e.g. "base", "ethereum")
   * @param address     Token contract address
   */
  async getTokenPrice(platformId: string, address: string): Promise<number> {
    const now = Date.now();
    const cacheKey = `${platformId}:${address.toLowerCase()}`;

    const cached = this.tokenCache.get(cacheKey);
    if (cached && now - cached.timestamp < this.TOKEN_CACHE_DURATION) {
      console.log(`Using cached price for ${address}:`, cached.price);
      return cached.price;
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.COINGECKO_API_KEY) {
      headers['x-cg-pro-api-key'] = this.COINGECKO_API_KEY;
    }

    const url = `${this.COINGECKO_API_URL}/simple/token_price/${platformId}?contract_addresses=${address.toLowerCase()}&vs_currencies=usd`;
    console.log(`Fetching price for ${address} on ${platformId}...`);

    const response = await fetch(url, { method: 'GET', headers });

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    const price = data[address.toLowerCase()]?.usd;

    if (price === undefined || price === null) {
      throw new Error(`No price data found for ${address} on ${platformId}`);
    }

    const tokenPrice = Number(price);
    this.tokenCache.set(cacheKey, { price: tokenPrice, timestamp: now });
    console.log(`Price for ${address}: $${tokenPrice}`);
    return tokenPrice;
  }

  /**
   * Get token price by symbol
   * @param symbol The token symbol (e.g., 'MINIDEV', 'USDC')
   */
  async getTokenPriceBySymbol(symbol: string): Promise<number> {
    const token = tokenService.getTokenBySymbol(symbol);
    if (!token) {
      throw new Error(`Token ${symbol} is not supported`);
    }
    return this.getTokenPrice(token.coingeckoPlatformId, token.address);
  }

  /**
   * Get token price by contract address
   * @param address The token contract address
   */
  async getTokenPriceByAddress(address: string): Promise<number> {
    const token = tokenService.getTokenByAddress(address);
    if (!token) {
      throw new Error(`Token at ${address} is not supported`);
    }
    return this.getTokenPrice(token.coingeckoPlatformId, token.address);
  }

  /**
   * Convert USD amount to ETH amount
   */
  async convertUsdToEth(usdAmount: number): Promise<number> {
    const ethPrice = await this.getEthPrice();
    return usdAmount / ethPrice;
  }

  /**
   * Convert ETH amount to USD amount
   */
  async convertEthToUsd(ethAmount: number): Promise<number> {
    const ethPrice = await this.getEthPrice();
    return ethAmount * ethPrice;
  }

  /**
   * Convert USD amount to WEI
   */
  async convertUsdToWei(usdAmount: number): Promise<string> {
    const ethAmount = await this.convertUsdToEth(usdAmount);
    const weiAmount = ethAmount * 1e18; // Convert ETH to WEI
    return Math.floor(weiAmount).toString();
  }

  /**
   * Convert USD amount to token amount (in smallest units)
   * @param usdAmount The USD amount to convert
   * @param tokenSymbol The token symbol (e.g., 'MINIDEV', 'USDC')
   */
  async convertUsdToToken(
    usdAmount: number,
    tokenSymbol: string,
  ): Promise<{ amount: string; humanReadable: string; decimals: number }> {
    const token = tokenService.getTokenBySymbol(tokenSymbol);
    if (!token) {
      throw new Error(`Token ${tokenSymbol} is not supported`);
    }

    const tokenPrice = await this.getTokenPrice(token.coingeckoPlatformId, token.address);
    const tokenAmount = usdAmount / tokenPrice;
    const tokenAmountFixed = tokenAmount.toFixed(token.decimals);
    const smallestUnitAmount = parseUnits(tokenAmountFixed, token.decimals);

    return {
      amount: smallestUnitAmount.toString(),
      humanReadable: tokenAmount.toFixed(token.decimals > 6 ? 6 : token.decimals),
      decimals: token.decimals,
    };
  }

  /**
   * Convert token amount (in smallest units) to USD
   * @param tokenAmount The token amount in smallest units
   * @param tokenSymbol The token symbol (e.g., 'MINIDEV', 'USDC')
   */
  async convertTokenToUsd(
    tokenAmount: string | bigint,
    tokenSymbol: string,
  ): Promise<number> {
    const token = tokenService.getTokenBySymbol(tokenSymbol);
    if (!token) {
      throw new Error(`Token ${tokenSymbol} is not supported`);
    }

    const tokenPrice = await this.getTokenPrice(token.coingeckoPlatformId, token.address);
    const amountBigInt =
      typeof tokenAmount === 'string' ? BigInt(tokenAmount) : tokenAmount;
    const humanReadableAmount = parseFloat(formatUnits(amountBigInt, token.decimals));
    return humanReadableAmount * tokenPrice;
  }

  /**
   * Get all prices for supported tokens
   */
  async getAllTokenPrices(): Promise<
    Map<string, { symbol: string; price: number }>
  > {
    const tokens = tokenService.getSupportedTokens();
    const prices = new Map<string, { symbol: string; price: number }>();

    for (const token of tokens) {
      try {
        const price = await this.getTokenPrice(token.coingeckoPlatformId, token.address);
        prices.set(token.address.toLowerCase(), {
          symbol: token.symbol,
          price,
        });
      } catch (error) {
        console.error(`Failed to fetch price for ${token.symbol}:`, error);
      }
    }

    return prices;
  }

  /**
   * Get cache information for debugging
   */
  getCacheInfo(): {
    eth: { hasCache: boolean; isExpired: boolean; age: number };
    tokens: { [key: string]: { hasCache: boolean; isExpired: boolean; age: number } };
  } {
    const now = Date.now();

    const ethCacheInfo = !this.cache
      ? { hasCache: false, isExpired: false, age: 0 }
      : {
          hasCache: true,
          isExpired: now - this.cache.timestamp >= this.CACHE_DURATION,
          age: Math.floor((now - this.cache.timestamp) / 1000),
        };

    const tokenCacheInfo: {
      [key: string]: { hasCache: boolean; isExpired: boolean; age: number };
    } = {};

    for (const [key, cached] of this.tokenCache.entries()) {
      tokenCacheInfo[key] = {
        hasCache: true,
        isExpired: now - cached.timestamp >= this.TOKEN_CACHE_DURATION,
        age: Math.floor((now - cached.timestamp) / 1000),
      };
    }

    return {
      eth: ethCacheInfo,
      tokens: tokenCacheInfo,
    };
  }
}

// Export singleton instance
export const priceService = new PriceService();
