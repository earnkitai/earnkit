import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { programFixture } from './fixtures/program';
import { listOpenPrograms, upsertProgram, type ProgramRow } from './programs';
import { openMoneyUsd, readStats, sendCounts, sendRows, statsGet, STATS_KEYS } from './stats';
import { record, saveReport } from './ledger';
import { claim } from '../v6/claims';

after(() => sql().end());

const NOW = new Date('2026-11-04T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

test('the keys, in order (L22-1, v6.1.16: won_other and won_without_amount after won_usd; v6.1.17: last_run_at; v6.1.18: applications_via_earnkit after applications_7d, read_at last; v6.1.19: last_check_ok after last_run_at)', async () => {
  const s = await readStats(NOW);
  assert.deepEqual(Object.keys(s), ['programs_open', 'open_money_usd', 'installs', 'installs_active_7d', 'finds_7d', 'applications', 'applications_7d', 'applications_via_earnkit', 'won', 'won_usd', 'won_other', 'won_without_amount', 'last_run_at', 'last_check_ok', 'read_at']);
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
  for (const [k, v] of Object.entries(now)) if (k !== 'last_run_at' && k !== 'read_at') assert.equal(typeof v, k === 'won_other' ? 'object' : k === 'last_check_ok' ? 'boolean' : 'number', k);
});

test('statsGet answers the fifteen keys, cached 10 minutes, and a failed read is a 503 that is never cached', async () => {
  const ok = await statsGet(() => readStats(NOW));
  assert.equal(ok.status, 200);
  // L36-4 (v6.1.18 Task 5): the header says the route's real cache.
  assert.equal(ok.headers.get('cache-control'), 'public, max-age=600');
  assert.equal(Object.keys((await ok.json()) as object).length, 15);
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
test('L36-3, L36-4: applications_via_earnkit counts agent sends (submitted_by null among them) and builder sends an EarnKit start preceded; read_at is the read clock', async () => {
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
  const now = await readStats(NOW);
  assert.equal(now.applications - before.applications, 5);
  assert.equal(now.applications_via_earnkit - before.applications_via_earnkit, 3, 'the agent send, the unmarked (an agent\'s, L29-23) and the drafted one; a start after the send counts nothing');
  assert.equal(now.read_at, NOW.toISOString());
});

// ---- v6.1.19 Task 1 (lane 42): the owner's count dates a send by its send ----

const statInstall = async () => {
  const [r] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`stat42-${Math.random()}`}) RETURNING id`;
  return r.id;
};

test('L42-1: a win today on a send from 10 days ago is not a send this week', async () => {
  await upsertProgram(programFixture({ id: 'l42-old-send', max_award_usd: 5000 }), 'file', NOW);
  const i = await statInstall();
  const before = await readStats(NOW);
  assert.equal((await record(`i:${i}`, 'l42-old-send', 'applied', { installationId: i, now: ago(10) })).ok, true);
  assert.equal((await record(`i:${i}`, 'l42-old-send', 'won', { installationId: i, amount_usd: 100, now: NOW })).ok, true);
  const now = await readStats(NOW);
  assert.equal(now.applications_7d - before.applications_7d, 0, 'the send was 10 days ago; the win today does not move it');
  assert.equal(now.applications - before.applications, 1);
});

test('L42-2: an outside win has no send date: not in the week, still sent all time', async () => {
  await upsertProgram(programFixture({ id: 'l42-outside', max_award_usd: 5000 }), 'file', NOW);
  const i = await statInstall();
  const before = await readStats(NOW);
  const r = await record(`i:${i}`, 'l42-outside', 'won', { installationId: i, amount_usd: 100, outsideWin: true, now: NOW });
  assert.equal(r.ok && r.outside, true);
  const now = await readStats(NOW);
  assert.equal(now.applications_7d - before.applications_7d, 0, 'an outside win has no send date');
  assert.equal(now.applications - before.applications, 1);
  const db = sql();
  const [row] = await db<{ sent_time: Date | null }[]>`WITH s AS (${sendRows(db)}) SELECT sent_time FROM s WHERE program_id = 'l42-outside'`;
  assert.equal(row.sent_time, null);
});

test('L42-5: a held program sent by the builder counts as reported, not drafted', async () => {
  const db = sql();
  const i = await statInstall();
  await db`INSERT INTO application_history (owner, installation_id, program_id, status, at) VALUES (${`i:${i}`}, ${i}, 'l42-held', 'held', ${ago(3)})`;
  await db`INSERT INTO applications (owner, installation_id, program_id, status, submitted_by, at, sent_at) VALUES (${`i:${i}`}, ${i}, 'l42-held', 'applied', 'builder', ${ago(2)}, ${ago(2)})`;
  await db`INSERT INTO application_history (owner, installation_id, program_id, status, at) VALUES (${`i:${i}`}, ${i}, 'l42-held', 'applied', ${ago(2)})`;
  const [c] = await db<{ drafted: string; reported: string }[]>`
    WITH s AS (${sendRows(db)}) SELECT ${sendCounts(db)} FROM s WHERE program_id = 'l42-held'`;
  assert.deepEqual({ drafted: Number(c.drafted), reported: Number(c.reported) }, { drafted: 0, reported: 1 });
});

test('L42-5 fix round 1: an outside win recorded over an EarnKit claim counts as reported (a null send time is never through EarnKit)', async () => {
  await upsertProgram(programFixture({ id: 'l42-claimed-out', max_award_usd: 5000 }), 'file', NOW);
  const i = await statInstall();
  assert.deepEqual(await claim(`i:${i}`, 'l42-claimed-out', null, i, ago(2)), { ok: true });
  const r = await record(`i:${i}`, 'l42-claimed-out', 'won', { installationId: i, amount_usd: 100, outsideWin: true, now: NOW });
  assert.equal(r.ok && r.outside, true);
  const db = sql();
  const [c] = await db<{ all: string; drafted: string; reported: string }[]>`
    WITH s AS (${sendRows(db)}) SELECT ${sendCounts(db)} FROM s WHERE program_id = 'l42-claimed-out'`;
  assert.deepEqual({ all: Number(c.all), drafted: Number(c.drafted), reported: Number(c.reported) }, { all: 1, drafted: 0, reported: 1 });
});

// v6.1.19 Task 6 (lane 44).
test('L44-10: last_check_ok is false while the latest run failed its link check, true once a run finishes it; last_run_at stays the last finished run', async () => {
  const db = sql();
  await db`DELETE FROM cron_state`;
  try {
    assert.equal((await readStats(NOW)).last_check_ok, true, 'no run yet: nothing failed');
    await db`INSERT INTO cron_state (id, last_run_at, last_check_failed_at) VALUES (true, NULL, ${ago(1)})`;
    assert.deepEqual([(await readStats(NOW)).last_run_at, (await readStats(NOW)).last_check_ok], [null, false]);
    await db`UPDATE cron_state SET last_run_at = ${ago(2)}`;
    assert.deepEqual([(await readStats(NOW)).last_run_at, (await readStats(NOW)).last_check_ok], [ago(2).toISOString(), false]);
    await db`UPDATE cron_state SET last_run_at = ${NOW}`;
    assert.equal((await readStats(NOW)).last_check_ok, true);
  } finally {
    await db`DELETE FROM cron_state`;
  }
});

test('L44-5: applications_7d counts by send time: two sends 8 days ago with results yesterday are not this week', async () => {
  const i = await statInstall();
  for (const id of ['l44-a', 'l44-b']) await upsertProgram(programFixture({ id, max_award_usd: 5000 }), 'file', NOW);
  const before = await readStats(NOW);
  for (const id of ['l44-a', 'l44-b']) assert.equal((await record(`i:${i}`, id, 'applied', { installationId: i, now: ago(8) })).ok, true);
  assert.equal((await record(`i:${i}`, 'l44-a', 'rejected', { installationId: i, now: ago(1) })).ok, true);
  assert.equal((await record(`i:${i}`, 'l44-b', 'no_result', { installationId: i, now: ago(1) })).ok, true);
  const after_ = await readStats(NOW);
  assert.equal(after_.applications_7d - before.applications_7d, 0);
  assert.equal(after_.applications - before.applications, 2);
});

test('L47-3 (v6.1.19.1, review I1, M1): a builder send made the draft way counts as drafted only on EarnKit\'s draft (fields filled) or its own track of the program for the project', async () => {
  const db = sql();
  const ids = ['l47-draft', 'l47-plain', 'l47-later', 'l47-gap', 'l47-gap-b', 'l47-skip'];
  for (const id of ids) await upsertProgram(programFixture({ id, max_award_usd: 5000, eligibility: [{ kind: 'rule', note: 'a student' }] }), 'file', NOW);
  const counts = async (id: string) => {
    const [c] = await db<{ all: string; drafted: string; reported: string }[]>`
      WITH s AS (${sendRows(db)}) SELECT ${sendCounts(db)} FROM s WHERE program_id = ${id}`;
    return { all: Number(c.all), drafted: Number(c.drafted), reported: Number(c.reported) };
  };
  const drafted = { all: 1, drafted: 1, reported: 0 };
  const reported = { all: 1, drafted: 0, reported: 1 };
  // EarnKit filled the form: the send carries the fields it used.
  const i = await statInstall();
  assert.equal((await record(`i:${i}`, 'l47-draft', 'applied', { installationId: i, submitted_by: 'builder', fields_used: ['project_name'], project_id: 'name:gl notes', now: NOW })).ok, true);
  assert.deepEqual(await counts('l47-draft'), drafted);
  // A find report on the project (for another program), then the builder's own send with no fields: reported.
  const j = await statInstall();
  await saveReport(`i:${j}`, 'name:app a', { name: 'app a' } as never, ago(1));
  assert.equal((await record(`i:${j}`, 'l47-plain', 'applied', { installationId: j, submitted_by: 'builder', project_id: 'name:app a', now: NOW })).ok, true);
  assert.deepEqual(await counts('l47-plain'), reported);
  // A find after the send leaves it reported.
  const k = await statInstall();
  assert.equal((await record(`i:${k}`, 'l47-later', 'applied', { installationId: k, submitted_by: 'builder', project_id: 'name:app c', now: ago(2) })).ok, true);
  await saveReport(`i:${k}`, 'name:app c', { name: 'app c' } as never, NOW);
  assert.deepEqual(await counts('l47-later'), reported);
  // A rule the installation confirmed on the program for this owner, before the send: drafted.
  const { ruleItem } = await import('./eligibility');
  const item = ruleItem('a student');
  const m = await statInstall();
  assert.equal((await record(`i:${m}`, 'l47-gap', 'gap_done', { installationId: m, item, projectKey: '', now: ago(1) })).ok, true);
  assert.equal((await record(`i:${m}`, 'l47-gap', 'applied', { installationId: m, submitted_by: 'builder', now: NOW })).ok, true);
  assert.deepEqual(await counts('l47-gap'), drafted);
  // M1: the same installation's history under another owner does not count.
  const n = await statInstall();
  await db`INSERT INTO application_history (owner, installation_id, program_id, status, at) VALUES ('b:999999', ${n}, 'l47-gap-b', 'gap_done', ${ago(1)})`;
  assert.equal((await record(`i:${n}`, 'l47-gap-b', 'applied', { installationId: n, submitted_by: 'builder', now: NOW })).ok, true);
  assert.deepEqual(await counts('l47-gap-b'), reported);
  // M1: a skip is no draft.
  const q = await statInstall();
  await db`INSERT INTO application_history (owner, installation_id, program_id, status, at) VALUES (${`i:${q}`}, ${q}, 'l47-skip', 'skipped', ${ago(1)})`;
  assert.equal((await record(`i:${q}`, 'l47-skip', 'applied', { installationId: q, submitted_by: 'builder', now: NOW })).ok, true);
  assert.deepEqual(await counts('l47-skip'), reported);
});
