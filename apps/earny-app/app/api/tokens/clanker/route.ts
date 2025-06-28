import { NextResponse } from 'next/server';
import { env } from '@/env.mjs';

interface CoinGeckoPool {
  id: string;
  type: string;
  attributes: {
    base_token_price_usd: string;
    quote_token_price_usd: string;
    address: string;
    name: string;
    pool_created_at: string;
    fdv_usd: string;
    market_cap_usd: string | null;
    price_change_percentage: {
      m5: string;
      m15: string;
      m30: string;
      h1: string;
      h6: string;
      h24: string;
    };
    reserve_in_usd: string;
    h24_volume_usd: string;
    h24_tx_count: number;
  };
  relationships: {
    base_token: {
      data: {
        id: string;
        type: string;
      };
    };
    quote_token: {
      data: {
        id: string;
        type: string;
      };
    };
    network: {
      data: {
        id: string;
        type: string;
      };
    };
    dex: {
      data: {
        id: string;
        type: string;
      };
    };
  };
}

interface CoinGeckoToken {
  id: string;
  type: string;
  attributes: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    image_url: string;
    coingecko_coin_id: string | null;
  };
}

interface CoinGeckoResponse {
  data: CoinGeckoPool[];
  included: CoinGeckoToken[];
}

interface TransformedToken {
  name: string;
  marketCap: number;
  priceUsd: number;
  volume24h: number;
  address: string;
  symbol: string;
  holders: number;
  platform: 'CLANKER';
  risk: number;
  imageUrl: string;
}

export async function GET() {
  try {
    const COINGECKO_API_KEY = env.COINGECKO_API_KEY;

    if (!COINGECKO_API_KEY) {
      return NextResponse.json(
        { error: 'CoinGecko API key not configured' },
        { status: 500 },
      );
    }

    const url =
      'https://pro-api.coingecko.com/api/v3/onchain/categories/clanker-world/pools?include=base_token&page=1&sort=h24_volume_usd_desc';

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-cg-pro-api-key': COINGECKO_API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(`CoinGecko API call failed: ${response.statusText}`);
    }

    const data: CoinGeckoResponse = await response.json();

    // Create a map of token IDs to token data for quick lookup
    const tokenMap = new Map<string, CoinGeckoToken>();
    data.included.forEach((token) => {
      tokenMap.set(token.id, token);
    });

    // Transform the data to match the expected format
    const transformedTokens: TransformedToken[] = data.data
      .filter((pool) => {
        // Only include pools with base tokens that have image URLs
        const baseTokenId = pool.relationships.base_token.data.id;
        const baseToken = tokenMap.get(baseTokenId);
        return baseToken && baseToken.attributes.image_url;
      })
      .map((pool) => {
        const baseTokenId = pool.relationships.base_token.data.id;
        const baseToken = tokenMap.get(baseTokenId);

        if (!baseToken) {
          throw new Error(`Base token not found for pool ${pool.id}`);
        }

        return {
          name: baseToken.attributes.name,
          marketCap: pool.attributes.market_cap_usd
            ? parseFloat(pool.attributes.market_cap_usd)
            : parseFloat(pool.attributes.fdv_usd),
          priceUsd: parseFloat(pool.attributes.base_token_price_usd),
          volume24h: parseFloat(pool.attributes.h24_volume_usd),
          address: baseToken.attributes.address,
          symbol: baseToken.attributes.symbol,
          holders: pool.attributes.h24_tx_count, // Using transaction count as a proxy for holders
          platform: 'CLANKER' as const,
          risk: 0, // Default risk level
          imageUrl: baseToken.attributes.image_url,
        };
      })
      .filter((token) => token.marketCap > 0 && token.volume24h > 0) // Filter out tokens with no market cap or volume
      .sort((a, b) => b.volume24h - a.volume24h) // Sort by volume descending
      .slice(0, 2); // Limit to top 10 tokens

    return NextResponse.json({ tokens: transformedTokens });
  } catch (error) {
    console.error('Error fetching Clanker tokens from CoinGecko:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Clanker tokens' },
      { status: 500 },
    );
  }
}
