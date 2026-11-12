// L27-4 (Break): /link/<code> error pages are bare text/plain (no title, lang, main or h1).
// Expected (v6.1.16 Task 13): every /link page (invalid, expired, failed, 429, not set up) renders in the site shell with title
// `{state} · EarnKit`, lang, main and one h1. Locally GitHub sign-in is not set up, so this reads the `not set up` state (503).
import { run, O } from './lib.mts';
await run('L27-4', 54, async (c) => {
  const r = await fetch(`${O}/link/l33bogus${c.nonce}`, { headers: { 'x-forwarded-for': c.ip(1) } });
  const ct = r.headers.get('content-type') ?? ''; const html = await r.text();
  const title = /<title>([^<]*· EarnKit)<\/title>/.exec(html)?.[1];
  const h1s = (html.match(/<h1[\s>]/g) ?? []).length;
  const ok = /text\/html/.test(ct) && !!title && /<html[^>]*\blang="[a-z]/.test(html) && /<main[\s>]/.test(html) && h1s === 1;
  return { pass: ok, actual: `HTTP ${r.status} ${ct}; title ${title ? `"${title}"` : 'none'}; h1 ${h1s}; body "${html.replace(/<[^>]+>/g, ' ').trim().slice(0, 80)}"` };
});
