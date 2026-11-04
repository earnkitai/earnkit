import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { programFixture } from './fixtures/program';
import { listOpenPrograms, upsertProgram } from './programs';
import { openMoneyUsd, readStats, statsGet, STATS_KEYS } from './stats';

after(() => sql().end());

const NOW = new Date('2026-11-04T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

test('the nine keys, in order', async () => {
  const s = await readStats(NOW);
  assert.deepEqual(Object.keys(s), ['programs_open', 'open_money_usd', 'installs', 'installs_active_7d', 'finds_7d', 'applications', 'applications_7d', 'won', 'won_usd']);
  assert.deepEqual(Object.keys(s), [...STATS_KEYS]);
});

test('programs and money come from the open programs; investments are left out of the money', async () => {
  const before = await readStats(NOW);
  await upsertProgram(programFixture({ id: 'zz-stat-grant', max_award_usd: 7000, ends_at: '2027-01-01T00:00:00Z' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'zz-stat-invest', investment: true, max_award_usd: 500_000, ends_at: '2027-01-01T00:00:00Z' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'zz-stat-shut', status: 'closed', max_award_usd: 9000 }), 'file', NOW);
  const after = await readStats(NOW);
  assert.equal(after.programs_open - before.programs_open, 2);
  assert.equal(after.open_money_usd - before.open_money_usd, 7000);
  assert.equal(after.open_money_usd, openMoneyUsd(await listOpenPrograms(NOW)));
});

test('installs, finds and applications count what happened, with their windows', async () => {
  const db = sql();
  const before = await readStats(NOW);
  const ids: number[] = [];
  for (const [seen, find] of [[ago(1), ago(2)], [ago(20), ago(10)], [ago(3), null]] as const) {
    const [r] = await db<{ id: number }[]>`
      INSERT INTO installations (token_hash, last_seen_at, last_find_at) VALUES (${`stat-${Math.random()}`}, ${seen}, ${find}) RETURNING id`;
    ids.push(r.id);
  }
  const app = (i: number, program: string, status: string, at: Date, amount: number | null = null) =>
    db`INSERT INTO applications (installation_id, program_id, status, amount_usd, at) VALUES (${ids[i]}, ${program}, ${status}, ${amount}, ${at})`;
  await app(0, 'p1', 'applied', ago(1));
  await app(0, 'p2', 'won', ago(2), 500);
  await app(1, 'p1', 'rejected', ago(30));
  await app(1, 'p2', 'no_result', ago(9));
  await app(2, 'p1', 'skipped', ago(1));
  await app(2, 'p2', 'gap_done', ago(1));
  await app(2, 'p3', 'won', ago(20), 250.5);
  const now = await readStats(NOW);
  assert.equal(now.installs - before.installs, 3);
  assert.equal(now.installs_active_7d - before.installs_active_7d, 2);
  assert.equal(now.finds_7d - before.finds_7d, 1);
  assert.equal(now.applications - before.applications, 5);
  assert.equal(now.applications_7d - before.applications_7d, 2);
  assert.equal(now.won - before.won, 2);
  assert.equal(now.won_usd - before.won_usd, 750.5);
  for (const v of Object.values(now)) assert.equal(typeof v, 'number');
});

test('statsGet answers the nine keys, and a failed read is a 503 that is never cached', async () => {
  const ok = await statsGet(() => readStats(NOW));
  assert.equal(ok.status, 200);
  assert.equal(Object.keys((await ok.json()) as object).length, 9);
  const bad = await statsGet(async () => {
    throw new Error('db down');
  });
  assert.equal(bad.status, 503);
  assert.equal(bad.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys((await bad.json()) as object), ['error']);
});
