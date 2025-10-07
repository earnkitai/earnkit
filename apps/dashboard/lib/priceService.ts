interface TokenPrice {
  symbol: string;
  price: number;
  timestamp: number;
}

interface PriceCache {
  prices: TokenPrice[];
  lastUpdated: number;
}

class PriceService {
  private cache: PriceCache | null = null;
  private readonly CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours in milliseconds
  private readonly API_URL =
    'https://api.g.alchemy.com/prices/v1/tokens/by-symbol';
  private readonly API_KEY =
    process.env.ALCHEMY_API_KEY || 'LXjhr7UM3pL_Cro_wt6ph4cd-c_0x9bo';

  private isCacheValid(): boolean {
    if (!this.cache) return false;
    const now = Date.now();
    return now - this.cache.lastUpdated < this.CACHE_DURATION;
  }

  private async fetchPrices(): Promise<TokenPrice[]> {
    try {
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

      if (data?.data[0]?.prices[0].value) {
        prices.push({
          symbol: 'ETH',
          price: data.data[0]?.prices[0].value,
          timestamp: Date.now(),
        });
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
