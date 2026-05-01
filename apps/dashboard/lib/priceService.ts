interface TokenPrice {
  symbol: string;
  price: number;
  timestamp: number;
}

interface PriceCache {
  prices: TokenPrice[];
  lastUpdated: number;
}

interface CoingeckoTokenCache {
  price: number;
  timestamp: number;
}

class PriceService {
  private cache: PriceCache | null = null;
  private tokenCache: Map<string, CoingeckoTokenCache> = new Map();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes — short cache so a stale/bad ETH price clears quickly
  private readonly TOKEN_CACHE_DURATION = 5 * 60 * 1000;
  private readonly API_URL =
    'https://api.g.alchemy.com/prices/v1/tokens/by-symbol';
  private readonly API_KEY = process.env.ALCHEMY_API_KEY || '';
  private readonly COINGECKO_API_KEY: string | undefined;
  private readonly COINGECKO_API_URL: string;
  // Sanity bounds to reject obviously broken price feed responses.
  private readonly MIN_REASONABLE_ETH_PRICE = 200;
  private readonly MAX_REASONABLE_ETH_PRICE = 50_000;

  constructor() {
    this.COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
    this.COINGECKO_API_URL = this.COINGECKO_API_KEY
      ? 'https://pro-api.coingecko.com/api/v3'
      : 'https://api.coingecko.com/api/v3';
  }

  private isCacheValid(): boolean {
    if (!this.cache) return false;
    const now = Date.now();
    return now - this.cache.lastUpdated < this.CACHE_DURATION;
  }

  private async fetchPrices(): Promise<TokenPrice[]> {
    try {
      if (!this.API_KEY) {
        throw new Error('ALCHEMY_API_KEY is not configured');
      }

      const response = await fetch(`${this.API_URL}?symbols=ETH`, {
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${this.API_KEY}`,
        },
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('ETH Price', data?.data[0]?.prices[0].value);
      // Transform the API response to our format
      const prices: TokenPrice[] = [];
      console.log('prices', data);

      const rawValue = data?.data[0]?.prices[0]?.value;
      const numericPrice = Number(rawValue);
      if (
        Number.isFinite(numericPrice) &&
        numericPrice >= this.MIN_REASONABLE_ETH_PRICE &&
        numericPrice <= this.MAX_REASONABLE_ETH_PRICE
      ) {
        prices.push({
          symbol: 'ETH',
          price: numericPrice,
          timestamp: Date.now(),
        });
      } else if (rawValue !== undefined) {
        throw new Error(
          `Alchemy returned out-of-range ETH price: ${rawValue}`,
        );
      }
      return prices;
    } catch (error) {
      console.error('Error fetching token prices:', error);
      throw error;
    }
  }

  async getEthPrice(): Promise<number> {
    // Check if cache is valid
    if (this.isCacheValid() && this.cache) {
      const ethPrice = this.cache.prices.find((p) => p.symbol === 'ETH');
      if (ethPrice) {
        console.log('Using cached ETH price:', ethPrice.price);
        return ethPrice.price;
      }
    }

    // Fetch new prices
    console.log('Fetching fresh token prices from API...');
    const prices = await this.fetchPrices();

    // Update cache
    this.cache = {
      prices,
      lastUpdated: Date.now(),
    };

    const ethPrice = prices.find((p) => p.symbol === 'ETH');
    if (!ethPrice) {
      throw new Error('ETH price not found in API response');
    }

    console.log('Fresh ETH price fetched:', ethPrice.price);
    return ethPrice.price;
  }

  async convertEthToUsd(ethAmount: number): Promise<number> {
    const ethPrice = await this.getEthPrice();
    return ethAmount * ethPrice;
  }

  /**
   * Get a token's USD price by CoinGecko ID. Cached for 5 minutes; throws on
   * failure rather than returning a hardcoded fallback.
   */
  async getTokenPrice(coingeckoId: string): Promise<number> {
    const now = Date.now();
    const cacheKey = coingeckoId.toLowerCase();
    const cached = this.tokenCache.get(cacheKey);
    if (cached && now - cached.timestamp < this.TOKEN_CACHE_DURATION) {
      return cached.price;
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.COINGECKO_API_KEY) {
      headers['x-cg-pro-api-key'] = this.COINGECKO_API_KEY;
    }

    const response = await fetch(
      `${this.COINGECKO_API_URL}/simple/price?ids=${encodeURIComponent(
        coingeckoId,
      )}&vs_currencies=usd`,
      { headers },
    );

    if (!response.ok) {
      throw new Error(
        `CoinGecko API error: ${response.status} ${response.statusText}`,
      );
    }

    const data: any = await response.json();
    const raw = data?.[coingeckoId]?.usd;
    const price = Number(raw);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`No usable price returned for ${coingeckoId}`);
    }

    this.tokenCache.set(cacheKey, { price, timestamp: now });
    return price;
  }

  getCacheInfo(): {
    lastUpdated: number;
    isValid: boolean;
    prices: TokenPrice[];
  } {
    if (!this.cache) {
      return {
        lastUpdated: 0,
        isValid: false,
        prices: [],
      };
    }

    return {
      lastUpdated: this.cache.lastUpdated,
      isValid: this.isCacheValid(),
      prices: this.cache.prices,
    };
  }
}

// Export a singleton instance
export const priceService = new PriceService();
