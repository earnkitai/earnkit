import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { WEEKLY_STREAK, benchRows, bestFact, filterHref, parseBenchFilter } from './bench-data';
import { pillOf } from './raising';
import BenchView, { BENCH_EMPTY, BENCH_TITLE, FILTER_WEEKLY } from '../../app/leaderboard/BenchView';

/** v2.13 T10 (spec "The Bench", R4, R9, R14): the rows, the URL filters, the /leaderboard redirect. */

// Final fix: the raising pill is behind EARNKIT_RAISING (launch-ready L3: no raising filter); these cases are the flag on (v213-final-fix F9, F11: off).
process.env.EARNKIT_RAISING = 'on';
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
    await db`DELETE FROM projects WHERE installation_id IN ${db(made)}`;
    await db`DELETE FROM builder_sources WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM builder_projects WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM builder_live WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM builder_profiles WHERE builder_id IN ${db(made)}`;
    await db`DELETE FROM installations WHERE id IN ${db(made)}`;
  }
  await sql().end();
});

test('10.1 filters come from the URL; anything unknown is ignored (8 variants at most); launch-ready L3: ?raising=1 is ignored', () => {
  assert.deepEqual(parseBenchFilter({ chain: 'base', raising: '1', weekly: '1' }), { chain: 'base', weekly: true });
  assert.deepEqual(parseBenchFilter({ chain: 'monad', raising: 'yes', weekly: ['1', '1'], page: '9' }), { chain: null, weekly: false });
  assert.deepEqual(parseBenchFilter({ chain: 'Robinhood' }), { chain: 'robinhood', weekly: false });
  assert.equal(filterHref({ chain: 'base', weekly: false }), '/leaderboard?chain=base');
  assert.equal(filterHref({ chain: 'base', weekly: true }), '/leaderboard?chain=base&weekly=1');
  assert.equal(filterHref({ chain: null, weekly: false }), '/leaderboard');
  assert.equal(WEEKLY_STREAK, 4);
});

test('10.2 the best fact in plain words', () => {
  // R16b: never "N people this week".
  assert.equal(bestFact({ streak: 6, weeks_shipping: 9, shipped: true }), '6 weeks in a row');
  assert.equal(bestFact({ streak: 1, weeks_shipping: 9, shipped: true }), '9 weeks shipping');
  assert.equal(bestFact({ streak: 0, weeks_shipping: 0, shipped: true }), 'Live');
  assert.equal(bestFact({ streak: 0, weeks_shipping: 0, shipped: false }), 'Building');
});

/**
 * One listed, ranked builder with a confirmed one project (the repo's own proof, as raising.test.ts).
 * A raising coin is written as a launch writes it (token_repo_key is the normalized repo), so the
 * row's pill is pillOf's.
 */
async function listed(score: number, o: { chains?: string[]; raising?: boolean; streak?: number } = {}): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v213-bench-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  made.push(id);
  const key = `bn${RUN}/p${id}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, x_user_id, x_handle, x_name) VALUES (${id}, ${`v213bn-${id}`}, ${key}, ${`bnx${id}`}, ${`bn${RUN}${id}`}, 'Maya')`;
  await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at) VALUES (${id}, ${score}, '{}'::jsonb, true, 1, 0, 'v2', 'v2-shipping', now())`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, chains, streak) VALUES (${id}, ${key}, 'Recipe planner', 'app', true, true, ${o.chains ?? []}, ${o.streak ?? 0})`;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent')`;
  if (o.raising)
    await sql()`INSERT INTO projects (program_id, name, repo_url, token_repo_key, installation_id, token_symbol, token_status, token_url, raising_at)
      VALUES ('earnkit-coin', 'Recipe planner', ${`https://github.com/${key}`}, ${`github.com/${key}`}, ${id}, 'RECIPE', 'launched', ${`https://tokens.fun/c/${id}`}, now())`;
  return id;
}

test('10.3 chain and weekly filter the rows; ranks are the whole Bench\'s; chips from one ranked project on a chain (R16e)', dbTest, async () => {
  const ids: number[] = [];
  for (let i = 0; i < 10; i++) ids.push(await listed(60 + i, { chains: ['base'], raising: i === 9, streak: i >= 8 ? 5 : 1 }));
  ids.push(await listed(99, { chains: ['arc'] }));
  const all = await benchRows({ chain: null, weekly: false }, { only: ids });
  assert.equal(all.count, 11);
  assert.deepEqual(all.chips, ['base', 'arc'], 'arc has 1: its chip shows (R16e)');
  assert.deepEqual(all.rows.map((r) => r.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(all.rows[0].line, '#1 of 11 builders this week');
  assert.equal(all.rows[10].line, '#11 of 11 builders this week', 'every ranked builder sees a rank');
  // The pill only through pillOf's result.
  for (const [i, id] of ids.entries()) {
    const row = all.rows.find((r) => r.handle === `bn${RUN}${id}`)!;
    assert.deepEqual(row.raising, await pillOf(id), `row ${i}`);
  }
  const base = await benchRows({ chain: 'base', weekly: false }, { only: ids });
  assert.equal(base.rows.length, 10);
  assert.ok(base.rows.every((r) => r.chains.includes('base')));
  assert.equal(base.rows[0].rank, 2, 'the rank is on the whole Bench (the Arc builder is first)');
  assert.deepEqual(base.rows.filter((r) => r.raising).map((r) => r.raising?.symbol), ['RECIPE'], 'the pill stays on its row');
  // Stop raising: the pill goes, the coin stays.
  await sql()`UPDATE projects SET raising_at = NULL WHERE installation_id = ${ids[9]}`;
  assert.ok((await benchRows({ chain: null, weekly: false }, { only: ids })).rows.every((r) => r.raising === null));
  const weekly = await benchRows({ chain: null, weekly: true }, { only: ids });
  assert.equal(weekly.rows.length, 2);
});

test('10.4 the row: photo, name, @handle, pill, chain logos with the name as alt and tooltip, project, best fact, "#N" on the right (R18 fix 1; the rank line to screen readers); the header count line', () => {
  const row = { rank: 2, line: 'Top 4% of builders this week', points: 62, handle: 'maya_makes', name: 'Maya Chen', avatar: null, raising: { symbol: 'RECIPE', url: 'https://tokens.fun/c/1' }, chains: ['base' as const], project: 'Recipe planner', best: '31 people this week' };
  const html = renderToStaticMarkup(React.createElement(BenchView, { rows: [row], count: 25, chips: ['base'], filter: { chain: null, weekly: false } }));
  for (const s of [BENCH_TITLE, 'Maya Chen', '@maya_makes', 'Community round $RECIPE', 'Recipe planner', '31 people this week', '>#2<', 'Top 4% of builders this week', '25 builders this week. Ranked by Shipping points.', FILTER_WEEKLY])
    assert.ok(html.includes(s), s);
  assert.match(html, /<img[^>]+alt="Base"[^>]+title="Base"|<img[^>]+title="Base"[^>]+alt="Base"/);
  assert.match(html, /href="\/leaderboard\?chain=base"/);
  // Launch-ready L3: no community round chip.
  assert.doesNotMatch(html, /raising=1|>Community round</);
  assert.match(html, /href="\/leaderboard\?weekly=1"/);
  assert.doesNotMatch(html, /<form/, 'filters are links');
  // A filter that is on links back to the Bench without it, and says so.
  const on = renderToStaticMarkup(React.createElement(BenchView, { rows: [row], count: 25, chips: ['base'], filter: { chain: 'base', weekly: true } }));
  const link = (h: string, href: string) => h.match(/<a [^>]*>/g)!.find((a) => a.includes(`href="${href}"`)) ?? '';
  assert.match(link(on, '/leaderboard?weekly=1'), /aria-pressed="true"/, 'Base is on: its chip turns it off');
  assert.match(link(on, '/leaderboard?chain=base'), /aria-pressed="true"/, 'Weekly is on: its chip turns it off');
  const off = renderToStaticMarkup(React.createElement(BenchView, { rows: [row], count: 25, chips: ['base'], filter: { chain: 'base', weekly: false } }));
  assert.match(link(off, '/leaderboard?chain=base&amp;weekly=1'), /aria-pressed="false"/);
  // v2.13.2 fix 1: a filtered view with no rows (others ranked) says BENCH_EMPTY; nobody ranked, only the header's empty line.
  assert.ok(renderToStaticMarkup(React.createElement(BenchView, { rows: [], count: 3, chips: [], filter: { chain: 'base', weekly: false } })).includes(BENCH_EMPTY));
  assert.ok(!renderToStaticMarkup(React.createElement(BenchView, { rows: [], count: 0, chips: [], filter: { chain: 'base', weekly: false } })).includes(BENCH_EMPTY));
});
