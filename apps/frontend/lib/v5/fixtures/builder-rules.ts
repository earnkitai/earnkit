import assert from 'node:assert/strict';

/** v6.1.20 review I5: the builder text contract: the 10-line budget (`budget`), one sign-in sentence, no em dash, emoji
 *  or banned word, and one ask: a capital Say or a lower-case ", then say" / ", or say" (a row's "once you say yes" is
 *  a description, not an ask). */
export function builderRules(t: string, budget = true): void {
  if (budget) assert.ok(t.split('\n').filter((l) => l.trim() !== '').length <= 10, t);
  assert.ok(t.split(/(?<=[.?!:])\s+/).filter((x) => /^Sign in\b/.test(x)).length <= 1, t);
  assert.doesNotMatch(t, /—|\p{Extended_Pictographic}|\b(score|rank|grade|points|coin|token|streak)s?\b/iu, t);
  assert.ok(t.split(/(?<=[.?!])\s+/).filter((x) => /\bSay\b|(^|, (then|or) )say\b/.test(x)).length <= 1, t);
  // L1n-1 (v6.1.23): every number a Say names is a numbered row on the same screen.
  for (const m of t.matchAll(/\b[Ss]ay (?:do )?(\d+)\b/g)) assert.match(t, new RegExp(`^${m[1]}\\. `, 'm'), t);
}

/** v3.8 E15 (plan 23.7): the phrases a builder line never carries: the delegable asks and the form-letter words. */
export const BANNED_V2 = [
  'Got a link', 'Tell me how much you won', 'Tell me the amount', 'Send me the demo', 'Say sent', 'Tell me when you started',
  'Say which repo is yours', 'Do real people use it?', 'say its name again when it reopens', 'Heard back from', 'Did you hear back',
  'Tell me what you build', 'or its repo link', 'Tell me the repo link', 'Which change did you finish', 'Tell me when it is live',
  'kindly', 'please note', 'successfully', 'in order to', 'and I match it',
];

/** v3.8 E15 (plan 23.3 rule 4, decision 33): an ask for something EarnKit or the agent can find or decide itself. */
export const DELEGABLE = /\b(tell|send|give|show) me\b[^.?]*\b(repo|link|amount|how much|when you started|demo|website|live|announcement|what you build|does)\b|\bdo real people use it\b|\b(did you )?hear(d)? back\b|\bwhich (repo|change)\b|say (its|the) name again/i;

/**
 * v3.8 E15 (plan 23.7): builderRules v2, for the new copy (`copy_v38`): every v1 rule, plus no semicolons, en dashes or
 * exclamation marks, none of `BANNED_V2`, no delegable ask, at most `maxSentences` sentences, and a line that ends on a
 * question or an offer (a Say) only when it needs the builder; otherwise it ends on what EarnKit did or will do.
 */
export function builderRulesV2(t: string, o: { needsBuilder: boolean; maxSentences?: number }): void {
  builderRules(t);
  assert.doesNotMatch(t, /[;–!]/u, t);
  for (const b of BANNED_V2) assert.ok(!t.toLowerCase().includes(b.toLowerCase()), `${b}: ${t}`);
  assert.doesNotMatch(t, DELEGABLE, t);
  const sentences = t.split(/(?<=[.?!])\s+/).filter((x) => x.trim() !== '');
  if (o.maxSentences !== undefined) assert.ok(sentences.length <= o.maxSentences, t);
  const last = sentences.at(-1) ?? '';
  const asks = last.trim().endsWith('?') || /^(Or )?[Ss]ay\b|, (then|or) say\b|\bsay yes\b/.test(last);
  if (!o.needsBuilder) assert.ok(!asks, `ends on an ask with nothing needed from the builder: ${t}`);
}
