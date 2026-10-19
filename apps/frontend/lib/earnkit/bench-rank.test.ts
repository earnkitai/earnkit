import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { chainPools, rankLines } from './bench-rank';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = randomBytes(3).toString('hex');

async function listed(score: number, chains: string[]): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v213-br-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  const key = `b${RUN}/p${id}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, x_user_id, x_handle) VALUES (${id}, ${`v213b-${id}`}, ${key}, ${`bx${id}`}, ${`b${RUN}${id}`})`;
  await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at) VALUES (${id}, ${score}, '{}'::jsonb, true, 1, 0, 'v2', 'v2-shipping', now())`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, chains) VALUES (${id}, ${key}, 'P', 'app', true, true, ${chains})`;
  // Final fix M1: the pool reads the Bench gate (the repo's own proof) now.
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent')`;
  return id;
}

test('7.4 R16e a chain\'s line shows from one ranked project on it, in the main rank\'s words; the main line uses the whole pool and carries the score line', dbTest, async () => {
  const base: number[] = [];
  for (let i = 0; i < 10; i++) base.push(await listed(50 + i, ['base']));
  const arc: number[] = [];
  for (let i = 0; i < 9; i++) arc.push(await listed(40 + i, ['arc']));
  const me = base[9]; // the top Base score (59)
  const only = [...base, ...arc];
  const pools = await chainPools({ only });
  assert.equal(pools.base, 10);
  assert.equal(pools.arc, 9);
  assert.equal(pools.robinhood, 0);
  const lines = await rankLines(me, { only });
  assert.equal(lines.bench, '#1 of 19 builders this week');
  assert.equal(lines.line, 'Shipping 59 · #1 of 19 builders this week');
  assert.deepEqual(lines.chains, [{ chain: 'base', label: 'Base', line: '#1 of 10 builders on Base this week' }]);
  const arcTop = arc[8];
  assert.deepEqual((await rankLines(arcTop, { only })).chains, [{ chain: 'arc', label: 'Arc', line: '#1 of 9 builders on Arc this week' }], 'no 10-builder minimum');
  const low = base[0]; // score 50: behind the 9 higher Base scores, ahead of all 9 Arc scores
  assert.equal((await rankLines(low, { only })).bench, '#10 of 19 builders this week');
  assert.deepEqual((await rankLines(low, { only })).chains, [{ chain: 'base', label: 'Base', line: '#10 of 10 builders on Base this week' }], 'every ranked builder sees a rank');
});

test('hotfix 2026-10-19: a public rank shows only inside the leaderboard pool (held, hidden or unlisted: none); the reply keeps its place', dbTest, async () => {
  const { benchRows } = await import('./bench-data');
  const { personFacts } = await import('./page-data');
  const { standingOf } = await import('./person-score');
  const a = await listed(30, []);
  const b = await listed(20, []);
  const only = [a, b];
  assert.equal((await rankLines(b, { only })).bench, '#2 of 2 builders this week');
  assert.equal((await personFacts(b, { only }))?.rank, '#2 of 2 builders this week');
  for (const [what, set, unset] of [
    ['held', sql()`UPDATE builder_profiles SET held = true WHERE builder_id = ${b}`, sql()`UPDATE builder_profiles SET held = false WHERE builder_id = ${b}`],
    ['hidden', sql()`UPDATE builder_profiles SET hidden = true WHERE builder_id = ${b}`, sql()`UPDATE builder_profiles SET hidden = false WHERE builder_id = ${b}`],
    ['pending', sql()`UPDATE builder_live SET pending = '{}'::jsonb WHERE builder_id = ${b}`, sql()`UPDATE builder_live SET pending = NULL WHERE builder_id = ${b}`],
  ] as const) {
    await set;
    const board = await benchRows({ chain: null, raising: false, weekly: false }, { only });
    assert.deepEqual(board.rows.map((r) => r.rank), [1], `${what}: off the leaderboard`);
    assert.deepEqual(await rankLines(b, { only }), { bench: null, line: null, chains: [] }, `${what}: no rank on the profile`);
    assert.equal((await personFacts(b, { only }))?.rank, null, `${what}: no rank in the header or card`);
    const s = await standingOf(b, { only });
    assert.deepEqual([s.ranked, s.listed, s.rank], [true, false, 2], `${what}: the private reply still has a place`);
    await unset;
  }
  assert.equal((await rankLines(b, { only })).bench, '#2 of 2 builders this week');
});
