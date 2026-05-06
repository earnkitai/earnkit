import { useEffect, useState } from 'react';

interface TokenData {
  name: string;
  marketCap: number;
  priceUsd: number;
  volume24h: number;
  address: string;
  symbol: string;
  holders: number;
  platform: 'ZORA' | 'CLANKER';
  risk: number | 'low';
  imageUrl: string;
}

interface InvestmentRecommendation {
  name: string;
  symbol: string;
  address: string;
  marketCap: string;
  volume24h: string;
  uniqueHolders?: number;
  createdAt?: string;
  marketCapDelta24h?: string;
  confidenceScore?: number;
  sources?: string[];
  platform?: 'ZORA' | 'CLANKER';
  imageUrl?: string;
  riskLevel?: number;
  previewImage?: {
    small?: string;
    medium?: string;
    blurhash?: string;
  };
}

interface ClankerResponse {
  tokens: {
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
  }[];
}

interface CacheData {
  tokens: TokenData[];
  timestamp: number;
}

// Cache duration in milliseconds (1 hour)
const CACHE_DURATION = 60 * 60 * 1000;

// In-memory cache object
let tokenCache: CacheData | null = null;

export function useTokenData() {
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTokenData() {
      try {
        // Check if we have valid cached data
        if (tokenCache && Date.now() - tokenCache.timestamp < CACHE_DURATION) {
          setTokens(tokenCache.tokens);
          setLoading(false);
          return;
        }

        setLoading(true);
        const [zoraResponse, clankerResponse] = await Promise.all([
          await fetch(`/api/investments/zora?amount=100&percentage=low`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }),
          await fetch(`/api/tokens/clanker`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }),
        ]);

        const zoraData = await zoraResponse.json();
        const clankerData: ClankerResponse = await clankerResponse.json();

        if (
          zoraData.recommendations?.length > 0 &&
          clankerData.tokens?.length > 0
        ) {
          // Transform and fetch images for Zora tokens
          const zoraTokensPromises = zoraData.recommendations.map(
            async (token: InvestmentRecommendation) => {
              return {
                name: token.name,
                marketCap: parseFloat(token.marketCap),
                address: token.address,
                symbol: token.symbol,
                volume24h: parseFloat(token.volume24h),
                priceUsd: 0,
                holders: token.uniqueHolders || 0,
                platform: 'ZORA' as const,
                risk: 'low' as const,
                imageUrl: token.previewImage?.medium || '',
              };
            },
          );

          const zoraTokens = await Promise.all(zoraTokensPromises);

          // Use the transformed Clanker tokens directly
          const clankerTokens = clankerData.tokens.map((token) => ({
            name: token.name,
            address: token.address,
            symbol: token.symbol,
            marketCap: token.marketCap,
            volume24h: token.volume24h,
            priceUsd: token.priceUsd,
            holders: token.holders,
            platform: 'CLANKER' as const,
            risk: token.risk,
            imageUrl: token.imageUrl,
          }));

          const newTokens = [...zoraTokens, ...clankerTokens];

          // Update the cache with new data and timestamp
          tokenCache = {
            tokens: newTokens,
            timestamp: Date.now(),
          };

          setTokens(newTokens);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to fetch token data',
        );
        console.error('Error fetching token data:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchTokenData();

    // Check for cache expiration every minute
    const interval = setInterval(() => {
      if (!tokenCache || Date.now() - tokenCache.timestamp >= CACHE_DURATION) {
        fetchTokenData();
      }
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  return { tokens, loading, error };
}
