/**
 * v2.7.1: a program's total prize pool (program file `pool_usd`), as its own source states it.
 * Pure and dependency-free, so the landing page, programs:check and tests share it.
 */

/** How the curated text states an amount: whether a "+" follows it, and whether it's in USDC. */
export type PoolStatement = { plus: boolean; usdc: boolean };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * "$1.3M", "$840K", "$10K", "$500": one decimal at most, rounded down so it never overstates.
 * Pure.
 */
export function usdCompact(n: number): string {
  return compact(n).text;
}

/** usdCompact, and whether rounding down dropped any value (then a total gets "+"). */
function compact(n: number): { text: string; exact: boolean } {
  const down = (x: number) => Math.floor(x * 10) / 10;
  const [v, unit, mult] = n >= 1_000_000 ? [down(n / 1_000_000), 'M', 1_000_000] : n >= 1_000 ? [down(n / 1_000), 'K', 1_000] : [Math.floor(n), '', 1];
  return { text: `$${v}${unit}`, exact: Math.round(v * mult) === n };
}

/** v2.7.1 review #1: a grant program (by its title): "per grant" and "in grants", never "per winner". */
export const isGrant = (title: string) => /grant/i.test(title);

/**
 * Where `text` (the program's `reward`) states the amount `n`: "$840,000", "$840K", "$200k" or
 * "10,000 USDC", with whether a "+" follows and the text after it. Null when it doesn't. Pure.
 */
export function amountStated(n: number, text: string): (PoolStatement & { after: string }) | null {
  const full = n.toLocaleString('en-US');
  const forms: { re: RegExp; usdc: boolean }[] = [
    { re: new RegExp(`${escape(full)}\\s*USDC\\b(\\+)?`), usdc: true },
    { re: new RegExp(`\\$${escape(full)}(?![\\d,])(\\+)?`), usdc: false },
    { re: new RegExp(`${escape(usdCompact(n))}(?![\\d.])(\\+)?`, 'i'), usdc: false },
  ];
  for (const f of forms) {
    const m = text.match(f.re);
    if (m) return { plus: m[1] === '+', usdc: f.usdc, after: text.slice((m.index ?? 0) + m[0].length) };
  }
  return null;
}

/** Review #10: words that make an amount a pool ("in prizes", "prize pool", "pool", "available", "total"). */
const POOL_WORDS = /^\s*(?:usd\s+)?(?:in prizes|prize pool|pool|available|total|in total)\b/i;

/**
 * Where `text` (the program's `reward`) states `pool` as a pool: the amount ("$840,000", "$840K",
 * "$200k", "10,000 USDC") followed by a pool word, so a per-winner amount ("up to $5,000 in
 * grants") never passes. Null when it doesn't, so programs:check refuses a pool the curated source
 * text doesn't back. Pure.
 */
export function poolStated(pool: number, text: string): PoolStatement | null {
  const a = amountStated(pool, text);
  return a && POOL_WORDS.test(a.after) ? { plus: a.plus, usdc: a.usdc } : null;
}

/**
 * A card's big line for a program with a pool: "10,000 USDC pool" when the source states it in
 * USDC, else "$840K in prizes" / "$250K+ in prizes", or "in grants" for a grant program. A "+"
 * also when the compact form rounded value away. Pure.
 */
export function poolLine(pool: number, s: PoolStatement, title: string): string {
  if (s.usdc) return `${pool.toLocaleString('en-US')} USDC pool${s.plus ? '+' : ''}`;
  const c = compact(pool);
  return `${c.text}${s.plus || !c.exact ? '+' : ''} in ${isGrant(title) ? 'grants' : 'prizes'}`;
}

/**
 * Review #1: a card's per-award line: "per grant" for a grant program, "per winner" otherwise.
 * "$5K–$100K per grant" with a stated minimum, "500 USDC per grant" when the reward states the
 * amount in USDC, else "up to $5,000 per grant" / "up to $30,000 per winner". Null without a
 * per-winner amount. Pure.
 */
export function eachLine(p: {
  title: string;
  reward: string;
  max_award_usd: number | null;
  min_award_usd: number | null;
  investment?: boolean;
}): string | null {
  const max = p.max_award_usd;
  if (!max) return null;
  // v2.8 Ruling C5: an investment program reads "up to $1M investment", never "per winner".
  if (p.investment) return `up to ${usdCompact(max)} investment`;
  const unit = isGrant(p.title) ? 'grant' : 'winner';
  if (p.min_award_usd && p.min_award_usd < max) return `${usdCompact(p.min_award_usd)}–${usdCompact(max)} per ${unit}`;
  if (amountStated(max, p.reward)?.usdc) return `${max.toLocaleString('en-US')} USDC per ${unit}`;
  return `up to $${max.toLocaleString('en-US')} per ${unit}`;
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

/** A compact total ("$840K+"), or null at 0; moneyText's formatter. Pure. */
export function poolTotalText(pools: { pool_usd: number | null; plus: boolean }[]): string | null {
  const t = poolTotal(pools);
  if (t.usd <= 0) return null;
  const c = compact(t.usd);
  // Review #11: "+" also when rounding down dropped value ($1,050,000 shows "$1M+").
  return `${c.text}${t.plus || !c.exact ? '+' : ''}`;
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

/** v2.9 F21: one program as the money figure reads it: a DB row (`campaign`, `source`) or a card (`earnkit_campaign`, `sponsored`). */
export type OpenMoneyRow = {
  max_award_usd?: number | null;
  /** v3 Stage 2: an accelerator's investment is never counted as money open (openMoneyWords names it). */
  investment?: boolean | null;
  /** v3 Stage 2: a pool with no per-winner amount (a hackathon) is named, not counted. */
  pool_usd?: number | null;
  status?: string;
  campaign?: unknown;
  earnkit_campaign?: unknown;
  sponsored?: boolean;
  source?: string;
  starts_at?: Date | null;
  ends_at?: Date | null;
};

/**
 * v2.9 F21: the one money figure: the top prize of every open curated program, summed. Never an
 * EarnKit campaign (P19: `campaign` on a row, `earnkit_campaign` on a card) or a sponsor's. Open:
 * active, started, not ended. The landing page, /programs, the first reply and /api/stats all
 * call it (stats.ts re-exports it; it lives here because present.ts can't import stats.ts).
 * v3 Stage 2 (the honest total): never an investment (an accelerator), so the figure is grants and
 * prizes only; openMoneyWords names what it leaves out. Pure.
 */
export function openMoneyUsd(programs: OpenMoneyRow[], now = new Date()): number {
  return programs.filter((p) => openCurated(p, now) && !p.investment).reduce((sum, p) => sum + Number(p.max_award_usd ?? 0), 0);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/**
 * v3 Stage 2: what the money total leaves out, in words: the open curated accelerators (investment)
 * and hackathons (a pool with no per-winner amount). "Plus 2 accelerators and 1 hackathon.", or
 * null when there are none. Pure.
 */
export function openMoneyWords(programs: OpenMoneyRow[], now = new Date()): string | null {
  const open = programs.filter((p) => openCurated(p, now));
  const acc = open.filter((p) => p.investment).length;
  const hack = open.filter((p) => !p.investment && p.pool_usd && !p.max_award_usd).length;
  const parts = [...(acc ? [plural(acc, 'accelerator', 'accelerators')] : []), ...(hack ? [plural(hack, 'hackathon', 'hackathons')] : [])];
  return parts.length ? `Plus ${parts.join(' and ')}.` : null;
}

/**
 * v3 Stage 2: the landing's and /api/stats' money line, "$115K in grants and prizes open" (moneyText's
 * figure; "$0 in grants and prizes open" at 0). The caller hides it when nothing is open. Pure.
 */
export const openGrantsText = (usd: number): string => `${moneyText(usd) ?? '$0'} in grants and prizes open`;

/**
 * v2.9 F21: the programs openMoneyUsd sums: open (active, started, not ended) and curated (never an
 * EarnKit campaign or a sponsor's). v2.11 T7 (Ruling S1): the context line counts these, so its money
 * and its count always agree. Pure.
 */
export const openCurated = (p: OpenMoneyRow, now: Date): boolean =>
  (p.status ?? 'active') === 'active' &&
  !p.campaign &&
  !p.earnkit_campaign &&
  !p.sponsored &&
  p.source !== 'sponsor' &&
  (!p.starts_at || p.starts_at <= now) &&
  (!p.ends_at || now < p.ends_at);

/** v2.9 F21 (P18): the figure as text, "$1.1M+": rounded down, "+" when rounding dropped value; null at 0. Pure. */
export const moneyText = (usd: number): string | null => poolTotalText([{ pool_usd: usd, plus: false }]);

/**
 * v2.9 E20: "Builders using EarnKit won $X" (landing page, first reply), only once an announced
 * win with a known prize exists (stats.ts builders_won_usd); absent (null), never "$0", before that. Pure.
 */
export const wonLine = (usd: number) => (usd > 0 ? `Builders using EarnKit won $${usd.toLocaleString('en-US')}` : null);
