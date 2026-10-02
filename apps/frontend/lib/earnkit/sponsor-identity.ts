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
  return u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
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
  earnkit: { name: 'EarnKit', domains: ['earnkit.com'] },
  base: { name: 'Base', domains: ['base.org', 'base.dev'] },
  coinbase: { name: 'Coinbase', domains: ['coinbase.com'] },
  circle: { name: 'Circle', domains: ['circle.com'] },
  usdc: { name: 'USDC', domains: ['circle.com'] },
  arc: { name: 'Arc', domains: ['arc.network'] },
  tempo: { name: 'Tempo', domains: ['tempo.xyz'] },
  monad: { name: 'Monad', domains: ['monad.xyz'] },
  robinhood: { name: 'Robinhood', domains: ['robinhood.com'] },
  tokensfun: { name: 'tokens.fun', domains: ['tokens.fun'] },
} as const;
export type Brand = keyof typeof RESERVED_BRANDS;
const BRANDS = Object.keys(RESERVED_BRANDS) as Brand[];
const LONGEST = Math.max(...BRANDS.map((b) => b.length));

// Latin look-alikes NFKC leaves alone (Cyrillic and Greek), mapped before lowercasing so an
// uppercase Greek Nu (N) and a lowercase nu (v) map differently.
const SKELETON = Object.fromEntries(
  [
    'АA ВB ЕE КK МM НH ОO РP СC ТT ХX УY ЅS ІI ЈJ ӀI аa еe оo рp сc уy хx',
    'ѕs іi јj ԁd һh ӏl ԛq ԝw ΑA ΒB ΕE ΖZ ΗH ΙI ΚK ΜM ΝN ΟO ΡP ΤT ΥY ΧX αa',
    'εe ιi κk νv οo ρp τt υu χx ϲc ıi',
  ]
    .join(' ')
    .split(' ')
    .map((pair) => [pair[0], pair[1]]),
);

/**
 * The name as words for matching: NFKC (fullwidth and styled letters become plain), Cyrillic/Greek
 * look-alikes mapped to Latin, accents dropped, lowercased, split on anything but letters and
 * digits. Pure; exported for tests.
 */
export const nameWords = (name: string) =>
  [...name.normalize('NFKC')]
    .map((c) => SKELETON[c] ?? c)
    .join('')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
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
      if (joined.length > LONGEST) break;
      if ((BRANDS as string[]).includes(joined)) found.add(joined as Brand);
    }
  }
  return BRANDS.filter((b) => found.has(b));
}

/**
 * Why `name` can't be used, or null: it uses a reserved brand and the sponsor isn't verified on
 * that brand's own domain. Pure; exported for tests.
 */
export function reservedNameProblem(
  name: string,
  verifiedHost: string | null,
): string | null {
  for (const b of reservedBrands(name)) {
    const { name: brand, domains } = RESERVED_BRANDS[b];
    if (verifiedHost && (domains as readonly string[]).includes(verifiedHost))
      continue;
    const domain = domains[0];
    return (
      `sponsor_name: ${quoted(name)} uses the reserved name ${brand}. Only a sponsor verified on ` +
      `${domains.join(' or ')} can use it (sponsor_url https://${domain}, with ` +
      `"earnkit-sponsor: <sponsor_wallet>" at ${earnkitTxtUrl(domain)}). Otherwise choose another name.`
    );
  }
  return null;
}

/** A sponsor wallet's campaigns that reached the chain (drafts never count: anyone can bind a wallet). */
export type TrackRecord = {
  funded: number;
  live: number;
  awarded: number;
  refunded: number;
  taken_down: number;
};

/** Counts by sponsor_campaigns.state -> the track record. Pure; exported for tests. */
export function trackRecordOf(rows: { state: string; n: number }[]) {
  const n = (s: string) => rows.find((r) => r.state === s)?.n ?? 0;
  const t = {
    live: n('live'),
    awarded: n('awarded'),
    refunded: n('refunded'),
    taken_down: n('taken_down'),
  };
  return {
    funded: t.live + t.awarded + t.refunded + t.taken_down,
    ...t,
  } satisfies TrackRecord;
}

/** One line for builders. Pure; exported for tests. */
export function trackRecordText(t: TrackRecord) {
  if (t.funded <= 1 && t.awarded + t.refunded + t.taken_down === 0)
    return "This is the sponsor wallet's first funded campaign on EarnKit.";
  const parts = [
    `${t.awarded} awarded`,
    `${t.refunded} refunded with no winners`,
    `${t.taken_down} taken down by EarnKit`,
    ...(t.live > 0 ? [`${t.live} live`] : []),
  ];
  return `This sponsor wallet has funded ${t.funded} campaign${t.funded === 1 ? '' : 's'} on EarnKit: ${parts.join(', ')}.`;
}
