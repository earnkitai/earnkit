import { sql } from './db';

/**
 * v4.6 Task 2: a currency's USD rate for the UTC day, from Frankfurter (https://api.frankfurter.app/latest?from=<CUR>&to=USD),
 * cached per currency per day in fx_rates. USD is 1. Null when there is no rate (a failed or odd answer), and
 * nothing is cached then. The fetcher is injectable so tests never touch the network.
 */
export type FxFetcher = (url: string) => Promise<{ status: number; body: unknown }>;

export const fxFetch: FxFetcher = async (url) => {
  const r = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8_000) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

export async function usdRate(currency: string, now: Date, fetcher: FxFetcher = fxFetch): Promise<number | null> {
  const cur = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) return null;
  if (cur === 'USD') return 1;
  const day = now.toISOString().slice(0, 10);
  const [hit] = await sql()<{ usd: number }[]>`SELECT usd::float8 AS usd FROM fx_rates WHERE currency = ${cur} AND day = ${day}::date`;
  if (hit) return hit.usd;
  try {
    const r = await fetcher(`https://api.frankfurter.app/latest?from=${cur}&to=USD`);
    const rates = (r.body as { rates?: Record<string, unknown> } | null)?.rates;
    const usd = r.status === 200 ? rates?.USD : undefined;
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) return null;
    await sql()`INSERT INTO fx_rates (currency, day, usd) VALUES (${cur}, ${day}::date, ${usd}) ON CONFLICT DO NOTHING`;
    return usd;
  } catch (err) {
    console.error('[fx] rate', err instanceof Error ? err.name : 'error');
    return null;
  }
}
