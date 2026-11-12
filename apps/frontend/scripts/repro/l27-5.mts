// L27-5 (Break): og.png (every page's share card) describes the old product ("ranks you against every builder").
// Expected (v6.1.16 Task 13): one new static 1200x630 og.png with `Your agent finds the grants and prizes your repo fits and fills the forms.`
// and `earnkit.com`, drawn by a script in the repo. An image cannot be read here, so the check is: the card the home page names
// (its path fetched from localhost only) is no longer the old card's bytes, and is a 1200x630 PNG.
import { createHash } from 'node:crypto';
import { run, O } from './lib.mts';
const OLD = 'e8ed2dc025c5d3581e894053be72f507ec68fb2e7d11a845b51d585a673d8541'; // sha256 of the card at main dafd2ade
await run('L27-5', 55, async (c) => {
  const H = { 'x-forwarded-for': c.ip(1) };
  const home = await (await fetch(O + '/', { headers: H })).text();
  const u = /<meta property="og:image" content="([^"]+)"/.exec(home)?.[1];
  if (!u) return { pass: false, actual: 'no og:image on /' };
  const path = new URL(u, O).pathname + new URL(u, O).search; // never fetch the absolute (live) host
  const r = await fetch(O + path, { headers: H });
  const b = Buffer.from(await r.arrayBuffer());
  const sha = createHash('sha256').update(b).digest('hex');
  const png = b.subarray(1, 4).toString() === 'PNG';
  const w = png ? b.readUInt32BE(16) : 0, h = png ? b.readUInt32BE(20) : 0;
  return { pass: r.status === 200 && sha !== OLD && w === 1200 && h === 630, actual: `${path} HTTP ${r.status}, ${png ? `PNG ${w}x${h}` : 'not a PNG'}, ${sha === OLD ? 'still the old card (sha256 unchanged since dafd2ade)' : 'new bytes'}` };
});
