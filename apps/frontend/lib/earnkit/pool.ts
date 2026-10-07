/**
 * v2.7.1: a program's total prize pool (program file `pool_usd`), as its own source states it.
 * Pure and dependency-free, so the landing page, programs:check and tests share it.
 */

/** How the curated text states the pool: whether a "+" follows it, and whether it's in USDC. */
export type PoolStatement = { plus: boolean; usdc: boolean };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * "$1.3M", "$840K", "$10K", "$500": one decimal at most, rounded down so it never overstates.
 * Pure.
 */
export function usdCompact(n: number): string {
  const down = (x: number) => (Math.floor(x * 10) / 10).toString();
  if (n >= 1_000_000) return `$${down(n / 1_000_000)}M`;
  if (n >= 1_000) return `$${down(n / 1_000)}K`;
  return `$${Math.floor(n)}`;
}

/**
 * Where `text` (the program's `reward`) states `pool`: "$840,000", "$840K",
 * "$200k" or "10,000 USDC". Null when it doesn't, so programs:check refuses a pool the curated
 * source text doesn't back. Pure.
 */
export function poolStated(pool: number, text: string): PoolStatement | null {
  const full = pool.toLocaleString('en-US');
  const forms: { re: RegExp; usdc: boolean }[] = [
    { re: new RegExp(`${escape(full)}\\s*USDC\\b(\\+)?`), usdc: true },
    { re: new RegExp(`\\$${escape(full)}(?![\\d,])(\\+)?`), usdc: false },
    { re: new RegExp(`${escape(usdCompact(pool))}(?![\\d.])(\\+)?`, 'i'), usdc: false },
  ];
  for (const f of forms) {
    const m = text.match(f.re);
    if (m) return { plus: m[1] === '+', usdc: f.usdc };
  }
  return null;
}

/**
 * A card's big line for a program with a pool: "10,000 USDC pool" when the source states it in
 * USDC, else "$840K in prizes" / "$250K+ in prizes", or "in grants" for a grant program. Pure.
 */
export function poolLine(pool: number, s: PoolStatement, title: string): string {
  if (s.usdc) return `${pool.toLocaleString('en-US')} USDC pool${s.plus ? '+' : ''}`;
  return `${usdCompact(pool)}${s.plus ? '+' : ''} in ${/grant/i.test(title) ? 'grants' : 'prizes'}`;
}

/**
 * The pool total behind the hero's figure: the sum of the shown programs' pools, and "+" when any
 * of them has no pool or its source says "+". Shared with /api/stats (open_pools_usd/_plus). Pure.
 */
export function poolTotal(pools: { pool_usd: number | null; plus: boolean }[]): { usd: number; plus: boolean } {
  return {
    usd: pools.reduce((a, p) => a + (p.pool_usd ?? 0), 0),
    plus: pools.some((p) => p.pool_usd === null || p.plus),
  };
}

/** The hero's figure ("$1.3M+"), or null when no program states a pool. Pure. */
export function poolTotalText(pools: { pool_usd: number | null; plus: boolean }[]): string | null {
  const t = poolTotal(pools);
  return t.usd > 0 ? `${usdCompact(t.usd)}${t.plus ? '+' : ''}` : null;
}

/**
 * One program's pool as the total counts it, from the DB row: the pool only when its reward text
 * states it (programs:check enforces that; a row that slipped past counts as none). Pure.
 */
export function statedPool(pool_usd: string | number | null, reward: string): { pool_usd: number | null; plus: boolean } {
  const n = pool_usd == null ? null : Number(pool_usd);
  const s = n ? poolStated(n, reward) : null;
  return s ? { pool_usd: n, plus: s.plus } : { pool_usd: null, plus: false };
}
