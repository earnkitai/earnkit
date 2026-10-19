import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { SCORE_COLORS } from '../../app/[handle]/ScoreRing';
import { sql } from './db';

/**
 * The public page routes. v2.12.1 T12: v2.12's page (score out of 100, "Top N%", stat strip, the
 * cached profileData read) is gone; the v2.12.1 page's own cases are in page-data.test.ts,
 * leaderboard.test.ts and card-route.test.ts.
 */
(globalThis as { React?: typeof React }).React = React;

test('10.5 the ring\'s accents are 4.5:1 or more on the panel navy (plan R17); the ring uses both', () => {
  const ring = readFileSync(join(import.meta.dirname, '../../app/[handle]/ScoreRing.tsx'), 'utf8');
  assert.match(ring, /SCORE_COLORS\.from/);
  assert.match(ring, /SCORE_COLORS\.to/);
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  assert.ok(ratio(SCORE_COLORS.from, SCORE_COLORS.panel) >= 4.5);
  assert.ok(ratio(SCORE_COLORS.to, SCORE_COLORS.panel) >= 4.5);
  const tw = readFileSync(join(import.meta.dirname, '../../tailwind.config.ts'), 'utf8');
  assert.match(tw, /'ek-score-orange': '#FF7A1A'/);
  assert.match(tw, /'ek-score-purple': '#9B6BFF'/);
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
