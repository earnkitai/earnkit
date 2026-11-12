// L27-6 (+ L27-13) (Break in lane 27's report): reader mode drops /programs: the page is bare links with no list semantics.
// Expected (v6.1.16 Task 13): /programs is a semantic list: one h2 per block (Open now, Not open yet, Closed), a ul of article
// items (title link, money line, close line); / keeps a real h1. Checked on the server HTML.
import { run, O } from './lib.mts';
await run('L27-6', 56, async (c) => {
  const H = { 'x-forwarded-for': c.ip(1) };
  const html = await (await fetch(O + '/programs', { headers: H })).text();
  const home = await (await fetch(O + '/', { headers: H })).text();
  const h2 = [...html.matchAll(/<h2[^>]*>([^<]*)</g)].map((m) => m[1].trim());
  const articles = (html.match(/<article[\s>]/g) ?? []).length;
  const ulArticle = /<ul[^>]*>\s*<li[^>]*>\s*<article[\s>]/.test(html) || /<ul[^>]*>\s*<article[\s>]/.test(html);
  const h1 = /<h1[\s>]/.test(home);
  const pass = h2.includes('Open now') && articles >= 10 && ulArticle && h1;
  return { pass, actual: `/programs h2 [${h2.join(', ')}], ${articles} article items, ul of articles ${ulArticle}; / h1 ${h1}` };
});
