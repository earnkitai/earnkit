import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { chainPools, rankLines } from './bench-rank';

process.env.EARNKIT_BUILDER_SCORE = 'on';
process.env.EARNKIT_BENCH = 'on';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = randomBytes(3).toString('hex');

async function listed(score: number, chains: string[]): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v213-br-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  const key = `b${RUN}/p${id}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, x_user_id, x_handle) VALUES (${id}, ${`v213b-${id}`}, ${key}, ${`bx${id}`}, ${`b${RUN}${id}`})`;
  await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at) VALUES (${id}, ${score}, '{}'::jsonb, true, 1, 0, 'v2', 'v2-launch', now())`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, chains) VALUES (${id}, ${key}, 'P', 'app', true, true, ${chains})`;
  // Final fix M1: the pool reads the Bench gate (the repo's own proof) now.
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent')`;
  return id;
}

test('7.4 a chain\'s line shows only from 10 ranked projects on it; the Bench line uses the whole pool (review focus 1)', dbTest, async () => {
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
  assert.equal(lines.bench, '#1 of 19 on the Bench');
  assert.deepEqual(lines.chains, [{ chain: 'base', label: 'Base', line: '#1 of 10 on Base' }]);
  const arcTop = arc[8];
  assert.deepEqual((await rankLines(arcTop, { only })).chains, [], 'arc has 9: no chip, no line');
  const low = base[0]; // score 50: behind the 9 higher Base scores, ahead of all 9 Arc scores
  assert.equal((await rankLines(low, { only })).bench, '#10 of 19 on the Bench', '10th of 19 is the top half\'s last place');
  assert.deepEqual((await rankLines(low, { only })).chains, [], '10th of 10 on Base is outside its top half');
});
