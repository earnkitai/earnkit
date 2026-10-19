import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { BADGE_CACHE, BADGE_MISS_CACHE, badgeFor, badgeMarkdown, badgeSvg, badgeValue, textWidth } from './badge';
import { DATA } from './fixtures/profile-data';
import { isReserved } from './reserved-routes';
import BenchProfileView from '../../app/[handle]/BenchProfileView';
import { BADGE_COPY_LINE } from '../../app/[handle]/BadgeCopy';
import { GET } from '../../app/badge/[file]/route';

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
  assert.equal(badgeValue({ rank: '#3 of 40 builders this week', score: 72 }), 'Shipping 72 · #3');
  assert.equal(badgeValue({ rank: 'Top 4% of builders this week', score: 88 }), 'Shipping 88 · Top 4%');
  assert.equal(badgeValue({ rank: null, score: 72 }), 'not ranked');
});

test('L8 the SVG: shields-like, brand colors, sized to its text, text escaped, labelled for screen readers', () => {
  const svg = badgeSvg('Shipping 72 · #3');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="20" role="img" aria-label="EarnKit: Shipping 72 · #3">/);
  assert.match(svg, /<title>EarnKit: Shipping 72 · #3<\/title>/);
  assert.ok(svg.includes('fill="#0F1839"') && svg.includes('fill="#579DFF"'), 'navy label, bright blue value');
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

test('L8 the profile offers the markdown, quietly, under the sources line', () => {
  const h = renderToStaticMarkup(React.createElement(BenchProfileView, { data: DATA, tab: 'log' }));
  assert.ok(h.includes(BADGE_COPY_LINE));
  assert.ok(h.includes(badgeMarkdown(DATA.handle).replace(/&/g, '&amp;')), 'the markdown is shown');
  assert.match(h, /aria-label="Copy the badge markdown"/);
  assert.equal(BADGE_COPY_LINE, 'Add the badge to your README');
});

test('L8 a listed builder\'s badge has their score and rank; unlisted (held or hidden) shows no rank or 404; unknown is a 404 badge', dbTest, async () => {
  const a = await listed(41);
  const b = await listed(30);
  const only = [a.id, b.id];
  assert.deepEqual(await badgeFor(`${b.handle}.svg`, { only }), { status: 200, svg: badgeSvg('Shipping 30 · #2') });
  // Another case serves the same badge (a README written in lowercase keeps working).
  assert.equal((await badgeFor(`${b.handle.toLowerCase()}.svg`, { only })).svg, badgeSvg('Shipping 30 · #2'));
  // Held: still their page, but no public rank (the profile header's rule), so no score either.
  await sql()`UPDATE builder_profiles SET held = true WHERE builder_id = ${b.id}`;
  assert.deepEqual(await badgeFor(`${b.handle}.svg`, { only }), { status: 200, svg: badgeSvg('not ranked') });
  await sql()`UPDATE builder_profiles SET held = false WHERE builder_id = ${b.id}`;
  // Hidden: no page, so a 404 badge.
  await sql()`UPDATE builder_profiles SET hidden = true WHERE builder_id = ${b.id}`;
  assert.deepEqual(await badgeFor(`${b.handle}.svg`, { only }), { status: 404, svg: badgeSvg('not found', { muted: true }) });
  await sql()`UPDATE builder_profiles SET hidden = false WHERE builder_id = ${b.id}`;
  assert.equal((await badgeFor(`nobody${RUN}.svg`)).status, 404);
  assert.equal((await badgeFor(`${b.handle}.png`)).status, 404, 'only .svg');
  assert.equal((await badgeFor('a b<c>.svg')).status, 404, 'never a malformed handle');
});

test('L8 the route: an SVG, cached an hour for a badge and 10 minutes for a miss', dbTest, async () => {
  const a = await listed(12);
  const ok = await GET(new Request('https://earnkit.com/x'), { params: Promise.resolve({ file: `${a.handle}.svg` }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
  assert.equal(ok.headers.get('cache-control'), BADGE_CACHE);
  assert.match(ok.headers.get('cache-control')!, /s-maxage=3600/);
  assert.match(await ok.text(), /aria-label="EarnKit: Shipping 12 · (#\d+|Top [\d.]+%)"/);
  const miss = await GET(new Request('https://earnkit.com/x'), { params: Promise.resolve({ file: `nobody${RUN}.svg` }) });
  assert.equal(miss.status, 404);
  assert.equal(miss.headers.get('cache-control'), BADGE_MISS_CACHE);
  assert.match(await miss.text(), /EarnKit: not found/);
});
