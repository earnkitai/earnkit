/**
 * Test only, v2.10 Ruling H10 (I2): the guide's quoted program facts (its "What won" themes and
 * examples, "What <X> wants now" and "What it wants" lines) are the program's own sourced words, not
 * EarnKit's, so the copy ban on "vault" doesn't apply to them. Removes those bullet lines; every
 * other line, the guide's header and best bet included, is still scanned.
 */
const QUOTED_HEADING = /^(What won last time|What won before|What .+ wants now|What it wants)$/;

export function withoutQuotedFacts(text: string): string {
  const out: string[] = [];
  let quoted = false;
  for (const line of text.split('\n')) {
    if (QUOTED_HEADING.test(line)) quoted = true;
    else if (line.trim() === '') quoted = false;
    else if (quoted && (line.startsWith('- ') || /^in /.test(line))) continue;
    else quoted = false;
    out.push(line);
  }
  return out.join('\n');
}
