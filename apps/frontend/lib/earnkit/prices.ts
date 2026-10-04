/** A fetch as llamaPrice uses it; injectable for tests. */
export type PriceFetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetch: PriceFetch = (url) =>
  fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'earnkit' },
    signal: AbortSignal.timeout(10_000),
  });

/**
 * The current USD price of `coin` ("<chain>:<address>", e.g. "base:0x534b…") from DefiLlama's free
 * price API (no key; v2.4 cost rule). Throws when DefiLlama has no positive price for it.
 */
export async function llamaPrice(coin: string, fetchImpl: PriceFetch = defaultFetch) {
  const res = await fetchImpl(`https://coins.llama.fi/prices/current/${coin}`);
  if (!res.ok) throw new Error(`DefiLlama answered ${res.status} for ${coin}`);
  const body = (await res.json()) as {
    coins?: Record<string, { price?: number; timestamp?: number }>;
  };
  const hit = Object.entries(body.coins ?? {}).find(
    ([k]) => k.toLowerCase() === coin.toLowerCase(),
  )?.[1];
  if (!hit || typeof hit.price !== 'number' || !(hit.price > 0))
    throw new Error(`DefiLlama has no price for ${coin}`);
  return { price: hit.price, at: new Date((hit.timestamp ?? Date.now() / 1000) * 1000) };
}
