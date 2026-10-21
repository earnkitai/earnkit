import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { BADGE_CACHE, BADGE_MISS_CACHE, badgeFileOk, badgeFor, badgeMarkdown, badgeResponse, badgeSvg, badgeValue, textWidth } from './badge';
import { DATA, siteOf } from './fixtures/profile-data';
import { isReserved } from './reserved-routes';
import BenchProfileView from '../../app/[handle]/BenchProfileView';
import { BADGE_COPY_LINE, COPY_FAILED } from '../../app/[handle]/BadgeCopy';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Launch-ready L8: the README badge at earnkit.com/badge/<handle>.svg and the profile's copy-the-markdown line. */

(globalThis as { React?: typeof React }).React = React;
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const RUN = randomBytes(3).toString('hex');
const made: number[] = [];
after(async () => {
  if (!process.env.DATABASE_URL) return;
  if (made.length) {
    const db = sql();
    await db`DELETE FROM builder_sources WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM builder_projects WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM builder_live WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM builder_profiles WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM installations WHERE id IN ${db(made)}`;
  }
  await sql().end();
});

/** A listed, ranked builder (bench-rank.test.ts's shape): claimed with X, a confirmed one project, a live score. */
async function listed(score: number): Promise<{ id: number; handle: string }> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`badge-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  made.push(id);
  const key = `bd${RUN}/p${id}`;
  const handle = `Bd${RUN}${id % 100000}`.slice(0, 15);
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, x_user_id, x_handle) VALUES (${id}, ${`badge-${id}`}, ${key}, ${`bdx${id}`}, ${handle})`;
  await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at) VALUES (${id}, ${score}, '{}'::jsonb, true, 1, 0, 'v2', 'v2-shipping', now())`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, chains) VALUES (${id}, ${key}, 'P', 'app', true, true, '{}')`;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent')`;
  return { id, handle };
}

test('L8 the value: the score and the rank\'s lead inside the pool, else "not ranked" (never a bare score)', () => {
  assert.equal(badgeValue({ rank: '#3 of 40 builders', score: 72 }), 'Shipping 72 · #3');
  assert.equal(badgeValue({ rank: 'Top 4% of builders', score: 88 }), 'Shipping 88 · Top 4%');
  assert.equal(badgeValue({ rank: null, score: 72 }), 'not ranked');
  // v3.1 F3: in the pool but under RANK_MIN_POOL: the score alone.
  assert.equal(badgeValue({ rank: null, score: 72, listed: true }), 'Shipping 72');
});

test('L8 the SVG: shields-like, brand colors, sized to its text, text escaped, labelled for screen readers', () => {
  const svg = badgeSvg('Shipping 72 · #3');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="20" role="img" aria-label="EarnKit: Shipping 72 · #3">/);
  assert.match(svg, /<title>EarnKit: Shipping 72 · #3<\/title>/);
  // v3 Stage 3 Task 6: the flat system's colours (theme.ts): the label on black, the value on brand blue, white text.
  assert.ok(svg.includes('fill="#000000"') && svg.includes('fill="#0052FF"'), 'black label, brand blue value');
  assert.ok(textWidth('Shipping 100 · Top 12%') > textWidth('not ranked'));
  const wide = Number(/width="(\d+)"/.exec(badgeSvg('Shipping 100 · Top 12%'))![1]);
  const narrow = Number(/width="(\d+)"/.exec(badgeSvg('not ranked'))![1]);
  assert.ok(wide > narrow);
  const evil = badgeSvg('<script>alert("x")</script> & \'y\'');
  assert.doesNotMatch(evil, /<script>|alert\("x"\)/);
  assert.ok(evil.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &apos;y&apos;'));
  assert.doesNotMatch(svg, /—/, 'never an em dash');
});

test('L8 the markdown links the badge to the page; a reserved handle\'s page is /b/<handle>; "badge" is a reserved route', () => {
  assert.equal(badgeMarkdown('maya_makes'), '[![EarnKit](https://earnkit.com/badge/maya_makes.svg)](https://earnkit.com/maya_makes)');
  assert.equal(badgeMarkdown('feed'), '[![EarnKit](https://earnkit.com/badge/feed.svg)](https://earnkit.com/b/feed)');
  assert.equal(isReserved('badge'), true);
  assert.equal(isReserved('Badge'), true);
});

test('L8 v3.1 (plan S15): the badge left the profile; the route and the markdown stay', () => {
  const h = renderToStaticMarkup(React.createElement(BenchProfileView, { data: DATA, site: siteOf(DATA), page: 1 }));
  assert.ok(!h.includes(BADGE_COPY_LINE));
  assert.doesNotMatch(h, /\/badge\/|Copy the badge markdown/);
  assert.equal(BADGE_COPY_LINE, 'Badge for your README');
});

test('L8 a listed builder\'s badge has their score and rank; unlisted (held or hidden) shows no rank or not found; unknown is the not-found badge', dbTest, async () => {
  const a = await listed(41);
  const b = await listed(30);
  // v3.1 F3: two ranked builders, under RANK_MIN_POOL: the score alone; 8 more below them and the rank shows.
  assert.deepEqual(await badgeFor(`${b.handle}.svg`, { only: [a.id, b.id] }), { found: true, svg: badgeSvg('Shipping 30') });
  const only = [a.id, b.id];
  for (let i = 0; i < 8; i++) only.push((await listed(10)).id);
  assert.deepEqual(await badgeFor(`${b.handle}.svg`, { only }), { found: true, svg: badgeSvg('Shipping 30 · #2') });
  // Another case serves the same badge (a README written in lowercase keeps working).
  assert.equal((await badgeFor(`${b.handle.toLowerCase()}.svg`, { only })).svg, badgeSvg('Shipping 30 · #2'));
  // Held: still their page, but no public rank (the profile header's rule), so no score either.
  await sql()`UPDATE builder_profiles SET held = true WHERE builder_id = ${b.id}`;
  assert.deepEqual(await badgeFor(`${b.handle}.svg`, { only }), { found: true, svg: badgeSvg('not ranked') });
  await sql()`UPDATE builder_profiles SET held = false WHERE builder_id = ${b.id}`;
  // Hidden: no page, so the not-found badge.
  await sql()`UPDATE builder_profiles SET hidden = true WHERE builder_id = ${b.id}`;
  assert.deepEqual(await badgeFor(`${b.handle}.svg`, { only }), { found: false, svg: badgeSvg('not found', { muted: true }) });
  await sql()`UPDATE builder_profiles SET hidden = false WHERE builder_id = ${b.id}`;
  assert.equal((await badgeFor(`nobody${RUN}.svg`)).found, false);
  assert.equal((await badgeFor(`${b.handle}.png`)).found, false, 'only .svg');
  assert.equal((await badgeFor('a b<c>.svg')).found, false, 'never a malformed handle');
});

test('final fix M6: only an X-handle-shaped name plus .svg is looked up (the route checks before the cache)', async () => {
  for (const ok of ['maya_makes.svg', 'A.svg', 'abcdefghijklmno.SVG']) assert.equal(badgeFileOk(ok), true, ok);
  for (const no of ['abcdefghijklmnop.svg', 'a-b.svg', 'a b.svg', '.svg', 'maya.png', 'maya.svg.svg', '../x.svg', 'm%C3%A9.svg']) assert.equal(badgeFileOk(no), false, no);
  assert.deepEqual(await badgeFor('x'.repeat(200) + '.svg'), { found: false, svg: badgeSvg('not found', { muted: true }) });
  const route = readFileSync(join(import.meta.dirname, '../../app/badge/[file]/route.ts'), 'utf8');
  assert.match(route, /badgeFileOk\(file\) \? await cachedBadge\(file\) : badgeMiss\(\)/);
});

test('L8 fix round 1: the response is always 200 (GitHub\'s image proxy shows it), an SVG, cached an hour or 10 minutes for not found', async () => {
  const ok = badgeResponse({ found: true, svg: badgeSvg('Shipping 12 · #3') });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
  assert.equal(ok.headers.get('cache-control'), BADGE_CACHE);
  assert.match(ok.headers.get('cache-control')!, /s-maxage=3600/);
  assert.match(await ok.text(), /aria-label="EarnKit: Shipping 12 · #3"/);
  const miss = badgeResponse({ found: false, svg: badgeSvg('not found', { muted: true }) });
  assert.equal(miss.status, 200);
  assert.equal(miss.headers.get('cache-control'), BADGE_MISS_CACHE);
  assert.match(await miss.text(), /EarnKit: not found/);
});

test('L8 fix round 1: the route reads the badge through a per-file cache (an hour, PROFILE_TAG); the copy button says when copying failed and clears its timer', () => {
  const dir = join(import.meta.dirname, '../../app/badge/[file]');
  assert.match(readFileSync(join(dir, 'badge-load.ts'), 'utf8'), /unstable_cache\(async \(\) => badgeFor\(file\), \['badge-l8', file\.toLowerCase\(\)\], \{ revalidate: 3600, tags: \[PROFILE_TAG\] \}\)/);
  assert.match(readFileSync(join(dir, 'route.ts'), 'utf8'), /badgeResponse\(badgeFileOk\(file\) \? await cachedBadge\(/);
  const copy = readFileSync(join(import.meta.dirname, '../../app/[handle]/BadgeCopy.tsx'), 'utf8');
  assert.match(copy, /writeText\(md\)\.then\(\(\) => show\('copied'\), \(\) => show\('failed'\)\)/);
  assert.match(copy, /useEffect\(\(\) => \(\) => \{\n\s+if \(timer\.current\) clearTimeout\(timer\.current\);/);
  assert.equal(COPY_FAILED, 'Copy failed');
});
