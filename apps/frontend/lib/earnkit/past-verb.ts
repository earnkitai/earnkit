/**
 * v3.1 GTM W3: the past tense of the verbs commit titles start with, shared by the week summary (week-summary.ts
 * ruleSummary) and the title cleaner (ship-titles.ts cleanTitle, which keeps a "fix:" title reading as a fix).
 */
/** The past tense of the verbs commit titles start with ("Fix", "Adds", "Added"); null when the word is not one. Pure. */
const IRREGULAR: Record<string, string> = { make: 'made', build: 'built', write: 'wrote', keep: 'kept', send: 'sent', hide: 'hid', run: 'ran', let: 'let', set: 'set', cut: 'cut', split: 'split', put: 'put', read: 'read', get: 'got', rebuild: 'rebuilt', rewrite: 'rewrote' };
const DOUBLED = new Set(['ship', 'drop', 'stop', 'wrap', 'plan', 'log', 'swap', 'pin', 'trim', 'skip', 'tag', 'map']);
const VERBS = new Set([
  ...Object.keys(IRREGULAR), ...DOUBLED, 'add', 'fix', 'update', 'remove', 'improve', 'show', 'support', 'use', 'move', 'rename', 'refactor',
  'clean', 'handle', 'allow', 'create', 'change', 'polish', 'speed', 'simplify', 'launch', 'migrate', 'replace', 'enable', 'disable',
  'implement', 'introduce', 'redesign', 'rework', 'document', 'tweak', 'upgrade', 'prevent', 'open', 'close', 'return', 'guard', 'track',
  'start', 'finish', 'connect', 'integrate', 'port', 'restore', 'revert', 'wire', 'sort', 'filter', 'cache', 'retry', 'check', 'block',
  'reduce', 'increase', 'raise', 'lower', 'limit', 'validate', 'verify', 'publish', 'deploy', 'host', 'link', 'mark', 'name', 'store',
  'save', 'load', 'fetch', 'extend', 'expand', 'shorten', 'harden', 'tighten', 'redirect', 'render', 'resize', 'reorder', 'rewire', 'split',
  'unify', 'merge', 'show', 'display', 'cover', 'test', 'release', 'shorten', 'lead', 'drive', 'invite', 'accept', 'require', 'detect',
]);
const pastOf = (base: string) =>
  IRREGULAR[base] ?? (DOUBLED.has(base) ? `${base}${base.at(-1)}ed` : base.endsWith('e') ? `${base}d` : /[^aeiou]y$/.test(base) ? `${base.slice(0, -1)}ied` : `${base}ed`);
export function pastVerb(word: string): string | null {
  const w = word.toLowerCase();
  if (VERBS.has(w)) return pastOf(w);
  for (const base of [w.replace(/es$/, ''), w.replace(/s$/, '')]) if (base !== w && VERBS.has(base)) return pastOf(base);
  for (const base of [w.replace(/ed$/, ''), w.replace(/d$/, ''), w.replace(/ied$/, 'y'), w.replace(/(.)\1ed$/, '$1')]) if (base !== w && VERBS.has(base) && pastOf(base) === w) return w;
  return Object.values(IRREGULAR).includes(w) ? w : null;
}
