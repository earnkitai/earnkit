import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { person } from './fixtures/find';
import { computeScoreV2 } from './score-v2';
import { isoWeekOf, lastFinishedMonday } from './weeks';
import { profileData } from './bench-data';
import { readStats, STATS_KEYS, STATS_LABELS } from './stats';
import { approveWeek } from './weekly-moment';
import { CONNECT_POINTS, POINTS_LINE, pointsForRank, pointsTotal } from './points';

/** v3 Stage 1 Task 4: the points ledger (approveWeek awards once, by rank), the reply line, the profile and points_total. */
process.env.EARNKIT_URL = 'https://earnkit.com';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const WEDNESDAY = Date.parse('2026-10-14T12:00:00Z');
mock.timers.enable({ apis: ['Date'], now: WEDNESDAY });
after(async () => {
  mock.timers.reset();
  if (process.env.DATABASE_URL) await sql().end();
});
const RUN = String(process.pid % 100000);
const NO_MATCH = (async () => ({ checked: 1, scored: 0, fits: [] })) as never;
const ctx = (id: number) => ({ installationId: id, ownInstallationId: id, sharedClient: false, matchProjects: NO_MATCH });
const show = (r: Awaited<ReturnType<typeof mcpCall>>) => String(r.reply?.show_to_builder ?? '');
const freshBoard = () => sql()`UPDATE builder_profiles SET hidden = true`;

async function ranked(tag: string) {
  const key = `${tag}${RUN}/app`;
  const handle = `${tag}${RUN}`.slice(0, 15);
  const id = await person({ main: key, claimed: handle, ranked: true, projects: [{ key, name: 'App', confirmed: true }] });
  const s = computeScoreV2({ ships: [], commitWeeks: [isoWeekOf(new Date())] }, new Date());
  await sql()`UPDATE builder_live SET score = ${s.score}, parts = ${sql().json(s.parts as never)} WHERE builder_id = ${id}`;
  return { id, key, handle };
}
const facts = (id: number, key: string, week: string, f: object) =>
  sql()`INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${id}, ${key}, ${week}, ${sql().json(f as never)})`;
const rows = (id: number) => sql()<{ week: string; points: number; via: string; rank: number | null; total: number | null }[]>`
  SELECT week::text, points, via, rank, total FROM builder_points WHERE builder_id = ${id}`;

test('pointsForRank', () => {
  assert.equal(pointsForRank(1, 40), 100);
  assert.equal(pointsForRank(4, 40), 90);
  assert.equal(pointsForRank(10, 40), 70);
  assert.equal(pointsForRank(20, 40), 50);
  assert.equal(pointsForRank(30, 40), 30);
  assert.equal(pointsForRank(null, null), 30);
});

test('approveWeek awards once', db, async () => {
  await freshBoard();
  const me = await ranked('pta');
  const monday = lastFinishedMonday(new Date());
  await facts(me.id, me.key, monday, { checked: true, shipped_code: { n: 3 } });
  assert.equal(await approveWeek(me.id, me.key, monday, new Date(), 'share'), true);
  assert.deepEqual((await rows(me.id)).map((r) => [r.week, r.points, r.via, r.rank, r.total]), [[monday, 100, 'share', 1, 1]]);
  assert.equal(await approveWeek(me.id, me.key, monday, new Date(), 'share'), true);
  assert.equal((await rows(me.id)).length, 1);
  assert.equal(await pointsTotal(me.id), 100);
});

test('a started-only week approved gives no points', db, async () => {
  await freshBoard();
  const me = await ranked('ptb');
  const monday = lastFinishedMonday(new Date());
  await facts(me.id, me.key, monday, { checked: true, started: { n: 2 } });
  assert.equal(await approveWeek(me.id, me.key, monday, new Date()), true);
  assert.equal((await rows(me.id)).length, 0);
  assert.equal(await pointsTotal(me.id), 0);
});

test('connect via gives 30', db, async () => {
  await freshBoard();
  const me = await ranked('ptc');
  const monday = lastFinishedMonday(new Date());
  await facts(me.id, me.key, monday, { checked: true, went_live: true });
  await approveWeek(me.id, me.key, monday, new Date(), 'connect');
  assert.deepEqual((await rows(me.id)).map((r) => [r.points, r.via, r.rank, r.total]), [[CONNECT_POINTS, 'connect', null, null]]);
});

test('profileData.points; v3.1 F4: the reply has no points line', db, async () => {
  await freshBoard();
  const me = await ranked('ptd');
  const monday = lastFinishedMonday(new Date());
  const before = show(await mcpCall(ctx(me.id), 'find', {}));
  assert.doesNotMatch(before, /Points:/, 'no points, no line');
  await facts(me.id, me.key, monday, { checked: true, shipped_code: { n: 1 } });
  await approveWeek(me.id, me.key, monday, new Date());
  assert.equal((await profileData(me.id, new Date()))?.points, 100);
  const s = show(await mcpCall(ctx(me.id), 'find', {}));
  assert.ok(!s.includes(POINTS_LINE(100)) && !s.includes('Points:'), s);
  assert.doesNotMatch(s, /—/);
});

test('v4.7.1 T2: points_total left the public stats (the ledger stays internal)', db, async () => {
  assert.ok(!(STATS_KEYS as readonly string[]).includes('points_total'));
  assert.ok(!('points_total' in STATS_LABELS));
  assert.ok(!('points_total' in (await readStats(new Date()))));
});
