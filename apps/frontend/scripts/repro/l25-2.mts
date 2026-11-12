// L25-2 (Break): the meta description and every share card say EarnKit applies, while the Terms say it never submits.
// Expected (v6.1.16 Task 10): one line everywhere: `Your agent finds the grants and prizes your repo fits and fills the forms. Free.`
// (home meta, og and twitter descriptions); no page's description says EarnKit applies.
import { run, O } from './lib.mts';
const RULED = 'Your agent finds the grants and prizes your repo fits and fills the forms. Free.';
const metas = (html: string) => [...html.matchAll(/<meta\s+[^>]*(?:name|property)="(description|og:description|twitter:description)"[^>]*>/g)]
  .map((m) => ({ k: m[1], v: (/content="([^"]*)"/.exec(m[0])?.[1] ?? '').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"') }));
await run('L25-2', 35, async (c) => {
  const pages = ['/', '/docs', '/programs', '/programs/y-combinator', '/terms', `/l33-no-such-page-${c.nonce}`];
  const bad: string[] = []; let home: { k: string; v: string }[] = [];
  for (const p of pages) {
    const r = await fetch(O + p, { headers: { 'x-forwarded-for': c.ip(1) } });
    const m = metas(await r.text());
    if (p === '/') home = m;
    for (const x of m) if (/\bapplies\b|\bapply for you\b/i.test(x.v)) bad.push(`${p} ${x.k}: "${x.v}"`);
  }
  const homeOk = home.length >= 3 && home.every((x) => x.v === RULED);
  return { pass: homeOk && bad.length === 0, actual: `home ${home.map((x) => `${x.k}="${x.v}"`).join('; ') || 'no description metas'}; pages saying it applies: ${bad.length} (${bad.slice(0, 2).join(' | ')})` };
});
