import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SCORE_COLORS } from '../../app/[handle]/ScoreRing';
import { sql } from './db';

/**
 * The public page routes. v2.12.1 T12: v2.12's page (score out of 100, "Top N%", stat strip, the
 * cached profileData read) is gone; the v2.12.1 page's own cases are in page-data.test.ts,
 * leaderboard.test.ts and card-route.test.ts.
 */
(globalThis as { React?: typeof React }).React = React;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

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

test('10.8 (v2.12.1 T6) the pages read live: /<handle> and /b/<name> are dynamic, nothing with the flag off; hide and show expire the cache', () => {
  const page = readFileSync(join(import.meta.dirname, '../../app/b/[slug]/page.tsx'), 'utf8');
  const handle = readFileSync(join(import.meta.dirname, '../../app/[handle]/page.tsx'), 'utf8');
  for (const src of [page, handle]) {
    assert.match(src, /export const dynamic = 'force-dynamic'/);
    assert.match(src, /if \(!builderScoreEnabled\(\)\) notFound\(\)/);
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
  const claim = readFileSync(join(import.meta.dirname, 'claim.ts'), 'utf8');
  const bind = claim.slice(claim.indexOf('export async function bindX(')).split('\nexport ')[0];
  assert.match(bind, /profileChanged\(\)/, 'bindX');
  // v2.12.1 T12: the v2.12 page (ProfileView, profile-load, profile-data) is gone; /b/ serves reserved handles only.
  for (const gone of ['../../app/b/[slug]/ProfileView.tsx', '../../app/b/[slug]/profile-load.ts', 'profile-data.ts'])
    assert.equal(existsSync(join(import.meta.dirname, gone)), false, gone);
  const cache = readFileSync(join(import.meta.dirname, 'profile-cache.ts'), 'utf8');
  assert.match(cache, /revalidateTag\(PROFILE_TAG, \{ expire: 0 \}\)/);
});

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
// builder_scores and source_readings are append-only: this run's people are fresh ids.
const T = 2_143_000_000 + Math.floor(Math.random() * 200_000) * 20;
const NOW = new Date('2026-10-12T12:00:00Z');
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
const profile = (id: number, o: { slug?: string } = {}) =>
  sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${o.slug ?? `s${id}`})`;

test('11.5 (v2.12.1 T12) /b/<name>/card.png and /b/<name>/share: a reserved handle through the page\'s own handlers; a claimed v2.12 slug moves to the page\'s; else 404', () => {
  const card = readFileSync(join(import.meta.dirname, '../../app/b/[slug]/card.png/route.tsx'), 'utf8');
  const share = readFileSync(join(import.meta.dirname, '../../app/b/[slug]/share/route.ts'), 'utf8');
  for (const src of [card, share]) {
    assert.match(src, /if \(!builderScoreEnabled\(\)\) return new Response\('Not found', \{ status: 404, headers: \{ 'Cache-Control': 'no-store' \} \}\)/);
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

/** What a page did: rendered (its element), a 404, or a redirect ("308 /to"). Next's notFound and redirects throw. */
async function outcome(run: () => unknown): Promise<React.ReactElement | 404 | string> {
  try {
    return (await run()) as React.ReactElement;
  } catch (e) {
    const d = String((e as { digest?: unknown }).digest ?? '');
    if (d.startsWith('NEXT_HTTP_ERROR_FALLBACK;404')) return 404;
    const m = /^NEXT_REDIRECT;[^;]*;([^;]*);(\d+);/.exec(d);
    if (m) return `${m[2]} ${m[1]}`;
    throw e;
  }
}
const handlePage = async (handle: string) => (await import('../../app/[handle]/page')).default({ params: Promise.resolve({ handle }) });
const bPage = async (slug: string) => (await import('../../app/b/[slug]/page')).default({ params: Promise.resolve({ slug }) });

test('6.16 flag off: /claim/<code>, /x/callback, /<handle> and /b/<name> are all 404', async () => {
  const was = process.env.EARNKIT_BUILDER_SCORE;
  try {
    const claim = await import('../../app/claim/[code]/route');
    const cb = await import('../../app/x/callback/route');
    const params = { params: Promise.resolve({ code: 'x' }) };
    assert.equal((await claim.GET(new Request('https://earnkit.com/claim/x'), params)).status, 404);
    assert.equal((await claim.POST(new Request('https://earnkit.com/claim/x', { method: 'POST' }), params)).status, 404);
    assert.equal((await cb.GET(new Request('https://earnkit.com/x/callback?code=c&state=s'))).status, 404);
    assert.equal(await outcome(() => handlePage('lee_builds')), 404);
    assert.equal(await outcome(() => bPage('lee_builds')), 404);
  } finally {
    if (was === undefined) delete process.env.EARNKIT_BUILDER_SCORE;
    else process.env.EARNKIT_BUILDER_SCORE = was;
  }
});

test('6.17 /b/<v2.12 slug>: unclaimed is a 404, claimed is a 308 to /<handle>; /<handle> shows the top line; reserved handles live at /b/', dbTest, async () => {
  const was = process.env.EARNKIT_BUILDER_SCORE;
  try {
    const { bindX } = await import('./claim');
    const [a, b] = [T + 11, T + 12];
    await profile(a, { slug: `b-u${T}` });
    assert.equal(await outcome(() => bPage(`b-u${T}`)), 404, 'unclaimed: no public page');
    await profile(b, { slug: `b-c${T}` });
    const handle = `Pg${T}`.slice(0, 15);
    await bindX(b, { id: `31${T}`, username: handle, name: 'Page Person', avatar: null }, NOW);
    // A rendered page starts the person's refresh (its cards); read just now, so it never rescores
    // this person from their (empty) sources while the test writes their projects.
    await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at, read_at)
      VALUES (${b}, 0, '{}'::jsonb, false, 0, 0, 'v2', 'v2', now(), now() + interval '1 day')`;
    assert.equal(await outcome(() => bPage(`b-c${T}`)), `308 /${handle}`);
    assert.equal(await outcome(() => bPage(handle.toLowerCase())), `308 /${handle}`);
    assert.equal(await outcome(() => handlePage(handle.toLowerCase())), `308 /${handle}`, 'one URL: the handle in its own case');
    const shown = await outcome(() => handlePage(handle));
    assert.ok(typeof shown === 'object');
    assert.match(html(shown), /<h1[^>]*>Page Person is building with AI\.<\/h1>/);
    await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${b}, 'k1', 'Tip jar', 'app', true, true)`;
    await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at) VALUES (${b}, 10, '{}'::jsonb, true, 1, 0, 'v2', 'v2', now()) ON CONFLICT (builder_id) DO UPDATE SET score = 10, ranked = true, shipped = 1`;
    assert.match(html((await outcome(() => handlePage(handle))) as React.ReactElement), /<h1[^>]*>Page Person has shipped 1 app with AI\.<\/h1>/);
    await sql()`UPDATE builder_profiles SET hidden = true WHERE builder_id = ${b}`;
    assert.equal(await outcome(() => handlePage(handle)), 404, 'hidden');
    assert.equal(await outcome(() => bPage(`b-c${T}`)), 404, 'hidden, also through the old slug');
    // A reserved handle: served at /b/<Handle>; /<Handle> and the lowercase form move there.
    const r = T + 13;
    await profile(r, { slug: `b-r${T}` });
    await bindX(r, { id: `32${T}`, username: 'Leaderboard', name: 'Board', avatar: null }, NOW);
    assert.ok(typeof (await outcome(() => bPage('Leaderboard'))) === 'object');
    assert.equal(await outcome(() => bPage('leaderboard')), '308 /b/Leaderboard');
    assert.equal(await outcome(() => handlePage('Leaderboard')), '308 /b/Leaderboard');
  } finally {
    if (was === undefined) delete process.env.EARNKIT_BUILDER_SCORE;
    else process.env.EARNKIT_BUILDER_SCORE = was;
  }
});

test('11.9 (v2.12.1 T11) the page at /<handle>: the full profile; unclaimed none, hidden 404, /Lee 308 to /lee, a reserved handle at /b/ and /terms stays the terms page', dbTest, async () => {
  const was = process.env.EARNKIT_BUILDER_SCORE;
  try {
    const { bindX } = await import('./claim');
    const [a, b, r] = [T + 14, T + 15, T + 16];
    await profile(a, { slug: `p-u${T}` });
    // Unclaimed: no page under any name.
    assert.equal(await outcome(() => handlePage(`p-u${T}`.slice(0, 15))), 404);
    // Claimed as lowercase "lee…": /Lee… is a 308 to the stored case; the page shows the header and the projects' place.
    await profile(b, { slug: `p-c${T}` });
    const handle = `le${T}`.slice(0, 15);
    await bindX(b, { id: `33${T}`, username: handle, name: 'Lee', avatar: null }, NOW);
    await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at, read_at)
      VALUES (${b}, 0, '{}'::jsonb, false, 0, 0, 'v2', 'v2', now(), now() + interval '1 day')`;
    assert.equal(await outcome(() => handlePage(handle.toUpperCase())), `308 /${handle}`);
    await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES
      (${b}, 'https://a.example', 'A', 'app', false, true), (${b}, 'https://b.example', 'B', 'app', false, true), (${b}, 'https://c.example', 'C', 'app', false, true)`;
    const page = html((await outcome(() => handlePage(handle))) as React.ReactElement);
    assert.match(page, /<h1[^>]*>Lee has shipped 3 apps with AI\.<\/h1>/);
    assert.match(text(page), /Numbers come from public data EarnKit can check/);
    assert.doesNotMatch(page, /Score \d+ of 100/, 'not ranked: no ring');
    // The page's title, description and card.
    const meta = await (await import('../../app/[handle]/page')).generateMetadata({ params: Promise.resolve({ handle }) });
    assert.equal(meta.title, 'Lee on EarnKit');
    assert.equal(meta.description, 'Lee has shipped 3 apps with AI.');
    assert.match(JSON.stringify(meta.openGraph), new RegExp(`/${handle}/card\\.png`));
    await sql()`UPDATE builder_profiles SET hidden = true WHERE builder_id = ${b}`;
    assert.equal(await outcome(() => handlePage(handle)), 404, 'hidden');
    // A reserved handle (@mcp): its profile at /b/mcp, its card at /b/mcp/card.png.
    await profile(r, { slug: `p-r${T}` });
    await bindX(r, { id: `34${T}`, username: 'mcp', name: 'Em', avatar: null }, NOW);
    const reserved = await outcome(() => bPage('mcp'));
    assert.ok(typeof reserved === 'object');
    assert.match(html(reserved), /<h1[^>]*>Em is building with AI\.<\/h1>/);
    const bMeta = await (await import('../../app/b/[slug]/page')).generateMetadata({ params: Promise.resolve({ slug: 'mcp' }) });
    assert.match(JSON.stringify(bMeta.openGraph), /\/b\/mcp\/card\.png/);
    assert.equal(await outcome(() => handlePage('mcp')), '308 /b/mcp');
    // /terms is its own route (a static segment wins over [handle]), so it stays the terms page.
    const { existsSync } = await import('node:fs');
    assert.ok(existsSync(join(import.meta.dirname, '../../app/terms/page.tsx')));
  } finally {
    await sql()`UPDATE builder_profiles SET x_user_id = NULL, x_handle = NULL WHERE builder_id IN ${sql()([T + 14, T + 15, T + 16])}`;
    if (was === undefined) delete process.env.EARNKIT_BUILDER_SCORE;
    else process.env.EARNKIT_BUILDER_SCORE = was;
  }
});

test('11.10 the card at /<handle>/card.png has the image policy, as /b/<name>/card.png', () => {
  const config = readFileSync(join(import.meta.dirname, '../../next.config.ts'), 'utf8');
  assert.match(config, /source: '\/:handle\/card\.png',\s*headers: \[\{ key: 'Content-Security-Policy', value: IMAGE_CSP \}\]/);
});
