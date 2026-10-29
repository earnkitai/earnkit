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
 * v2.13 plan B17: a rank line ("Top 1% on Base", "#3 of 12 on Arc", now "Top 1% of builders on Base") may name a chain, and a fact
 * chip may count commits ("12 commits"); both are stripped before the check. BENCH_PITCH_ALLOWED
 * (F10): the program pitch "who" names ("Arc pays up to $10K for payment apps.") and the starter
 * offer ("a tip jar on Arc"); Task 8 extends this list. BENCH_EXTRA: words the v2.13 surfaces
 * never use ("signal", "written by", the builder bonus).
 */
export const BENCH_PITCH_ALLOWED: RegExp[] = [
  // 2026-10-22 (owner-approved reply fixes, fix round 1): the honest hook strips only its organizer and the chain it names
  // ("for apps on Base"); the rest of the sentence is still scanned.
  /\b[A-Z][\w&'-]*(?: [A-Z][\w&'-]*){0,3}(?= pays? up to \$[\d,]+(?: investment)? for apps\b)/g,
  /(?<=\bfor apps on )(?:Base|Arc|Tempo|Monad|Robinhood Chain|Avalanche)\b/g,
  // v4.0 approved copy 1: the intro's open grant names its organizer ("Up to $5,000 is open from Base right now.").
  /(?<=\bUp to \$[\d,]+ is open from )[A-Z][\w&'-]*(?: [A-Z][\w&'-]*){0,3}(?= right now\.)/g,
  /\b(?:Base|Arc|Robinhood Chain)(?= pays? up to \$\d[\d,.]*[KkMm]? for )/g, // strips the \"who\" name only; the tail is still checked
  /\b[Aa] tip jar on (?:Base|Arc|Robinhood Chain)\b/g,
  // v2.13.3 (2): what a program needs names its chain ("for a Base app", "for an app on Base, Tempo or Robinhood Chain").
  /\bfor an? (?:Base|Arc|Tempo|Monad|Robinhood Chain|Avalanche) app\b/g,
  /\bfor an app on (?:(?:Base|Arc|Tempo|Monad|Robinhood Chain|Avalanche)(?:, | or )?)+/g,
  // Scoring and clarity R12: why a program fits names the chain ("You deployed on Base", "you build for Arc").
  /\b[Yy]ou (?:deployed on|deploy to|build for) (?:Base|Arc|Tempo|Monad|Robinhood Chain|Avalanche)\b/g,
  // v2.13.3 (5): the owner's honest line while the read-only GitHub App is off.
  /EarnKit can only see public repos right now\./g,
  // Launch ready L2: the owner's own repo picker line ("Install the read-only EarnKit app on the repo you want ranked").
  /\bon the repo you want ranked\b/g,
  // v3 Stage 2 (spec 5.3 Route 2): the backing offer's own risk words ("People can back X onchain.", "a tradable token on Base").
  /(?<=^|\. )People can back .{1,80}? onchain(?=\. EarnKit launches a )/g,
  /\bIt is a tradable token on Base and can go to zero\./g,
  // Its "Your coin stays onchain." (RAISE_LINES.off).
  /\bYour coin stays onchain\./g,
  // v3.1 Task 16: the owner-approved copy (2026-10-21): its own words for the repo and the commits, and the open grant's organizer.
  /\bpick the repo you're building\b/g,
  /\bI read your commits every week\b/g,
  // Clarity batch (owner-approved 2026-10-22): the How it works steps and where the score comes from (leaderboard, profile).
  /\bwe read your commits\b/g,
  /\bWe match your repo to open grants\b/g,
  /\bFrom GitHub commits\b/g,
  // 2026-10-22 (owner-approved reply fixes): the honest hook names the grant's organizer and its one chain, and the
  // no-fit path to Base's grant names the program's own steps.
  /\bBase's \$[\d,]+ grant\b/g,
  /\bput the app on Base\b/g,
  /\bonce Base fits\./g,
  // Fix round 1 (coordinator copy): the titles question names commit titles, as "I read your commits every week" does.
  /\bShow your commit titles on your page\?/g,
  /\bPut your app on Base\./g,
  /\bBuilder Codes \(Base asks for this first\)/g,
  // v3.1 cold read (owner-approved 2026-10-23): the titles question, the Builder Code step and the coin offer's own words.
  /\bShow what you shipped \(commit titles\)/g,
  /\bAdd Base's Builder Code to your app, a one-line tag Base uses to see your traffic\b/g,
  /\bI can launch \$[A-Z0-9]+, a coin for .{1,80}? on Base\./g,
  /\bProve your Base wallet so your contracts show on your page\./g,
  // v4.3 (owner-approved 2026-10-29): the qualify reply's Builder Codes tag and its Base step's question.
  /\ba one-line tag that credits your app's Base transactions to you\b/g,
  /\bWant help putting .{1,60}? on Base\?/g,
];
export const BENCH_ALLOWED: RegExp[] = [
  /(?<![\w#])(?:[Tt]op \d+(?:\.\d)?%|#\d+ of \d+(?: builders?)?) on (?:Base|Arc|Robinhood Chain)\b/g,
  // Scoring and clarity, v3 Stage 3 (never "this week"): the chain's rank line ("Top 1% of builders on Base", "#2 of 12 builders on Arc").
  /(?<![\w#])(?:Top \d+(?:\.\d)?% of builders|#\d+ of \d+ builders?) on (?:Base|Arc|Robinhood Chain)\b/g,
  /\b\d[\d,]* commits?\b/g,
  // v3 Stage 3 (spec 5.6): the landing's one line says where the ship log comes from.
  /\bfrom real commits\b/g,
  ...BENCH_PITCH_ALLOWED,
];
/** v3 Stage 2 (spec 5.3 Route 2): "Backing", never "community round", raise, raising or fundraise, in builder text under the Bench. */
export const BENCH_EXTRA: RegExp[] = [/\bsignals?\b/i, /written by/i, /\bbonus\b/i, /\braise\b/i, /\braising\b/i, /\bfundrais/i, /community round/i];
export function bannedInBench(text: string, exempt: string[]): string[] {
  let t = text;
  for (const r of BENCH_ALLOWED) t = t.replace(r, ' ');
  return [...bannedIn(t, exempt), ...BENCH_EXTRA.filter((r) => r.test(t)).map(String)];
}
