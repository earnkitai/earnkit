interface PriceCache {
  ethPrice: number;
  timestamp: number;
}

export class PriceService {
  private cache: PriceCache | null = null;
  private readonly CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
  private readonly ALCHEMY_API_KEY: string;
  private readonly ALCHEMY_API_URL =
    'https://api.g.alchemy.com/prices/v1/tokens/by-symbol';

  constructor() {
    this.ALCHEMY_API_KEY =
      process.env.ALCHEMY_API_KEY || 'LXjhr7UM3pL_Cro_wt6ph4cd-c_0x9bo';
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

      // Final fallback - use a reasonable default price
      const fallbackPrice = 3000; // $3000 USD per ETH
      console.log('Using fallback ETH price:', fallbackPrice);
      return fallbackPrice;
    }
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
   * Get cache information for debugging
   */
  getCacheInfo(): { hasCache: boolean; isExpired: boolean; age: number } {
    if (!this.cache) {
      return { hasCache: false, isExpired: false, age: 0 };
    }

    const now = Date.now();
    const age = now - this.cache.timestamp;
    const isExpired = age >= this.CACHE_DURATION;

    return {
      hasCache: true,
      isExpired,
      age: Math.floor(age / 1000), // Age in seconds
    };
  }
}

// Export singleton instance
export const priceService = new PriceService();
