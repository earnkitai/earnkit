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
export function cleanTokenName(name: string): { name: string } | { problem: string } {
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
  // v2.7 §4 fix round 1 (Minor): CLANKER is reserved like any other brand ticker, but never echoed
  // back (Ruling 18 (plan): no builder- or agent-facing text names Clanker) — checked before the
  // shape rule below, since at 7 letters it would otherwise always fail that generic check first,
  // leaving this reservation unreachable (as EARNKIT, COINBASE and ROBINHOOD still are below).
  if (symbol === 'CLANKER') return 'symbol: that ticker is reserved; pick another.';
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

/** EarnKit's proposed token: always a name and a ticker (v2.7 Ruling 16 (plan)). */
export type Proposal = { name: string; symbol: string; note?: string };

/** "tip jar" from a GitHub repo link (dashes, underscores and dots as spaces), or null. Pure. */
export function repoNameOf(repoUrl: string | undefined): string | null {
  const m = repoUrl ? /^https:\/\/github\.com\/[^/]+\/([^/?#]+)/i.exec(repoUrl.trim()) : null;
  const name = m ? m[1].replace(/\.git$/i, '').replace(/[-_.]+/g, ' ').trim() : '';
  return name || null;
}

/** The first letters of the name's words (else its first 3 letters, padded with X), then 2-9 variants. Pure. */
export function initialsCandidates(name: string): string[] {
  const words = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (words.length === 0) return [];
  const initials = words.map((w) => w[0]).join('');
  const base = (initials.length >= 3 ? initials : words.join('').slice(0, 3).padEnd(3, 'X')).slice(0, 6);
  return [base, ...[2, 3, 4, 5, 6, 7, 8, 9].map((d) => `${base.slice(0, 5)}${d}`)];
}

/** "Tip Jar" from "tip jar": each word's first letter capitalised (a repo name used as a token name). Pure. */
export const titleCase = (s: string) => s.replace(/(^|\s)(\p{Ll})/gu, (_, sp: string, c: string) => sp + c.toUpperCase());

/** The last-resort tickers: always pass tickerProblem, so a proposal always has one. */
const LAST_RESORT = ['ENTRY', ...[2, 3, 4, 5, 6, 7, 8, 9].map((d) => `ENTRY${d}`)];
/**
 * C6: past the checked list, never-checked tickers (ENTR10…ENTR99), so a ticker found taken is
 * never proposed.
 */
const OVERFLOW = Array.from({ length: 90 }, (_, i) => `ENTR${i + 10}`);
/** At most this many tokens.fun ticker checks per proposal (Ruling 16). */
const MAX_CHECKS = 12;
const UNCHECKED = 'ticker not checked for duplicates';

/**
 * EarnKit's proposed token (v2.3 §2 + v2.7 Ruling 16 (plan)); never null. The name: the project
 * name, "<name> Token", the repo name, then "<TICKER> Token". The ticker groups: v2.3's candidates
 * from the project name, then the repo name, then initials, then ENTRY…; every group's unnumbered
 * candidates are checked before any numbered variant (TIPJA2). At most 12 checks; then the next candidate,
 * never checked, with a note. A ticker found taken is never proposed (C6).
 */
export async function proposeToken(
  projectName: string,
  check: TickerCheck = tokensFunTickerCheck,
  repoUrl?: string,
): Promise<Proposal> {
  const trimmed = projectName.trim().slice(0, 50);
  const repo = repoNameOf(repoUrl);
  // The name first (v2.8.1 §A2): the project name, "<name> Token", the repo name, then the name with
  // its brand words dropped ("ArcPay" → "Pay Token"); "<TICKER> Token" only when none of them pass.
  const readable = nameCandidates(trimmed, repo)
    .map((n) => cleanTokenName(n))
    .find((r): r is { name: string } => 'name' in r)?.name;
  // A fallback name leads the tickers too ("Pay Token" → $PAY, never $ARCPA2).
  const lead = readable && readable !== trimmed ? [tickerCandidates(readable), initialsCandidates(readable)] : [];
  const groups = [
    ...lead,
    tickerCandidates(trimmed),
    repo ? tickerCandidates(repo) : [],
    initialsCandidates(trimmed),
    repo ? initialsCandidates(repo) : [],
    LAST_RESORT,
  ].map((g) => g.filter((c) => !tickerProblem(c)));
  // A numbered variant is an earlier candidate's first five letters plus a digit (TIPJA2 of TIPJAR).
  const variant = (g: string[], c: string, i: number) =>
    g.slice(0, i).some((b) => /^\d$/.test(c.slice(-1)) && c.slice(0, -1) === b.slice(0, 5));
  const bases = groups.flatMap((g) => g.filter((c, i) => !variant(g, c, i)));
  const candidates = [...new Set([...bases, ...groups.flat(), ...OVERFLOW])];
  let symbol = candidates[MAX_CHECKS];
  let note: string | undefined = UNCHECKED;
  // v2.8.1 §A5: checked in parallel batches (each check waits up to 3 s), first free in order wins.
  checking: for (let i = 0; i < MAX_CHECKS; i += CHECK_BATCH) {
    const batch = candidates.slice(i, Math.min(i + CHECK_BATCH, MAX_CHECKS));
    const answers = await Promise.all(batch.map((c) => check(c)));
    for (const [j, free] of answers.entries()) {
      if (free === false) continue;
      symbol = batch[j];
      note = free === null ? UNCHECKED : undefined;
      break checking;
    }
  }
  // "<TICKER> Token" always passes cleanTokenName (the ticker passed tickerProblem).
  return { name: readable ?? `${symbol} Token`, symbol, ...(note && { note }) };
}

/** Candidates checked together (v2.8.1 §A5): at most 3 rounds of tokens.fun's 3 s check. */
const CHECK_BATCH = 4;

/**
 * v2.8.1 §A2: the readable token names to try, in order: the project name, "<name> Token", the repo
 * name, then the project and repo names without their brand words (unbranded; a one-word rest
 * shorter than 4 letters gets " Token"). Pure; exported for tests.
 */
export function nameCandidates(projectName: string, repo: string | null): string[] {
  const repoTitle = repo ? titleCase(repo) : '';
  const rest = (n: string) => {
    const u = unbranded(n);
    return u ? (u.length < 4 ? [`${u} Token`] : [u, `${u} Token`]) : [];
  };
  return [
    projectName,
    projectName ? `${projectName.slice(0, 44)} Token` : '',
    repoTitle,
    ...rest(projectName),
    ...(repoTitle ? rest(repoTitle) : []),
  ].filter((n) => n.trim());
}

/**
 * "Pay" from "ArcPay" or "Arc Pay": the name's words (camel case split too) without the ones that
 * read as a brand on their own; null when no word is a brand, or every word is. Pure; exported for tests.
 */
export function unbranded(name: string): string | null {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_-]+/).filter(Boolean);
  const kept = words.filter((w) => reservedBrands(w).length === 0);
  return kept.length === words.length || kept.length === 0 ? null : kept.join(' ');
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
