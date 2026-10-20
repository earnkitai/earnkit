import { personFacts } from './page-data';
import { resolveHandle } from './profiles';
import { rankSplit } from './rank';
import { pagePath } from './reserved-routes';
import { THEME } from './theme';

/**
 * Launch-ready L8: the README badge, earnkit.com/badge/<handle>.svg: "EarnKit | Shipping 72 · #3" in the brand's
 * colors, shaped like a shields.io badge. The value is the profile header's (page-data personFacts): the rank only
 * inside the leaderboard's pool, and no bare score without a rank (as the page's ring), so outside it the badge says
 * "not ranked". An unknown, unclaimed or hidden handle gets the badge "EarnKit | not found", answered 200 (owner
 * ruling, fix round 1: GitHub's image proxy shows a 200 image in a README) with the short miss cache.
 */

export const BADGE_LABEL = 'EarnKit';
export const BADGE_NOT_RANKED = 'not ranked';
export const BADGE_NOT_FOUND = 'not found';
/** A shared cache keeps a badge an hour (README images are fetched through GitHub's image proxy). */
export const BADGE_CACHE = 'public, max-age=3600, s-maxage=3600';
/** A not-found badge is kept 10 minutes, so a handle claimed just now shows soon. */
export const BADGE_MISS_CACHE = 'public, max-age=600, s-maxage=600';

// v3 Stage 3 Task 6 (spec 5.8): the flat system's colours (theme.ts THEME): the label on the black page, the value on
// brand blue, white text on both (5.8:1 on brand). Task 7: the not-found value is muted text on the raised spot (4.8:1;
// white on the muted grey was 3.5:1). The geometry is shields.io's.
const LABEL_FILL = THEME.page;
const VALUE_FILL = THEME.brand;
const INK = THEME.text;
const MUTED_FILL = THEME.raised;
const MUTED_INK = THEME.muted;

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** About how wide `s` is in 11px Verdana (shields.io's font), in px. Pure. */
export function textWidth(s: string): number {
  let w = 0;
  for (const c of s) {
    if (/[il.,:;|!'·]/.test(c)) w += 3.6;
    else if (c === ' ') w += 3.9;
    else if (/[mwMW%]/.test(c)) w += 10.5;
    else if (/[A-Z#]/.test(c)) w += 7.6;
    else w += 6.6;
  }
  return Math.ceil(w);
}

/** The badge's SVG: the label on black, the value on brand blue in white (or muted on the raised spot when `muted`); text escaped. Pure. */
export function badgeSvg(value: string, o: { muted?: boolean } = {}): string {
  const pad = 6;
  const lw = textWidth(BADGE_LABEL) + 2 * pad;
  const vw = textWidth(value) + 2 * pad;
  const w = lw + vw;
  const label = escapeXml(BADGE_LABEL);
  const text = escapeXml(value);
  const fill = o.muted ? MUTED_FILL : VALUE_FILL;
  const ink = o.muted ? MUTED_INK : INK;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${text}">` +
    `<title>${label}: ${text}</title>` +
    `<clipPath id="r"><rect width="${w}" height="20" rx="3"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="${LABEL_FILL}"/><rect x="${lw}" width="${vw}" height="20" fill="${fill}"/></g>` +
    `<g font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-rendering="geometricPrecision">` +
    `<text x="${lw / 2}" y="14" fill="${INK}" text-anchor="middle" textLength="${lw - 2 * pad}" lengthAdjust="spacingAndGlyphs">${label}</text>` +
    `<text x="${lw + vw / 2}" y="14" fill="${ink}" text-anchor="middle" textLength="${vw - 2 * pad}" lengthAdjust="spacingAndGlyphs">${text}</text>` +
    `</g></svg>`;
}

/** The value: "Shipping 72 · #3" (or "Shipping 72 · Top 4%") inside the pool, else "not ranked". Pure. */
export function badgeValue(f: { rank: string | null; score: number }): string {
  return f.rank ? `Shipping ${f.score} · ${rankSplit(f.rank).lead}` : BADGE_NOT_RANKED;
}

/** The README markdown the profile offers: the badge, linking to the page. Pure. */
export const badgeMarkdown = (handle: string) =>
  `[![EarnKit](https://earnkit.com/badge/${handle}.svg)](https://earnkit.com${pagePath(handle)})`;

/**
 * Final fix M6: only a name that can be an X handle plus ".svg" is looked up; anything else is the not-found badge
 * before any cache entry or database read (the route checks first), so junk names can't fill the cache. Pure.
 */
export const badgeFileOk = (file: string) => /^[A-Za-z0-9_]{1,15}\.svg$/i.test(file);
export const badgeMiss = () => ({ found: false, svg: badgeSvg(BADGE_NOT_FOUND, { muted: true }) });

/**
 * The badge of `file` ("<handle>.svg"): the live row on every request (cached by the response header). A rename or
 * another case serves the same person's badge (a README keeps working); unknown, unclaimed or hidden is not found.
 * `only` limits the rank's pool (tests).
 */
export async function badgeFor(file: string, o: { only?: number[] } = {}): Promise<{ found: boolean; svg: string }> {
  const miss = badgeMiss();
  const m = /^(.+)\.svg$/i.exec(file);
  if (!m || !badgeFileOk(file)) return miss;
  let r = await resolveHandle(m[1]);
  if (r && 'redirect' in r) r = await resolveHandle(r.redirect.split('/').pop() ?? '');
  if (!r || 'redirect' in r) return miss;
  const f = await personFacts(r.builderId, o);
  if (!f) return miss;
  return { found: true, svg: badgeSvg(badgeValue(f)) };
}

/** The badge's response: always 200 (a README shows it), cached an hour, a not-found one 10 minutes. Pure. */
export function badgeResponse(b: { found: boolean; svg: string }): Response {
  return new Response(b.svg, {
    status: 200,
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': b.found ? BADGE_CACHE : BADGE_MISS_CACHE, 'X-Content-Type-Options': 'nosniff' },
  });
}
