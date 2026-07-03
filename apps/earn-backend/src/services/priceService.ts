import { tokenService, SupportedToken } from './tokenService';
import { parseUnits, formatUnits } from 'viem';

// Minimum liquidity (USD) a DexScreener pool must have before we'll price a token
// off it. Below this the pool is cheap to manipulate, so the swap value guard
// would be validating against a reference an attacker controls. Env-tunable.
const DEXSCREENER_MIN_LIQUIDITY_USD = (() => {
  const raw = parseInt(process.env.PRICE_MIN_POOL_LIQUIDITY_USD ?? '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 25_000;
})();

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
    
    if (!this.COINGECKO_API_KEY) {
      console.warn('[PriceService] No COINGECKO_API_KEY — using free tier (rate limited)');
    }
  }

  /**
   * Get current ETH price in USD
   * Uses caching to avoid excessive API calls
   */
  async getEthPrice(maxAgeMs?: number): Promise<number> {
    const now = Date.now();
    // Callers that need a live price (e.g. the swap value guard) pass a tight
    // maxAgeMs; the default keeps the normal 5-min cache for user-facing pricing.
    const freshnessWindow = maxAgeMs ?? this.CACHE_DURATION;

    if (this.cache && now - this.cache.timestamp < freshnessWindow) {
      return this.cache.ethPrice;
    }

    const errors: string[] = [];

    // --- Attempt 1: Alchemy prices API ---
    if (this.ALCHEMY_API_KEY) {
      try {
        const response = await fetch(`${this.ALCHEMY_API_URL}?symbols=ETH`, {
          method: 'GET',
          headers: { accept: 'application/json', Authorization: `Bearer ${this.ALCHEMY_API_KEY}` },
        });
        if (response.ok) {
          const data: any = await response.json();
          const ethPrice = Number(data?.data?.[0]?.prices?.[0]?.value);
          if (Number.isFinite(ethPrice) && ethPrice >= this.MIN_REASONABLE_ETH_PRICE && ethPrice <= this.MAX_REASONABLE_ETH_PRICE) {
            this.cache = { ethPrice, timestamp: now };
            return ethPrice;
          }
        }
        errors.push(`Alchemy: ${response.status} ${response.statusText}`);
      } catch (e: any) {
        errors.push(`Alchemy: ${e?.message ?? e}`);
      }
    }

    // --- Attempt 2: CoinGecko Pro (if key set) ---
    if (this.COINGECKO_API_KEY) {
      try {
        const response = await fetch(
          `https://pro-api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd`,
          { method: 'GET', headers: { accept: 'application/json', 'x-cg-pro-api-key': this.COINGECKO_API_KEY } },
        );
        if (response.ok) {
          const data: any = await response.json();
          const ethPrice = Number(data?.ethereum?.usd);
          if (Number.isFinite(ethPrice) && ethPrice >= this.MIN_REASONABLE_ETH_PRICE && ethPrice <= this.MAX_REASONABLE_ETH_PRICE) {
            this.cache = { ethPrice, timestamp: now };
            return ethPrice;
          }
        }
        errors.push(`CoinGecko Pro: ${response.status}`);
      } catch (e: any) {
        errors.push(`CoinGecko Pro: ${e?.message ?? e}`);
      }
    }

    // --- Attempt 3: CoinGecko free (no key, always available) ---
    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd`,
        { method: 'GET', headers: { accept: 'application/json' } },
      );
      if (response.ok) {
        const data: any = await response.json();
        const ethPrice = Number(data?.ethereum?.usd);
        if (Number.isFinite(ethPrice) && ethPrice >= this.MIN_REASONABLE_ETH_PRICE && ethPrice <= this.MAX_REASONABLE_ETH_PRICE) {
          this.cache = { ethPrice, timestamp: now };
          return ethPrice;
        }
      }
      errors.push(`CoinGecko free: ${response.status}`);
    } catch (e: any) {
      errors.push(`CoinGecko free: ${e?.message ?? e}`);
    }

    // --- Expired cache fallback ---
    // Never serve a stale price to a caller that demanded freshness (the swap
    // guard). Fail closed instead so a feed outage can't validate a bad swap.
    if (this.cache && maxAgeMs === undefined) {
      return this.cache.ethPrice;
    }

    throw new Error(`ETH price unavailable (tried: ${errors.join(', ')}). No fresh value.`);
  }

  /** Convenience alias used by workers */
  async getEthPriceUsd(maxAgeMs?: number): Promise<number> {
    return this.getEthPrice(maxAgeMs);
  }

  /**
   * Get token price in USD using CoinGecko's contract-address endpoint.
   * This is more reliable than the slug-based /simple/price because it
   * works for any token with on-chain liquidity — no CoinGecko slug needed.
   *
   * @param platformId  CoinGecko platform ID for the chain (e.g. "base", "ethereum")
   * @param address     Token contract address
   */
  async getTokenPrice(platformId: string, address: string, maxAgeMs?: number): Promise<number> {
    const now = Date.now();
    const cacheKey = `${platformId}:${address.toLowerCase()}`;
    const freshnessWindow = maxAgeMs ?? this.TOKEN_CACHE_DURATION;

    const cached = this.tokenCache.get(cacheKey);
    if (cached && now - cached.timestamp < freshnessWindow) {
      return cached.price;
    }

    // Try CoinGecko first
    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (this.COINGECKO_API_KEY) {
        headers['x-cg-pro-api-key'] = this.COINGECKO_API_KEY;
      }

      const url = `${this.COINGECKO_API_URL}/simple/token_price/${platformId}?contract_addresses=${address.toLowerCase()}&vs_currencies=usd`;
      const response = await fetch(url, { method: 'GET', headers });

      if (response.ok) {
        const data: any = await response.json();
        const price = data[address.toLowerCase()]?.usd;

        if (price !== undefined && price !== null) {
          const tokenPrice = Number(price);
          this.tokenCache.set(cacheKey, { price: tokenPrice, timestamp: now });
          return tokenPrice;
        }
      }
    } catch { /* fall through to DexScreener */ }

    // Fallback: DexScreener — works for any token with DEX liquidity, no API key needed
    const dexUrl = `https://api.dexscreener.com/latest/dex/tokens/${address.toLowerCase()}`;
    const dexResponse = await fetch(dexUrl, { method: 'GET', headers: { accept: 'application/json' } });

    if (!dexResponse.ok) {
      throw new Error(`DexScreener API error: ${dexResponse.status} ${dexResponse.statusText}`);
    }

    const dexData: any = await dexResponse.json();
    // Do NOT assume the API returns pairs liquidity-sorted. Explicitly pick the
    // DEEPEST pair (on Base). Pricing off a thin/manipulated pair here would
    // defeat the buyback swap guard, which trusts this as its independent market
    // reference — the whole point is to not be fooled by a near-empty pool.
    const allPairs: any[] = Array.isArray(dexData?.pairs) ? dexData.pairs : [];
    const basePairs = allPairs.filter((p) => p?.chainId === 'base');
    const candidates = basePairs.length ? basePairs : allPairs;
    const deepest = candidates.reduce(
      (best, p) =>
        (Number(p?.liquidity?.usd) || 0) > (Number(best?.liquidity?.usd) || 0) ? p : best,
      candidates[0],
    );
    const priceUsd = deepest?.priceUsd;

    if (priceUsd === undefined || priceUsd === null) {
      throw new Error(`No price data found for ${address} from CoinGecko or DexScreener`);
    }

    // Fail CLOSED on a thin reference pool. When the guard falls back to
    // DexScreener (CoinGecko miss), the reference must come from a pool deep
    // enough that it can't be cheaply manipulated in lockstep with the swap pool —
    // otherwise the "independent" check isn't independent. Below the floor we
    // throw so the buyback skips (funds stay safe) rather than validate against a
    // manipulable price. Floor is env-tunable so ops can adjust without a deploy.
    const deepestLiquidityUsd = Number(deepest?.liquidity?.usd) || 0;
    if (deepestLiquidityUsd < DEXSCREENER_MIN_LIQUIDITY_USD) {
      throw new Error(
        `Token ${address}: deepest DexScreener pool has only $${deepestLiquidityUsd.toFixed(0)} liquidity ` +
          `(floor $${DEXSCREENER_MIN_LIQUIDITY_USD}) — refusing to price off a thin/manipulable pool`,
      );
    }

    const tokenPrice = Number(priceUsd);
    // Reject a garbled feed value (units bug, NaN, non-positive) rather than let
    // it flow into the swap value guard as a real price.
    if (!Number.isFinite(tokenPrice) || tokenPrice <= 0) {
      throw new Error(`Token ${address}: DexScreener returned a non-positive/invalid price (${priceUsd})`);
    }
    this.tokenCache.set(cacheKey, { price: tokenPrice, timestamp: now });
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
  async getTokenPriceByAddress(address: string, maxAgeMs?: number): Promise<number> {
    const token = tokenService.getTokenByAddress(address);
    if (!token) {
      throw new Error(`Token at ${address} is not supported`);
    }
    return this.getTokenPrice(token.coingeckoPlatformId, token.address, maxAgeMs);
  }

  /** Convenience alias used by workers */
  async getTokenPriceUsd(address: string, maxAgeMs?: number): Promise<number> {
    return this.getTokenPriceByAddress(address, maxAgeMs);
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
