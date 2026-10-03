import { mixedScriptWords, skeleton } from './confusables';
import { quoted } from './untrusted-text';

/**
 * Who a sponsor is, as far as EarnKit can vouch (v2.2 §3). Pure: labels, the earnkit.txt check,
 * reserved brand names and the track record text. The fetch and its cache are in
 * sponsor-verify.ts.
 */

/** A sponsor's identity: verified only when `host` serves an earnkit.txt naming their wallet. */
export type SponsorIdentity = { verified: boolean; host: string | null };

export const UNVERIFIED: SponsorIdentity = { verified: false, host: null };

/** The fixed label every sponsor campaign carries, wherever it is shown. */
export const sponsorLabel = (id: SponsorIdentity) =>
  id.verified && id.host
    ? `Sponsored · verified ${id.host}`
    : 'Sponsored · unverified';

/** The host of a sponsor_url (already https and a plain domain, see SponsorUrl), lowercase. */
export function sponsorHost(url: string | null | undefined) {
  if (!url || !URL.canParse(url)) return null;
  const u = new URL(url);
  // A port or a trailing dot would split the cache and the label from the plain host (review m5).
  return u.protocol === 'https:' && u.port === ''
    ? u.hostname.toLowerCase().replace(/\.$/, '')
    : null;
}

/** Where the proof lives. */
export const earnkitTxtUrl = (host: string) =>
  `https://${host}/.well-known/earnkit.txt`;

/** The line a sponsor publishes. */
export const earnkitTxtLine = (wallet: string) => `earnkit-sponsor: ${wallet}`;

/**
 * Whether an earnkit.txt names `wallet`: some line is `earnkit-sponsor: <address>` (key and
 * address case-insensitive, surrounding spaces ignored). Other lines are ignored, so one file can
 * list several wallets. Pure; exported for tests.
 */
export function earnkitTxtNames(body: string, wallet: string) {
  const want = wallet.toLowerCase();
  return body
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .some((line) => {
      const m = /^\s*earnkit-sponsor\s*:\s*(0x[0-9a-f]{40})\s*$/i.exec(line);
      return m !== null && m[1].toLowerCase() === want;
    });
}

/** Reserved brands and the only domains that may use them. */
export const RESERVED_BRANDS = {
  earnkit: { name: 'EarnKit', domains: ['earnkit.com', 'www.earnkit.com'] },
  base: {
    name: 'Base',
    domains: ['base.org', 'base.dev', 'www.base.org', 'www.base.dev'],
  },
  coinbase: { name: 'Coinbase', domains: ['coinbase.com', 'www.coinbase.com'] },
  circle: { name: 'Circle', domains: ['circle.com', 'www.circle.com'] },
  usdc: { name: 'USDC', domains: ['circle.com', 'www.circle.com'] },
  arc: { name: 'Arc', domains: ['arc.network', 'www.arc.network'] },
  tempo: { name: 'Tempo', domains: ['tempo.xyz', 'www.tempo.xyz'] },
  monad: { name: 'Monad', domains: ['monad.xyz', 'www.monad.xyz'] },
  robinhood: {
    name: 'Robinhood',
    domains: ['robinhood.com', 'www.robinhood.com'],
  },
  tokensfun: { name: 'tokens.fun', domains: ['tokens.fun', 'www.tokens.fun'] },
} as const;
export type Brand = keyof typeof RESERVED_BRANDS;
const BRANDS = Object.keys(RESERVED_BRANDS) as Brand[];

const SKELETONS = new Map(BRANDS.map((b) => [skeleton(b), b]));
const LONGEST = Math.max(...[...SKELETONS.keys()].map((k) => k.length));

/**
 * The name as words for matching: its confusable skeleton (confusables.ts: NFKD, marks dropped,
 * look-alikes from other scripts mapped to Latin, lowercased), split on anything but letters and
 * digits. Pure; exported for tests.
 */
export const nameWords = (name: string) =>
  skeleton(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * The reserved brands a sponsor name uses: a whole word ("Base Builders"), or consecutive words
 * that join into one ("tokens.fun" -> tokens fun, "Coin Base", "B.A.S.E", "E A R N K I T"). A
 * brand inside a longer word ("Basecamp", "Arcade") is not a match. Pure; exported for tests.
 */
export function reservedBrands(name: string): Brand[] {
  const words = nameWords(name);
  const found = new Set<Brand>();
  for (let i = 0; i < words.length; i++) {
    let joined = '';
    for (let j = i; j < words.length; j++) {
      joined += words[j];
      // "rn" may only meet across a word break ("Ear nkit"), so it is folded again here.
      if (joined.length > LONGEST * 2) break;
      const brand = SKELETONS.get(joined.replace(/rn/g, 'm'));
      if (brand) found.add(brand);
    }
  }
  return BRANDS.filter((b) => found.has(b));
}

/**
 * Why `name` can't be used, or null: it uses a reserved brand and the sponsor isn't verified on
 * that brand's own domain. Checked on the sponsor name and the title. Pure; exported for tests.
 */
export function reservedNameProblem(
  name: string,
  verifiedHost: string | null,
  field: 'sponsor_name' | 'title' = 'sponsor_name',
): string | null {
  for (const b of reservedBrands(name)) {
    const { name: brand, domains } = RESERVED_BRANDS[b];
    if (verifiedHost && (domains as readonly string[]).includes(verifiedHost))
      continue;
    const domain = domains[0];
    const apex = domains.filter((d) => !d.startsWith('www.'));
    return (
      `${field}: ${quoted(name)} uses the reserved name ${brand}. Only a sponsor verified on ` +
      `${apex.join(' or ')} can use it (sponsor_url https://${domain}, with ` +
      `"earnkit-sponsor: <sponsor_wallet>" at ${earnkitTxtUrl(domain)}). Otherwise choose another ${field === 'title' ? 'title (the chains field already says where to build)' : 'name'}: ` +
      'names are matched as whole words after normalizing look-alike letters, and words that join ' +
      'into a brand count too (e.g. "Coin Base").'
    );
  }
  return null;
}

/** Only campaigns with at least this pool (USDC) count toward a track record. */
export const TRACK_RECORD_MIN_POOL_USDC = 100;

/**
 * A sponsor wallet's funded campaigns of at least 100 USDC (drafts never count: anyone can bind a
 * wallet to one; dust campaigns don't either). `awarded` counts only awards the sponsor made
 * that paid nobody at the sponsor's own wallet; operator-fallback payouts are counted apart.
 */
export type TrackRecord = {
  funded: number;
  live: number;
  awarded: number;
  /** Paid out by EarnKit's operator fallback because the sponsor didn't award. */
  fallback: number;
  /** Awarded by the sponsor, but some prize went to the sponsor's own wallet. */
  self_awarded: number;
  refunded: number;
  taken_down: number;
};

/** One sponsor_campaigns row, as trackRecordOf needs it. */
export type TrackRow = {
  state: string;
  amount: string;
  token_symbol: string;
  /** 'sponsor' | 'fallback' | 'off_plan' (a direct award: only the sponsor can); null on rows from before it was recorded. */
  award_source: string | null;
  fallback_plan: unknown | null;
  /** Every wallet the award paid (lowercase). */
  winners: string[];
};

/** Rows of one sponsor wallet -> its track record. Pure; exported for tests. */
export function trackRecordOf(rows: TrackRow[], wallet: string | null) {
  const t: TrackRecord = {
    funded: 0,
    live: 0,
    awarded: 0,
    fallback: 0,
    self_awarded: 0,
    refunded: 0,
    taken_down: 0,
  };
  const self = wallet?.toLowerCase();
  for (const r of rows) {
    if (
      r.token_symbol !== 'USDC' ||
      !(Number(r.amount) >= TRACK_RECORD_MIN_POOL_USDC)
    )
      continue;
    if (r.state === 'live') t.live++;
    else if (r.state === 'refunded') t.refunded++;
    else if (r.state === 'taken_down') t.taken_down++;
    else if (r.state === 'awarded') {
      const source =
        r.award_source ?? (r.fallback_plan ? 'fallback' : 'sponsor');
      if (source === 'fallback') t.fallback++;
      else if (self && r.winners.some((w) => w.toLowerCase() === self))
        t.self_awarded++;
      else t.awarded++;
    } else continue;
    t.funded++;
  }
  return t;
}

/** One line for builders. Pure; exported for tests. */
export function trackRecordText(t: TrackRecord) {
  const past =
    t.awarded + t.fallback + t.self_awarded + t.refunded + t.taken_down;
  if (t.funded <= 1 && past === 0)
    return `This sponsor wallet has no earlier funded campaigns of ${TRACK_RECORD_MIN_POOL_USDC} USDC or more on EarnKit.`;
  const parts = [
    `${t.awarded} awarded by the sponsor`,
    `${t.fallback} paid by EarnKit's fallback`,
    `${t.refunded} refunded with no winners`,
    `${t.taken_down} taken down by EarnKit`,
    ...(t.self_awarded > 0
      ? [`${t.self_awarded} paid to the sponsor's own wallet`]
      : []),
    ...(t.live > 0 ? [`${t.live} live`] : []),
  ];
  return `This sponsor wallet has funded ${t.funded} campaign${t.funded === 1 ? '' : 's'} of ${TRACK_RECORD_MIN_POOL_USDC} USDC or more on EarnKit: ${parts.join(', ')}.`;
}

/**
 * Why a sponsor name mixes scripts inside a word (Latin with Cyrillic, Greek or another
 * look-alike script), or null. Pure; exported for tests.
 */
export function mixedScriptProblem(name: string): string | null {
  const words = mixedScriptWords(name);
  return words.length === 0
    ? null
    : `sponsor_name: ${quoted(name)} mixes Latin letters with look-alike letters from another script in one word. Write each word in one script.`;
}
