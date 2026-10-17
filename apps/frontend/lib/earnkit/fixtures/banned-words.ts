/** v2.12.1 copy rule: words never in builder or public text unless the builder used them first. */
export const BANNED_WORDS: RegExp[] = [
  /\boutcomes?\b/i, /\bpercentiles?\b/i, /verified sources?/i, /\bcontracts?\b/i, /wallet address/i, /builder codes?/i,
  /\brepos?\b/i, /\brepositor(y|ies)\b/i, /\bcommits?\b/i, /\bonchain\b/i, /\bon-chain\b/i,
  /\b(Base|Arc|Monad|Tempo|Ethereum|Robinhood Chain)\b/, /—/, /\b[A-Z]{3,}\b(?<!\bUSDC\b)/, /\p{Extended_Pictographic}/u,
];
/** The banned words in `text` once the builder's own names and program titles (`exempt`) are taken out. */
export function bannedIn(text: string, exempt: string[]): string[] {
  let t = text;
  for (const e of exempt) t = t.split(e).join(' ');
  return BANNED_WORDS.filter((r) => r.test(t)).map(String);
}

/**
 * v2.13 plan B17: a rank line ("Top 1% on Base", "#3 of 12 on Arc") may name a chain, and a fact
 * chip may count commits ("12 commits"); both are stripped before the check. BENCH_PITCH_ALLOWED
 * (F10): the program pitch "who" names ("Arc pays up to $10K for payment apps.") and the starter
 * offer ("a tip jar on Arc"); Task 8 extends this list. BENCH_EXTRA: words the v2.13 surfaces
 * never use ("signal", "written by", the builder bonus).
 */
export const BENCH_PITCH_ALLOWED: RegExp[] = [
  /\b(?:Base|Arc|Robinhood Chain)(?= pays up to \$\d[\d,.]*[KkMm]? for )/g, // strips the \"who\" name only; the tail is still checked
  /\b[Aa] tip jar on (?:Base|Arc|Robinhood Chain)\b/g,
  // v2.13.3 (2): what a program needs names its chain ("for a Base app", "for an app on Base, Tempo or Robinhood Chain").
  /\bfor an? (?:Base|Arc|Tempo|Monad|Robinhood Chain|Avalanche) app\b/g,
  /\bfor an app on (?:(?:Base|Arc|Tempo|Monad|Robinhood Chain|Avalanche)(?:, | or )?)+/g,
  // v2.13.3 (5): the owner's honest line while the read-only GitHub App is off.
  /EarnKit can only see public repos right now\./g,
];
export const BENCH_ALLOWED: RegExp[] = [
  /(?<![\w#])(?:[Tt]op \d+(?:\.\d)?%|#\d+ of \d+(?: builders?)?) on (?:Base|Arc|Robinhood Chain)\b/g,
  /\b\d[\d,]* commits?\b/g,
  ...BENCH_PITCH_ALLOWED,
];
/** Owner ruling B (v2.13.3): "community round", never raise, raising or fundraise, in builder text under the Bench. */
export const BENCH_EXTRA: RegExp[] = [/\bsignals?\b/i, /written by/i, /\bbonus\b/i, /\braise\b/i, /\braising\b/i, /\bfundrais/i];
export function bannedInBench(text: string, exempt: string[]): string[] {
  let t = text;
  for (const r of BENCH_ALLOWED) t = t.replace(r, ' ');
  return [...bannedIn(t, exempt), ...BENCH_EXTRA.filter((r) => r.test(t)).map(String)];
}
