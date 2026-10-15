import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { profileData, type ProfileData } from './bench-data';
import { DATA } from './fixtures/profile-data';
import BenchProfileView, { BENCH_SOURCES_LINE, CONFIRMING_LINE, LOG_EMPTY, TAB_LOG, TAB_PROJECT, streakWords } from '../../app/[handle]/BenchProfileView';
import Avatar from '../../app/[handle]/Avatar';

/** v2.13 T11 (spec "Profile", R10, R11, R12): the page at earnkit.com/<x-handle> under the Bench flag. */

process.env.EARNKIT_BUILDER_SCORE = 'on';
process.env.EARNKIT_BENCH = 'on';
// The components are compiled with the classic JSX runtime here (as feed.test.ts).
(globalThis as { React?: typeof React }).React = React;
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const RUN = randomBytes(3).toString('hex');
const made: number[] = [];
// No test leaves shared state behind: every row this file wrote goes, children first.
after(async () => {
  if (!process.env.DATABASE_URL) return;
  if (made.length) {
    const db = sql();
    await db`DELETE FROM project_updates WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM source_live WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id IN ${db(made)})`;
    await db`DELETE FROM builder_sources WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM builder_projects WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM builder_live WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM builder_profiles WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM installations WHERE id IN ${db(made)}`;
  }
  await sql().end();
});
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'");


test('11.1 the header: photo, name, @handle, pill, the Bench line then each chain line with its logo', () => {
  const h = html(React.createElement(BenchProfileView, { data: DATA, tab: 'log' }));
  for (const s of ['Maya Chen', '@maya_makes', 'Raising $RECIPE', 'Top 4% on the Bench', 'Top 1% on Base']) assert.ok(h.includes(s), s);
  assert.ok(h.indexOf('Top 4% on the Bench') < h.indexOf('Top 1% on Base'));
  assert.match(h, /alt="Base"/);
});

test('11.2 the score parts, each out of its weight; the grid has 52 squares and the streak beside it', () => {
  const h = html(React.createElement(BenchProfileView, { data: DATA, tab: 'log' }));
  for (const s of ['Shipped 15 of 20', 'Used 24 of 40', 'Earned 8 of 20', 'Consistency 15 of 20', '6 weeks in a row']) assert.ok(h.includes(s), s);
  assert.equal((h.match(/data-week=/g) ?? []).length, 52);
  assert.equal((h.match(/data-on="true"/g) ?? []).length, 6);
  assert.equal(streakWords(1), '1 week in a row');
  assert.equal(streakWords(0), null);
});

test('11.3 the Ship log tab is the default: long cards newest first, chips alone for a facts-only week, the Started card last', () => {
  const h = html(React.createElement(BenchProfileView, { data: DATA, tab: 'log' }));
  assert.ok(h.includes(TAB_LOG) && h.includes(TAB_PROJECT));
  assert.match(h, /aria-current="page"[^>]*>Ship log/);
  // The grid's squares carry week titles too: read the order inside the log only.
  const log = h.slice(h.indexOf('data-shape="long"'));
  const order = ['Week of Oct 12', 'Week of Oct 5', 'Started tracking Recipe planner.'].map((s) => log.indexOf(s));
  assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], order.join(','));
  assert.equal((h.match(/data-shape="long"/g) ?? []).length, 3);
  assert.ok(h.includes(BENCH_SOURCES_LINE));
  assert.doesNotMatch(h, /written by|agent/i, 'R6');
  assert.ok(html(React.createElement(BenchProfileView, { data: { ...DATA, log: [] }, tab: 'log' })).includes(LOG_EMPTY));
});

test('11.4 the Project tab: name, what, links, chains, people, money, the coin, programs entered and won, ways to get funded', () => {
  const h = html(React.createElement(BenchProfileView, { data: DATA, tab: 'project' }));
  for (const s of ['Recipe planner', 'a recipe planner', 'https://recipes.app', 'https://github.com/maya/recipes', '31 people use it', '$120 earned', '$RECIPE on tokens.fun', 'Won Base Builder Grants', 'Ways to get funded', 'Avalanche Team1 Mini Grants pays up to $10K'])
    assert.ok(h.includes(s), s);
  assert.match(h, /aria-current="page"[^>]*>Project/);
});

test('11.5 the photo falls back to the initials when it fails to load', async () => {
  const h = renderToStaticMarkup(React.createElement(Avatar, { src: 'https://pbs.twimg.com/x.jpg', handle: 'maya_makes' }));
  assert.match(h, /<img[^>]+src="https:\/\/pbs\.twimg\.com\/x\.jpg"/);
  assert.match(renderToStaticMarkup(React.createElement(Avatar, { src: null, handle: 'maya_makes' })), />M</);
  const src = (await import('node:fs')).readFileSync(new URL('../../app/[handle]/Avatar.tsx', import.meta.url), 'utf8');
  assert.match(src, /'use client'/);
  assert.match(src, /onError=/);
});

/** A claimed person whose one project is `key`; `proof`: the repo's own proof line, so the Bench counts it confirmed. */
async function person(key: string, o: { proof?: boolean; named?: string } = {}): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v213-prof-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  made.push(id);
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, x_user_id, x_handle, x_name) VALUES (${id}, ${`v213p-${id}`}, ${key}, ${`px${id}`}, ${`pr${RUN}${id}`.slice(0, 15)}, 'Maya Chen')`;
  // The agent's own name for the project (identity): shown even while the repo can't be read as public.
  if (o.named) await sql()`UPDATE builder_profiles SET identity = ${sql().json({ projects: [{ name: o.named }] } as never)} WHERE builder_id = ${id}`;
  if (o.proof ?? true)
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent')`;
  return id;
}

test('11.6 profileData reads the page from stored rows: hidden updates never, the Started card from facts.started', dbTest, async () => {
  const key = `pr${RUN}/recipes`;
  const id = await person(key, { named: 'Recipe planner' });
  // The repo reads as public today: it is named and linked.
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at) SELECT id, '{"private": false}'::jsonb, true, now() FROM builder_sources WHERE builder_id = ${id}`;
  await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at)
    VALUES (${id}, 62, ${sql().json({ shipped: { points: 15 }, used: { points: 24 }, earned: { points: 8 }, consistency: { points: 15 } } as never)}, true, 1, 0, 'v2', 'v2-launch', now())`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, what, kind, confirmed, shipped, streak, ship_weeks) VALUES (${id}, ${key}, 'Recipe planner', 'a recipe planner', 'app', true, true, 2, ${['2026-W41', '2026-W42']})`;
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, text, facts) VALUES
    (${id}, ${key}, '2026-10-12', 'Shipped.', ${sql().json({ shipped_code: { n: 2 } } as never)}),
    (${id}, ${key}, '2026-10-05', 'Hidden.', '{}'::jsonb),
    (${id}, ${key}, '2026-09-28', NULL, ${sql().json({ started: { live: true, weeks: 1, people: 0 } } as never)}),
    (${id}, ${key}, '2026-09-21', NULL, '{}'::jsonb)`;
  await sql()`UPDATE project_updates SET hidden = true WHERE project_key = ${key} AND week = '2026-10-05'`;
  const d = (await profileData(id, new Date('2026-10-14T00:00:00Z')))!;
  assert.deepEqual(d.log.map((c) => c.week), ['2026-10-12', '2026-09-28'], 'hidden and empty weeks never show');
  assert.equal(d.log[1].started, 'Started tracking Recipe planner.');
  assert.deepEqual(d.log[1].chips, ['Live', '1 week shipping']);
  assert.deepEqual(d.log[0].chips, ['2 commits']);
  assert.deepEqual(d.parts.map((p) => [p.label, p.points, p.max]), [['Shipped', 15, 20], ['Used', 24, 40], ['Earned', 8, 20], ['Consistency', 15, 20]]);
  assert.equal(d.grid.length, 52);
  assert.equal(d.grid.filter((g) => g.on).length, 2);
  assert.deepEqual(d.grid.slice(-2), [{ week: '2026-W41', on: true }, { week: '2026-W42', on: true }]);
  assert.equal(d.streak, 2);
  assert.equal(d.name, 'Maya Chen');
  assert.equal(d.initials, 'P');
  assert.equal(d.project?.name, 'Recipe planner');
  assert.equal(d.project?.repo, `https://github.com/${key}`);
  assert.equal(d.project?.confirmed, true);
});

test('11.6b the Started card is the oldest when a week has both; a repo that does not read as public is never named or linked', dbTest, async () => {
  const key = `pr${RUN}/fresh`;
  const id = await person(key);
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, ${key}, 'Fresh app', 'app', true, true)`;
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, text, facts) VALUES
    (${id}, ${key}, '2026-10-12', 'First week.', ${sql().json({ shipped_code: { n: 1 }, started: { live: false, weeks: 0, people: 0 } } as never)})`;
  const d = (await profileData(id, new Date('2026-10-14T00:00:00Z')))!;
  assert.deepEqual(d.log.map((c) => [c.week, c.text, c.started ?? null]), [['2026-10-12', 'First week.', null], ['2026-10-12', null, 'Started tracking Private project.']]);
  assert.equal(d.project?.name, 'Private project', 'v2.12.1 shownProjects: no public reading, not the agent\'s own name');
  assert.equal(d.project?.repo, null);
  assert.equal(d.score, null, 'no rank line: never a bare ring');
  assert.equal(d.bench, null);
  assert.equal(d.streak, 0);
});

test('11.8 a one project not yet confirmed by its repo shows the confirming line instead of the log, and no numbers', dbTest, async () => {
  const key = `pr${RUN}/notmine`;
  const id = await person(key, { proof: false });
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people, money_usd) VALUES (${id}, ${key}, 'Not mine', 'app', true, true, 40, 500)`;
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, text, facts) VALUES (${id}, ${key}, '2026-10-12', 'Claimed.', ${sql().json({ shipped_code: { n: 3 } } as never)})`;
  const d = (await profileData(id, new Date('2026-10-14T00:00:00Z')))!;
  assert.equal(d.project?.confirmed, false);
  assert.deepEqual(d.log, []);
  assert.equal(d.project?.people, null);
  assert.equal(d.project?.money, null);
  const h = html(React.createElement(BenchProfileView, { data: d, tab: 'log' }));
  assert.ok(h.includes(CONFIRMING_LINE));
  assert.doesNotMatch(h, /Claimed\./);
});

test('11.9 the grid titles each square with its week\'s Monday (week keys go through mondayOfWeek)', () => {
  const h = html(React.createElement(BenchProfileView, { data: { ...DATA, grid: [{ week: '2026-W42', on: true }] }, tab: 'log' }));
  assert.match(h, /data-week="2026-W42" data-on="true" title="Week of Oct 12"/);
});

test('11.10 a new profile: no ring without a rank line, no raising, no chain lines; the Project tab without a project says so', () => {
  const fresh: ProfileData = { ...DATA, raising: null, bench: null, chainLines: [], score: null, streak: 0, log: [DATA.log[2]], project: { ...DATA.project!, coin: null, programs: [], funds: [], people: null, money: null } };
  const h = html(React.createElement(BenchProfileView, { data: fresh, tab: 'log' }));
  assert.doesNotMatch(h, /Score \d+ of 100/);
  assert.doesNotMatch(h, /Raising/);
  assert.doesNotMatch(h, /in a row/);
  assert.ok(h.includes('Started tracking Recipe planner.'));
  const none = html(React.createElement(BenchProfileView, { data: { ...fresh, project: null, log: [] }, tab: 'project' }));
  assert.doesNotMatch(none, /Ways to get funded/);
});

test('11.12 the Raising chip shows once, on the newest card (the header carries the pill)', async () => {
  const { logCards } = await import('./bench-data');
  const cards = logCards([
    { week: '2026-10-12', text: 'A', facts: { shipped_code: { n: 1 } } },
    { week: '2026-10-05', text: 'B', facts: { shipped_code: { n: 2 } } },
  ], 'Recipe planner', 'RECIPE');
  assert.deepEqual(cards.map((c) => c.chips), [['1 commit', 'Raising $RECIPE'], ['2 commits']]);
});
