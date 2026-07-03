import { tokenService, SupportedToken } from './tokenService';
import { parseUnits, formatUnits } from 'viem';

// Reference price + the depth of the pool it came from, so the swap value guard
// can size its liquidity requirement to the trade (a big trade needs a deeper
// reference than a tiny one). liquidityUsd is null when the price came from a
// source that doesn't expose pool depth (CoinGecko) — those are already
// broad-market references, so the guard treats them as adequately deep.
export interface ReferencePrice {
  priceUsd: number;
  liquidityUsd: number | null;
  source: 'coingecko' | 'dexscreener';
}

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

    // Fallback: DexScreener — works for any token with DEX liquidity, no API key.
    // No liquidity floor here — this method just returns a usable price; the swap
    // value guard applies a trade-proportional depth check via getReferencePrice.
    const dex = await this.fetchDexScreenerBase(address);
    if (!dex) {
      throw new Error(`No price data found for ${address} from CoinGecko or DexScreener`);
    }
    this.tokenCache.set(cacheKey, { price: dex.priceUsd, timestamp: now });
    return dex.priceUsd;
  }

  /**
   * DexScreener price + deepest-Base-pool liquidity for a token. Returns null if
   * there's no usable Base pair / price. Non-positive/garbled prices are rejected
   * so a broken feed value never reaches the swap guard.
   */
  private async fetchDexScreenerBase(
    address: string,
  ): Promise<{ priceUsd: number; liquidityUsd: number } | null> {
    const dexUrl = `https://api.dexscreener.com/latest/dex/tokens/${address.toLowerCase()}`;
    let dexData: any;
    try {
      const dexResponse = await fetch(dexUrl, { method: 'GET', headers: { accept: 'application/json' } });
      if (!dexResponse.ok) return null;
      dexData = await dexResponse.json();
    } catch {
      return null;
    }
    // Do NOT assume the API returns pairs liquidity-sorted. Explicitly pick the
    // DEEPEST Base pair — pricing off a thin pair would defeat the guard.
    const allPairs: any[] = Array.isArray(dexData?.pairs) ? dexData.pairs : [];
    const basePairs = allPairs.filter((p) => p?.chainId === 'base');
    const candidates = basePairs.length ? basePairs : allPairs;
    if (!candidates.length) return null;
    const deepest = candidates.reduce(
      (best, p) => ((Number(p?.liquidity?.usd) || 0) > (Number(best?.liquidity?.usd) || 0) ? p : best),
      candidates[0],
    );
    const priceUsd = Number(deepest?.priceUsd);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
    return { priceUsd, liquidityUsd: Number(deepest?.liquidity?.usd) || 0 };
  }

  /**
   * Reference price for the swap value guard — works for ANY token, not just the
   * SUPPORTED_TOKENS registry. Prefers CoinGecko (broad-market, pool-independent),
   * falls back to the deepest Base DexScreener pool. Returns that pool's depth when
   * the price is DEX-derived so the guard can require liquidity proportional to the
   * trade size. Throws (fail-closed) when no price is available at all — a token we
   * cannot price independently is never swapped.
   */
  async getReferencePrice(address: string): Promise<ReferencePrice> {
    const registry = tokenService.getTokenByAddress(address);
    const platformId = registry?.coingeckoPlatformId ?? 'base';
    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (this.COINGECKO_API_KEY) headers['x-cg-pro-api-key'] = this.COINGECKO_API_KEY;
      const url = `${this.COINGECKO_API_URL}/simple/token_price/${platformId}?contract_addresses=${address.toLowerCase()}&vs_currencies=usd`;
      const response = await fetch(url, { method: 'GET', headers });
      if (response.ok) {
        const data: any = await response.json();
        const price = Number(data[address.toLowerCase()]?.usd);
        if (Number.isFinite(price) && price > 0) {
          return { priceUsd: price, liquidityUsd: null, source: 'coingecko' };
        }
      }
    } catch {
      /* fall through to DexScreener */
    }
    const dex = await this.fetchDexScreenerBase(address);
    if (!dex) {
      throw new Error(`No reference price for ${address} (CoinGecko + DexScreener both empty)`);
    }
    return { priceUsd: dex.priceUsd, liquidityUsd: dex.liquidityUsd, source: 'dexscreener' };
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
