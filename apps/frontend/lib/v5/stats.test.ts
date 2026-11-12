import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { programFixture } from './fixtures/program';
import { listOpenPrograms, upsertProgram, type ProgramRow } from './programs';
import { openMoneyUsd, readStats, statsGet, STATS_KEYS } from './stats';

after(() => sql().end());

const NOW = new Date('2026-11-04T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

test('the keys, in order (L22-1, v6.1.16: won_other and won_without_amount after won_usd; v6.1.17: last_run_at; v6.1.18: applications_via_earnkit after applications_7d, read_at last)', async () => {
  const s = await readStats(NOW);
  assert.deepEqual(Object.keys(s), ['programs_open', 'open_money_usd', 'installs', 'installs_active_7d', 'finds_7d', 'applications', 'applications_7d', 'applications_via_earnkit', 'won', 'won_usd', 'won_other', 'won_without_amount', 'last_run_at', 'read_at']);
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

test('openMoneyUsd: a stated pool counts first, else the max; an investment nothing', () => {
  const rowOf = (over: Parameters<typeof programFixture>[0]): ProgramRow => {
    const file = programFixture(over);
    return { id: file.id, file, source: 'file', created_at: NOW, updated_at: NOW, verified_at: null, stale_since: null };
  };
  const rows = [
    rowOf({ id: 'm-grant', max_award_usd: 10_000 }),
    rowOf({ id: 'm-hack', pool_usd: 25_000, in_person: true, reward: '$25,000 in prizes' }),
    rowOf({ id: 'm-invest', investment: true, max_award_usd: 400_000 }),
  ];
  assert.equal(openMoneyUsd(rows), 35_000);
  assert.equal(openMoneyUsd([rowOf({ id: 'm-hack-both', max_award_usd: 5000, pool_usd: 25_000, in_person: true })]), 25_000);
  assert.equal(openMoneyUsd([rowOf({ id: 'm-grant-only', max_award_usd: 10_000 })]), 10_000);
  assert.equal(openMoneyUsd([rowOf({ id: 'm-none' })]), 0);
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
    db`INSERT INTO applications (owner, installation_id, program_id, status, amount_usd, at) VALUES (${`i:${ids[i]}`}, ${ids[i]}, ${program}, ${status}, ${amount}, ${at})`;
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
  for (const [k, v] of Object.entries(now)) if (k !== 'last_run_at' && k !== 'read_at') assert.equal(typeof v, k === 'won_other' ? 'object' : 'number', k);
});

test('statsGet answers the fourteen keys, cached 10 minutes, and a failed read is a 503 that is never cached', async () => {
  const ok = await statsGet(() => readStats(NOW));
  assert.equal(ok.status, 200);
  // L36-4 (v6.1.18 Task 5): the header says the route's real cache.
  assert.equal(ok.headers.get('cache-control'), 'public, max-age=600');
  assert.equal(Object.keys((await ok.json()) as object).length, 14);
  const bad = await statsGet(async () => {
    throw new Error('db down');
  });
  assert.equal(bad.status, 503);
  assert.equal(bad.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys((await bad.json()) as object), ['error']);
});

test('L22-1 (v6.1.16): won_usd is the US dollar part only; other currencies are summed per code; a win with no amount is counted', async () => {
  const db = sql();
  const eur = (x: { won_other: { currency: string; amount: number }[] }) => x.won_other.find((o) => o.currency === 'EUR')?.amount ?? 0;
  const before = await readStats(NOW);
  const [r] = await db<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`stat-${Math.random()}`}) RETURNING id`;
  const app = (program: string, amounts: Record<string, number> | null) =>
    db`INSERT INTO applications (owner, installation_id, program_id, status, amount_usd, amounts, at)
      VALUES (${`i:${r.id}`}, ${r.id}, ${program}, 'won', ${amounts?.USD ?? null}, ${amounts ? db.json(amounts) : null}, ${ago(1)})`;
  await app('w1', { USD: 1000 });
  await app('w2', { USD: 2500.5 });
  await app('w3', { EUR: 2000 });
  await app('w4', null);
  const now = await readStats(NOW);
  assert.equal(now.won - before.won, 4);
  assert.equal(now.won_usd - before.won_usd, 3500.5);
  assert.equal(eur(now) - eur(before), 2000);
  assert.equal(now.won_without_amount - before.won_without_amount, 1);
});

// v6.1.17 Task 3 (L30-14, Review Focus 5).
test('L30-14: last_run_at is null before any run, then the last daily run that finished, even 27 hours old', async () => {
  await sql()`DELETE FROM cron_state`;
  assert.equal((await readStats(NOW)).last_run_at, null);
  const old = new Date(NOW.getTime() - 27 * 3_600_000);
  await sql()`INSERT INTO cron_state (id, last_run_at) VALUES (true, ${old})`;
  try {
    assert.equal((await readStats(NOW)).last_run_at, '2026-11-03T09:00:00.000Z');
    const body = (await (await statsGet(() => readStats(NOW))).json()) as { last_run_at: string };
    assert.equal(body.last_run_at, old.toISOString());
  } finally {
    await sql()`DELETE FROM cron_state`;
  }
});

// v6.1.18 Task 5 (L36-3, L36-4).
test('L36-3, L36-4: applications_via_earnkit counts agent sends and builder sends an EarnKit start preceded; read_at is the read time', async () => {
  const db = sql();
  const before = await readStats(NOW);
  const [r] = await db<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`stat-${Math.random()}`}) RETURNING id`;
  const owner = `i:${r.id}`;
  const send = (program: string, by: string | null, sent: Date) =>
    db`INSERT INTO applications (owner, installation_id, program_id, status, submitted_by, at, sent_at) VALUES (${owner}, ${r.id}, ${program}, 'applied', ${by}, ${sent}, ${sent})`;
  const start = (program: string, at: Date) =>
    db`INSERT INTO application_history (owner, installation_id, program_id, status, at) VALUES (${owner}, ${r.id}, ${program}, 'started', ${at})`;
  await send('via-agent', 'agent', ago(2));
  await start('via-drafted', ago(3));
  await send('via-drafted', 'builder', ago(2));
  await send('via-reported', 'builder', ago(2));
  await start('via-late', ago(1));
  await send('via-late', 'builder', ago(2));
  await send('via-unmarked', null, ago(2));
  const t0 = Date.now();
  const now = await readStats(NOW);
  assert.equal(now.applications - before.applications, 5);
  assert.equal(now.applications_via_earnkit - before.applications_via_earnkit, 2, 'the agent send and the drafted one; a start after the send counts nothing');
  assert.ok(Date.parse(now.read_at) >= t0 && Date.parse(now.read_at) <= Date.now(), now.read_at);
});
