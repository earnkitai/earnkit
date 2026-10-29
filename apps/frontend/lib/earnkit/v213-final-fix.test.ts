import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { benchRows } from './bench-data';
import { chainPools } from './bench-rank';
import { carouselCards, feedWeeks, rankFeed } from './feed';
import { mainProjectOf, pickMainProject, setMainProject } from './main-project';
import { UPDATE_LIMIT_NOTE, UPDATE_POSTS_PER_DAY, postUpdate } from './updates';
import { TELL_DESCRIPTION_BENCH, toolDescriptions } from './mcp';
import BenchView from '../../app/leaderboard/BenchView';
import HomeView from '../../app/HomeView';
import { homeFixture } from './fixtures/landing';
import { GET as llms } from '../../app/llms.txt/route';

/**
 * v2.13 final fix wave (final-review.md I1, I2, I3, M1, M2, M4, M7 and the EARNKIT_RAISING ruling).
 * Every row this file writes carries a per-run key and goes in `after`.
 */
process.env.EARNKIT_AUTH_SECRET ||= 'v213-final-fix-secret';
(globalThis as { React?: typeof React }).React = React;
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const RUN = randomBytes(3).toString('hex');
const NOW = new Date('2026-10-21T12:00:00Z'); // a Wednesday; the last finished week is 2026-10-12
const made: number[] = [];

after(async () => {
  if (!process.env.DATABASE_URL) return;
  try {
    if (made.length) {
      const db = sql();
      await db`DELETE FROM project_updates WHERE builder_id IN ${db(made)}`;
      await db`DELETE FROM projects WHERE installation_id IN ${db(made)}`;
      // source_readings is append-only: its rows stay (keyed by source id only).
      await db`DELETE FROM builder_sources WHERE builder_id IN ${db(made)}`;
      await db`DELETE FROM builder_projects WHERE builder_id IN ${db(made)}`;
      await db`DELETE FROM builder_live WHERE builder_id IN ${db(made)}`;
      await db`DELETE FROM proof_line_issues WHERE installation_id IN ${db(made)}`;
      await db`DELETE FROM github_verify_nonces WHERE installation_id IN ${db(made)}`;
      await db`DELETE FROM builder_profiles WHERE builder_id IN ${db(made)}`;
      await db`DELETE FROM installations WHERE id IN ${db(made)}`;
    }
  } finally {
    await sql().end();
  }
});

async function installation(): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v213-fix-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  made.push(id);
  return id;
}

/**
 * One listed, ranked builder whose one project is the repo `key`, confirmed by its own proof line
 * (a verified repo source). `name` is the project's stored name; `public` adds today's public reading.
 */
async function listed(o: { name?: string; public?: boolean; chains?: string[]; update?: boolean; score?: number } = {}) {
  const id = await installation();
  const key = `fx${RUN}/repo${id}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, x_user_id, x_handle, x_name) VALUES (${id}, ${`v213fx-${id}`}, ${key}, ${`fxx${id}`}, ${`fx${RUN}${id}`}, 'Maya')`;
  await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at) VALUES (${id}, ${o.score ?? 50}, '{}'::jsonb, true, 1, 0, 'v2', 'v2-shipping', now())`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, chains) VALUES (${id}, ${key}, ${o.name ?? `repo${id}`}, 'app', true, true, ${o.chains ?? []})`;
  const [{ sid }] = await sql()<{ sid: number }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent') RETURNING id::int AS sid`;
  if (o.public) await sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${sid}, ${new Date().toISOString().slice(0, 10)}, '{"private": false}'::jsonb, true)`;
  if (o.update) await sql()`INSERT INTO project_updates (builder_id, project_key, week, text, facts) VALUES (${id}, ${key}, '2026-10-12', 'Went live.', '{"went_live": true}'::jsonb)`;
  return { id, key, sid };
}

// ---- I1: a private repo's name never reaches the Bench, the feed or the landing carousel ----------

test('F1 a private main repo shows the safe name on /bench, /feed and the carousel; a public one keeps its name', dbTest, async () => {
  const secret = await listed({ name: 'secret-plans', update: true, score: 60 });
  await sql()`UPDATE builder_projects SET name = ${secret.key.split('/')[1]} WHERE builder_id = ${secret.id}`;
  const open = await listed({ name: 'Open app', public: true, update: true, score: 40 });
  const only = [secret.id, open.id];
  const bench = await benchRows({ chain: null, weekly: false }, { only });
  assert.deepEqual(bench.rows.map((r) => r.project), ['Private project', 'Open app']);
  await rankFeed(NOW);
  const feed = (await feedWeeks(NOW, { only })).flatMap((w) => w.cards);
  assert.deepEqual(feed.map((c) => c.project).sort(), ['Open app', 'Private project']);
  assert.ok(!JSON.stringify(feed).includes(secret.key.split('/')[1]), 'the repo name is nowhere in the feed');
  const carousel = await carouselCards(NOW, { only });
  assert.deepEqual(carousel.map((c) => c.project).sort(), ['Open app', 'Private project']);
  // The landing's top 10 is benchRows (landing.ts readBench): the same safe name.
  assert.ok(!JSON.stringify(bench.rows).includes(secret.key.split('/')[1]));
});

// ---- I2: the lazy pick takes only a Bench-confirmed project; the proof names its repo ------------

test('F2 the lazy pick: nothing Bench-confirmed leaves it unset; a confirmed row without the repo\'s own proof is never picked', dbTest, async () => {
  const id = await installation();
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`v213fx-${id}`})`;
  const k = (s: string) => `pk${RUN}/${s}${id}`;
  // A coin or entry naming the repo: confirmed, but not the repo's own proof (benchConfirmedSql).
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people) VALUES (${id}, ${k('named')}, 'n', 'app', true, true, 90)`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people) VALUES (${id}, ${k('agent')}, 'a', 'app', false, true, 99)`;
  assert.equal(await pickMainProject(id, sql()), null);
  assert.equal(await mainProjectOf(id), null, 'left for the project the agent names next');
  // The agent names its folder's repo: that one is the one project.
  assert.deepEqual(await setMainProject(id, { name: 'Mine', what: null, repo: k('mine'), live_url: null, package: null, contracts: [] }), { key: k('mine'), set: true });

  const other = await installation();
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${other}, ${`v213fx-${other}`})`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people) VALUES (${other}, ${k('busy')}, 'b', 'app', false, true, 500)`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people) VALUES (${other}, ${k('proven')}, 'p', 'app', true, true, 3)`;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${other}, 'repo', ${k('proven')}, ${k('proven')}, 'verified', 'proof_line', 'agent')`;
  assert.equal(await pickMainProject(other, sql()), k('proven'));
});

test('F6 the Bench gate is read now: a lost repo proof leaves /bench, the chain pool and the feed before the next rescore', dbTest, async () => {
  const a = await listed({ public: true, chains: ['base'], update: true });
  const b = await listed({ public: true, chains: ['base'], update: true });
  const only = [a.id, b.id];
  await rankFeed(NOW);
  assert.equal((await benchRows({ chain: null, weekly: false }, { only })).count, 2);
  // The repo source is rejected; builder_live.ranked is still true (no rescore yet).
  await sql()`UPDATE builder_sources SET state = 'rejected' WHERE id = ${b.sid}`;
  const after = await benchRows({ chain: null, weekly: false }, { only });
  assert.equal(after.count, 1);
  assert.deepEqual(after.rows.map((r) => r.rank), [1]);
  assert.equal((await chainPools({ only })).base, 1);
  const feed = (await feedWeeks(NOW, { only })).flatMap((w) => w.cards);
  assert.deepEqual(feed.map((c) => c.handle), [`fx${RUN}${a.id}`]);
});

// ---- M2: tell update has a per-person daily limit ------------------------------------------------

test('F7 tell update: at most 20 posts a person a day, then a plain note', dbTest, async () => {
  const id = await installation();
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`v213fx-${id}`})`;
  const now = new Date();
  for (let i = 0; i < UPDATE_POSTS_PER_DAY; i++) assert.notEqual((await postUpdate(id, 'Shipped.', now)).agent_note, UPDATE_LIMIT_NOTE);
  const r = await postUpdate(id, 'Shipped.', now);
  assert.deepEqual(r, { show_to_builder: '', agent_note: UPDATE_LIMIT_NOTE });
  assert.ok(!UPDATE_LIMIT_NOTE.includes('—'));
});

// ---- v4.0 Task 11: no raising anywhere, whatever EARNKIT_RAISING says -----------

test('F11 the Bench, the landing, tell\'s description and llms.txt name no raising (v4.0 Task 11: EARNKIT_RAISING is read nowhere)', async () => {
  const row = { rank: 1, line: '#1 of 2', points: 62, handle: 'maya', name: 'Maya', avatar: null, chains: [], project: 'Recipe planner', best: 'Live', streak: 0 };
  const filter = { chain: null, weekly: false };
  for (const on of ['on', undefined]) {
    if (on) process.env.EARNKIT_RAISING = on;
    else delete process.env.EARNKIT_RAISING;
    // Launch-ready L3: the leaderboard has no community round chip.
    const board = renderToStaticMarkup(React.createElement(BenchView, { rows: [row], count: 2, chips: [], filter, page: 1 }));
    assert.ok(!board.includes('Community round') && !board.includes('raising=1') && !board.includes('Backed'));
    // R18, v3.1 Task 6: the landing (no leaderboard rows any more) names no community round.
    assert.ok(!/community round/i.test(renderToStaticMarkup(React.createElement(HomeView, { landing: homeFixture }))));
    assert.equal(toolDescriptions(false).tell, TELL_DESCRIPTION_BENCH);
    assert.ok(!/raising|backing|\bcoin/i.test(TELL_DESCRIPTION_BENCH));
    const text = await (await llms()).text();
    assert.ok(!/raising|community round|\bcoin|Backing|- confirm/i.test(text), 'llms.txt');
    assert.ok(text.includes('with chain and weekly filters.'));
  }
  delete process.env.EARNKIT_RAISING;
});
