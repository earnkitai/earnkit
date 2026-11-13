import assert from 'node:assert/strict';

/** v6.1.20 review I5: the builder text contract: the 10-line budget (`budget`), one sign-in sentence, no em dash, emoji
 *  or banned word, and one ask: a capital Say or a lower-case ", then say" / ", or say" (a row's "once you say yes" is
 *  a description, not an ask). */
export function builderRules(t: string, budget = true): void {
  if (budget) assert.ok(t.split('\n').filter((l) => l.trim() !== '').length <= 10, t);
  assert.ok(t.split(/(?<=[.?!:])\s+/).filter((x) => /^Sign in\b/.test(x)).length <= 1, t);
  assert.doesNotMatch(t, /—|\p{Extended_Pictographic}|\b(score|rank|grade|points|coin|token|streak)s?\b/iu, t);
  assert.ok(t.split(/(?<=[.?!])\s+/).filter((x) => /\bSay\b|(^|, (then|or) )say\b/.test(x)).length <= 1, t);
}
