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
