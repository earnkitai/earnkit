import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { rankFeed } from './feed';
import { upsertWeekFacts } from './week-facts';
import { approveWeek } from './weekly-moment';
import { pointsTotal } from './points';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const NOW = new Date('2026-10-21T12:00:00Z'); // the last finished week is 2026-10-12
const MONDAY = '2026-10-12';

async function builder(): Promise<{ id: number; key: string }> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v3wp-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  return { id, key: `v3wp${randomBytes(3).toString('hex')}/r${id}` };
}
const pointsFor = async (key: string) => (await sql()<{ points: number }[]>`SELECT points::int AS points FROM project_updates WHERE project_key = ${key} AND week = ${MONDAY}`)[0].points;

test('(a) upsertWeekFacts writes points from the facts', dbTest, async () => {
  const b = await builder();
  await upsertWeekFacts(b.id, b.key, MONDAY, { shipped_code: { n: 5 }, streak: { w: 3 }, checked: true });
  assert.equal(await pointsFor(b.key), 13);
});

test('(b) a started-only week has 0 points', dbTest, async () => {
  const b = await builder();
  await upsertWeekFacts(b.id, b.key, MONDAY, { started: { live: true, weeks: 0, people: 0 } });
  assert.equal(await pointsFor(b.key), 0);
});

test('(c) feed:rank rewrites older rows', dbTest, async () => {
  const b = await builder();
  await upsertWeekFacts(b.id, b.key, MONDAY, { shipped_code: { n: 5 }, streak: { w: 3 }, checked: true });
  await sql()`UPDATE project_updates SET points = 0 WHERE project_key = ${b.key}`;
  assert.equal(await pointsFor(b.key), 0);
  await rankFeed(NOW, { weeks: 12 });
  assert.equal(await pointsFor(b.key), 13);
});

test('(d) final review: a week approved before its facts arrive earns its points when they do, once', dbTest, async () => {
  const b = await builder();
  assert.equal(await approveWeek(b.id, b.key, MONDAY, NOW, 'connect'), true);
  assert.equal(await pointsTotal(b.id), 0, 'no facts yet: nothing');
  await upsertWeekFacts(b.id, b.key, MONDAY, { shipped_code: { n: 2 }, checked: true });
  const rows = await sql()<{ points: number; via: string }[]>`SELECT points, via FROM builder_points WHERE builder_id = ${b.id}`;
  assert.deepEqual(rows.map((r) => [r.points, r.via]), [[30, 'connect']]);
  await upsertWeekFacts(b.id, b.key, MONDAY, { shipped_code: { n: 3 }, checked: true });
  assert.equal(await pointsTotal(b.id), 30, 'once');
});
