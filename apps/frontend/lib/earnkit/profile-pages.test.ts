import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { PART_COLORS, SCORE_COLORS } from '../../app/[handle]/score-colors';
import { THEME, themeVar } from './theme';
import { sql } from './db';

/**
 * The public page routes. v2.12.1 T12: v2.12's page (score out of 100, "Top N%", stat strip, the
 * cached profileData read) is gone; the v2.12.1 page's own cases are in page-data.test.ts,
 * leaderboard.test.ts and card-route.test.ts.
 */
(globalThis as { React?: typeof React }).React = React;

test('10.5 (profile-whoop v2) each score keeps one hue family; every text color is 4.5:1 or more on the page and the card surface; reduced motion is honored', () => {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const hues = Object.values(PART_COLORS);
  const stops = hues.flatMap((h) => [h.from, h.to]);
  assert.equal(new Set(stops).size, stops.length, 'distinct gradient stops');
  // Text set in a hue (the part labels), the primary text and the muted grey: on the page and on both surface stops.
  // v4: on the deep-blue THEME (theme.ts), plus its body and accent text and the raised spot.
  const texts = [...hues.map((h) => h.text), SCORE_COLORS.text, SCORE_COLORS.muted, SCORE_COLORS.total.from, THEME.body, THEME.accent];
  for (const bg of [SCORE_COLORS.page, SCORE_COLORS.surface, SCORE_COLORS.surfaceTop, THEME.pageTop, THEME.raised])
    for (const t of texts) assert.ok(ratio(t, bg) >= 4.5, `${t} on ${bg}: ${ratio(t, bg).toFixed(2)}`);
  // The ring stops are graphics: 3:1 or more on both card stops, so every ring reads on navy.
  for (const bg of [SCORE_COLORS.surface, SCORE_COLORS.surfaceTop])
    for (const c of [...stops, SCORE_COLORS.total.from, SCORE_COLORS.total.to]) assert.ok(ratio(c, bg) >= 3, `ring ${c} on ${bg}: ${ratio(c, bg).toFixed(2)}`);
  // One set of tokens: globals.css defines every THEME value as its --ek-p-* variable, unchanged.
  const theme = readFileSync(join(import.meta.dirname, '../../app/globals.css'), 'utf8');
  for (const k of Object.keys(THEME) as (keyof typeof THEME)[])
    assert.match(theme, new RegExp(`${themeVar(k)}: ${THEME[k].replace(/[().]/g, '\\$&')};`, 'i'), k);
  // The rings are gradient strokes with a rounded cap; their draw-in stops under reduced motion.
  const ring = readFileSync(join(import.meta.dirname, '../../app/[handle]/ScoreRing.tsx'), 'utf8');
  assert.match(ring, /linearGradient/);
  assert.match(ring, /strokeLinecap="round"/);
  assert.match(ring, /role="img"/);
  const css = readFileSync(join(import.meta.dirname, '../../app/globals.css'), 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.ek-arc \{\s*animation: none;/);
  // The site header gives way to the profile's slim top bar only on a page that carries data-ek-premium.
  assert.match(css, /body:has\(\[data-ek-premium\]\) \[data-ek-header\] \{\s*display: none;/);
  const view = readFileSync(join(import.meta.dirname, '../../app/[handle]/handle-view.tsx'), 'utf8');
  assert.match(view, /data-ek-premium/);
  assert.match(view, /<SlimTopBar \/>/);
});

test('10.8 (v2.12.1 T6) the pages read live: /<handle> and /b/<name> are dynamic; hide and show expire the cache', () => {
  const page = readFileSync(join(import.meta.dirname, '../../app/b/[slug]/page.tsx'), 'utf8');
  const handle = readFileSync(join(import.meta.dirname, '../../app/[handle]/page.tsx'), 'utf8');
  for (const src of [page, handle]) {
    assert.match(src, /export const dynamic = 'force-dynamic'/);
  }
  assert.match(page, /isReserved\(slug\)/);
  assert.match(page, /HandleView\(/);
  assert.match(handle, /HandleView\(/);
  const view = readFileSync(join(import.meta.dirname, '../../app/[handle]/handle-view.tsx'), 'utf8');
  assert.match(view, /resolveHandle\(handle\)/);
  // Hide, show and an X handle change expire the cached profile at once.
  const profiles = readFileSync(join(import.meta.dirname, 'profiles.ts'), 'utf8');
  for (const fn of ['setHidden', 'clearXHandle']) {
    const body = profiles.slice(profiles.indexOf(`export async function ${fn}(`)).split('\nexport ')[0];
    // v2.13.4: a caller's transaction may defer it until its commit (afterCommit).
    assert.match(body, /profileChanged\(\)|afterCommit\(db, profileChanged\)/, fn);
  }
  // v2.14 T4, T7: bindX (and attachToX) run afterBind once the transaction committed; afterBind expires the cache
  // in a finally, so a failed discovery enqueue never leaves a stale page.
  const install = readFileSync(join(import.meta.dirname, 'x-install.ts'), 'utf8');
  const bind = install.slice(install.indexOf('export async function bindX(')).split('\nexport ')[0];
  assert.match(bind, /await afterBind\(/, 'bindX');
  const after = install.slice(install.indexOf('export async function afterBind(')).split('\nexport ')[0];
  assert.match(after, /finally \{\s*profileChanged\(\);/, 'afterBind');
  assert.match(install.slice(install.indexOf('export async function attachToX(')), /await afterBind\(/, 'attachToX');
  // v2.12.1 T12: the v2.12 page (ProfileView, profile-load, profile-data) is gone; /b/ serves reserved handles only.
  for (const gone of ['../../app/b/[slug]/ProfileView.tsx', '../../app/b/[slug]/profile-load.ts', 'profile-data.ts'])
    assert.equal(existsSync(join(import.meta.dirname, gone)), false, gone);
  const cache = readFileSync(join(import.meta.dirname, 'profile-cache.ts'), 'utf8');
  assert.match(cache, /revalidateTag\(PROFILE_TAG, \{ expire: 0 \}\)/);
});

// builder_scores and source_readings are append-only: this run's people are fresh ids.
const T = 2_143_000_000 + Math.floor(Math.random() * 200_000) * 20;
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await sql()`DELETE FROM builder_sources WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM builder_ranks WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM builder_profiles WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM profile_slug_history WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM builder_projects WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM builder_live WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM claim_codes WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM repo_public_reads WHERE repo_key LIKE ${`github.com/lee${T}/%`}`;
  await sql().end();
});
test('11.5 (v2.12.1 T12) /b/<name>/card.png and /b/<name>/share: a reserved handle through the page\'s own handlers; a claimed v2.12 slug moves to the page\'s; else 404', () => {
  const card = readFileSync(join(import.meta.dirname, '../../app/b/[slug]/card.png/route.tsx'), 'utf8');
  const share = readFileSync(join(import.meta.dirname, '../../app/b/[slug]/share/route.ts'), 'utf8');
  for (const src of [card, share]) {
    // Every 404 is no-store, so a hide or a claim shows at once.
    assert.doesNotMatch(src, /status: 404 \}\)/);
    assert.match(src, /isReserved\(slug\)/);
    assert.match(src, /const r = await resolveSlug\(slug\)/);
    assert.match(src, /status: 308/);
    assert.match(src, /pagePath\(r\.handle\)/);
    assert.doesNotMatch(src, /cachedProfile|cardModel|intentUrl|profile-data/);
    assert.match(src, /export async function GET\(_: Request/);
  }
  assert.match(card, /return cardResponse\(slug, `\/b\/\$\{slug\}`\)/);
  assert.match(share, /return shareResponse\(slug, `\/b\/\$\{slug\}`\)/);
  const config = readFileSync(join(import.meta.dirname, '../../next.config.ts'), 'utf8');
  assert.match(config, /source: '\/b\/:slug\/card\.png',\s*headers: \[\{ key: 'Content-Security-Policy', value: IMAGE_CSP \}\]/);
});

test('11.10 the card at /<handle>/card.png has the image policy, as /b/<name>/card.png', () => {
  const config = readFileSync(join(import.meta.dirname, '../../next.config.ts'), 'utf8');
  assert.match(config, /source: '\/:handle\/card\.png',\s*headers: \[\{ key: 'Content-Security-Policy', value: IMAGE_CSP \}\]/);
});
