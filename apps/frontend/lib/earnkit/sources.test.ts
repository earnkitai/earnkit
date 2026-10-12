import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { dueSources, proposeSource, rejectSource, verifySource, writeReading } from './sources';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const ID = 2_100_002_000 + (process.pid % 1000);
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
beforeEach(async () => {
  if (process.env.DATABASE_URL) await sql()`DELETE FROM builder_sources WHERE builder_id = ${ID}`;
});

test('5.11 propose is idempotent; verify and reject set state; only verified sources are due, oldest read first', dbTest, async () => {
  const a = (await proposeSource({ builder_id: ID, kind: 'site', ref: 'https://a.example', project_key: 'a', proposed_by: 'server' }))!;
  assert.equal(await proposeSource({ builder_id: ID, kind: 'site', ref: 'https://a.example', project_key: 'a', proposed_by: 'server' }), null);
  const b = (await proposeSource({ builder_id: ID, kind: 'site', ref: 'https://b.example', project_key: 'b', proposed_by: 'agent' }))!;
  const c = (await proposeSource({ builder_id: ID, kind: 'site', ref: 'https://c.example', project_key: 'c', proposed_by: 'agent' }))!;
  await verifySource(a, 'repo_link');
  await verifySource(b, 'earnkit_txt');
  await rejectSource(c, 'ownership_unproven');
  await sql()`UPDATE builder_sources SET last_read_day = '2026-10-10' WHERE id = ${a}`;
  const due = (await dueSources('2026-10-12', 10)).filter((s) => s.builder_id === ID).map((s) => s.id);
  assert.deepEqual(due, [b, a], 'never read first, then the oldest');
  assert.deepEqual((await dueSources('2026-10-12', 10, [ID])).map((s) => s.id), [b, a], 'only: these people');
  assert.deepEqual(await dueSources('2026-10-12', 10, []), [], 'only: nobody');
});

test('5.12 one reading per source per day; a failed read is stored with its error class and still counts as read', dbTest, async () => {
  const a = (await proposeSource({ builder_id: ID, kind: 'site', ref: 'https://d.example', project_key: 'd', proposed_by: 'server' }))!;
  await verifySource(a, 'repo_link');
  assert.equal(await writeReading(a, ID, '2026-10-12', { ok: false, error: 'TimeoutError' }), true);
  assert.equal(await writeReading(a, ID, '2026-10-12', { ok: true, signals: { up: true } }), false);
  assert.equal((await dueSources('2026-10-12', 1000)).some((s) => s.id === a), false);
  const [r] = await sql()<{ ok: boolean; error: string }[]>`SELECT ok, error FROM source_readings WHERE source_id = ${a}`;
  assert.deepEqual([r.ok, r.error], [false, 'TimeoutError']);
});
