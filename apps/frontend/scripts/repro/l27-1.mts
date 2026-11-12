// L27-1 (Break): the primary actions (`Add to your agent`, `Add EarnKit to your agent`, `Ask your agent`) are <button>s
// outside any form, dead without JavaScript.
// Expected (v6.1.16 Task 13): each is a link to /docs (server HTML `<a href="/docs...">`) that JavaScript upgrades to the modal.
// Checked on the server-rendered HTML (what a no-JS visitor gets): /, a guide, /docs.
import { run, O } from './lib.mts';
const LABEL = /^(Add to your agent|Add EarnKit to your agent|Ask your agent)$/;
await run('L27-1', 51, async (c) => {
  const buttons: string[] = []; let links = 0;
  for (const p of ['/', '/programs/y-combinator', '/docs']) {
    const html = await (await fetch(O + p, { headers: { 'x-forwarded-for': c.ip(1) } })).text();
    // the element that holds each label: walk back from the label to the nearest opening <a or <button
    for (const m of html.matchAll(/>\s*(Add to your agent|Add EarnKit to your agent|Ask your agent)\s*</g)) {
      if (!LABEL.test(m[1])) continue;
      const before = html.slice(Math.max(0, m.index! - 1500), m.index! + 1);
      const a = before.lastIndexOf('<a '), b = before.lastIndexOf('<button'), ca = before.lastIndexOf('</a>'), cb = before.lastIndexOf('</button>');
      if (b > a && b > cb) buttons.push(`${p} "${m[1]}"`);
      else if (a > b && a > ca && /href="\/docs/.test(before.slice(a, a + 300))) links++;
    }
  }
  return { pass: buttons.length === 0 && links > 0, actual: `${buttons.length} primary actions are <button>s with no link (${[...new Set(buttons)].join(', ')}); ${links} are links to /docs` };
});
