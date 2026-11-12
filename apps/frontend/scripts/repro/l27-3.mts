// L27-3 (Break): an unknown guide id renders Next's bare error shell (`<html id="__next_error__">`, no lang, main or h1) without JavaScript.
// Expected (v6.1.16 Task 13): the guide route calls notFound() so the site's 404 page (lang, main, h1) is server-rendered; status 404.
import { run, O } from './lib.mts';
await run('L27-3', 53, async (c) => {
  const r = await fetch(`${O}/programs/l33-no-such-program-${c.nonce}`, { headers: { 'x-forwarded-for': c.ip(1) } });
  const html = await r.text();
  const shell = /id="__next_error__"/.test(html);
  const lang = /<html[^>]*\blang="[a-z]/.test(html), main = /<main[\s>]/.test(html), h1 = /<h1[\s>]/.test(html);
  return { pass: r.status === 404 && !shell && lang && main && h1, actual: `HTTP ${r.status}; ${shell ? 'Next error shell' : 'site page'}; lang ${lang}, main ${main}, h1 ${h1}` };
});
