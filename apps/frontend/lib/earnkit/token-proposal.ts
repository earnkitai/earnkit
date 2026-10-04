import { mixedScriptProblem, plainLettersProblem, reservedBrands } from './sponsor-identity';
import { UntrustedTextError, cleanText } from './untrusted-text';

/**
 * EarnKit's proposed token for an entry (v2.3 §2): a name and ticker derived from the project
 * name, refused when either reads as a brand's own, and a deterministic monogram logo when no
 * image is uploaded.
 */

const TOKENSFUN_URL = (process.env.TOKENSFUN_API_URL ?? 'https://tokens.fun').replace(/\/$/, '');

/** Tickers that read as a brand's or a major asset's own (v2.3 §2). */
export const TICKER_RESERVED = [
  'BASE', 'CBBTC', 'CBETH', 'USDC', 'USDT', 'EURC', 'ETH', 'WETH', 'BTC', 'WBTC',
  'MINI', 'EARN', 'EARNKIT', 'COIN', 'COINBASE', 'CB', 'ARC', 'MONAD', 'MON',
  'HOOD', 'ROBINHOOD', 'TEMPO', 'CIRCLE', 'CLANKER', 'TOKENS',
] as const;

/**
 * Cleans a proposed token name (the single-line text rules, at most 50 characters) and runs the
 * same impersonation rules a sponsor name gets (v2.3 §2): a reserved brand, mixed scripts inside
 * a word, or special letter forms. Returns the cleaned, normalized name on success, so callers
 * never echo back the raw, un-normalized input. Pure; shared by `tokenNameProblem` and
 * `proposeToken`.
 */
function cleanTokenName(name: string): { name: string } | { problem: string } {
  let clean: string;
  try {
    clean = cleanText(name, { max: 50, singleLine: true, field: 'name' });
  } catch (err) {
    if (err instanceof UntrustedTextError) return { problem: err.message };
    throw err;
  }
  if (clean.length === 0)
    return { problem: 'name: only unsupported characters; use plain words.' };
  if (reservedBrands(clean).length > 0)
    return { problem: `name: "${clean}" uses a brand's name; tokens are public and permanent, so pick another name.` };
  // mixedScriptProblem/plainLettersProblem only know the sponsor_name/title fields; their message
  // already names the field, so it's rewritten to say "name" instead.
  const mixed = mixedScriptProblem(clean, 'sponsor_name');
  if (mixed) return { problem: mixed.replace(/^sponsor_name:/, 'name:') };
  const plain = plainLettersProblem(clean, 'sponsor_name');
  if (plain) return { problem: plain.replace(/^sponsor_name:/, 'name:') };
  return { name: clean };
}

/** Why `name` can't be a token name, or null. Pure; exported for tests. */
export function tokenNameProblem(name: string): string | null {
  const r = cleanTokenName(name);
  return 'problem' in r ? r.problem : null;
}

/** Why `symbol` can't be a ticker, or null. Pure; exported for tests. */
export function tickerProblem(symbol: string): string | null {
  if (!/^[A-Z0-9]{3,6}$/.test(symbol)) return 'symbol: 3 to 6 capital letters or digits.';
  if ((TICKER_RESERVED as readonly string[]).includes(symbol) || reservedBrands(symbol).length > 0)
    return `symbol: ${symbol} reads as a brand's or a major asset's ticker; pick another.`;
  return null;
}

/** Ticker candidates in order (v2.3 §2). Pure; exported for tests. */
export function tickerCandidates(name: string): string[] {
  const words = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: string[] = [];
  if (words.length >= 3) out.push(words.map((w) => w[0]).join('').slice(0, 6));
  const first = words[0].length >= 3 ? words[0] : words.join('');
  if (first.length >= 3) {
    out.push(first.slice(0, 6));
    for (let d = 2; d <= 9; d++) out.push(`${first.slice(0, 5)}${d}`);
  }
  return [...new Set(out)].filter((c) => /^[A-Z0-9]{3,6}$/.test(c));
}

export type TickerCheck = (symbol: string) => Promise<boolean | null>;

/** tokens.fun's check-ticker; null when it can't be asked (no key, timeout, error). */
export const tokensFunTickerCheck: TickerCheck = async (symbol) => {
  const key = process.env.TOKENSFUN_DEPLOY_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${TOKENSFUN_URL}/api/check-ticker?symbol=${encodeURIComponent(symbol)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { available?: unknown };
    return typeof body.available === 'boolean' ? body.available : null;
  } catch {
    return null;
  }
};

export type Proposal =
  | { name: string; symbol: string; note?: string }
  | { name: null; symbol: null; reason: string };

/** EarnKit's proposed token for a project (v2.3 §2). */
export async function proposeToken(projectName: string, check: TickerCheck = tokensFunTickerCheck): Promise<Proposal> {
  const trimmed = projectName.trim().slice(0, 50);
  const primary = cleanTokenName(trimmed);
  const fallback = 'name' in primary ? null : cleanTokenName(`${trimmed.slice(0, 44)} Token`);
  const name = 'name' in primary ? primary.name : fallback && 'name' in fallback ? fallback.name : null;
  const candidates = tickerCandidates(projectName).filter((c) => !tickerProblem(c));
  if (!name || candidates.length === 0)
    return { name: null, symbol: null, reason: "EarnKit couldn't propose a token for this name: pick a name and ticker with the builder." };
  for (const c of candidates) {
    const free = await check(c);
    if (free === null) return { name, symbol: c, note: 'ticker not checked for duplicates' };
    if (free) return { name, symbol: c };
  }
  return { name: null, symbol: null, reason: 'Every proposed ticker is taken: pick a name and ticker with the builder.' };
}

/** 12 colours with enough contrast for white letters. */
export const MONOGRAM_PALETTE = [
  '#1D4ED8', '#7C3AED', '#BE185D', '#B91C1C', '#C2410C', '#A16207',
  '#15803D', '#0F766E', '#0E7490', '#4338CA', '#6D28D9', '#334155',
] as const;

/** The monogram's letters and colour for a project: deterministic. Pure; exported for tests. */
export function monogramFor(projectId: number, symbol: string) {
  return {
    letters: symbol.slice(0, 3),
    background: MONOGRAM_PALETTE[Math.abs(projectId) % MONOGRAM_PALETTE.length],
  };
}
