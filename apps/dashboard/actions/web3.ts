'use server';

type CoinGeckoResponse = {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  // ... other fields omitted for brevity
}[];

export const extractCurrentPrice = async (
  response: CoinGeckoResponse,
): Promise<number> => {
  if (!response || response.length === 0) {
    return 0;
  }
  return response[0]?.current_price || 0;
};

export const getTokenPrice = async (token: string): Promise<number> => {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${token}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    });
    const data: CoinGeckoResponse = await response.json();
    return extractCurrentPrice(data);
  } catch (error) {
    console.error('Error fetching token price:', error);
    return 0;
  }
};
