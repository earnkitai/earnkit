import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { getProgram, isOpen, listListedPrograms, listOpenPrograms, upsertProgram } from './programs';
import { programFixture } from './fixtures/program';

after(() => sql().end());

const NOW = new Date('2026-11-04T12:00:00Z');
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const dateOf = (d: Date) => d.toISOString().slice(0, 10);
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

test('upsert: created, then unchanged, then updated with one program_changes row', async () => {
  const p = programFixture({ id: 't-upsert', ends_at: '2026-12-01T00:00:00Z' });
  assert.equal(await upsertProgram(p, 'file', NOW), 'created');
  assert.equal(await upsertProgram(p, 'file', NOW), 'unchanged');
  assert.equal(await upsertProgram({ ...p, ends_at: '2026-12-15T00:00:00Z' }, 'file', NOW), 'updated');
  const changes = await sql()`SELECT fields FROM program_changes WHERE program_id = 't-upsert'`;
  assert.deepEqual(changes.map((c) => c.fields), [['ends_at']]);
  const row = await getProgram('t-upsert');
  assert.equal(row?.file.ends_at, '2026-12-15T00:00:00Z');
  assert.equal(row?.source, 'file');
  assert.equal((await sql()`SELECT ends_at FROM programs WHERE id = 't-upsert'`)[0].ends_at.toISOString(), '2026-12-15T00:00:00.000Z');
});

test('upsert: a change outside the named fields is updated with no program_changes row', async () => {
  const p = programFixture({ id: 't-desc' });
  await upsertProgram(p, 'file', NOW);
  assert.equal(await upsertProgram({ ...p, description: 'New words.' }, 'file', NOW), 'updated');
  assert.equal((await sql()`SELECT count(*)::int AS n FROM program_changes WHERE program_id = 't-desc'`)[0].n, 0);
});

test('getProgram: null for an unknown id', async () => {
  assert.equal(await getProgram('t-nope'), null);
});

test('listOpenPrograms: closed, past deadline, stale over 14 days and old api rows are out', async () => {
  await upsertProgram(programFixture({ id: 't-open' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't-closed', status: 'closed' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't-past', ends_at: daysAgo(1).toISOString() }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't-stale' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't-stale-new' }), 'file', NOW);
  await sql()`UPDATE programs SET stale_since = ${daysAgo(15)} WHERE id = 't-stale'`;
  await sql()`UPDATE programs SET stale_since = ${daysAgo(3)} WHERE id = 't-stale-new'`;
  await upsertProgram(programFixture({ id: 't-file-old', verified_at: dateOf(daysAgo(30)) }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't-api-old', verified_at: dateOf(daysAgo(30)) }), 'api', NOW);
  await upsertProgram(programFixture({ id: 't-api-new', verified_at: dateOf(daysAgo(2)) }), 'api', NOW);
  await upsertProgram(
    programFixture({ id: 't-upcoming', status: 'upcoming', opens_note: 'Opens in December', submission_requirements: [] }),
    'file',
    NOW,
  );

  const open = ids(await listOpenPrograms(NOW));
  for (const id of ['t-open', 't-stale-new', 't-file-old', 't-api-new']) assert.ok(open.includes(id), id);
  for (const id of ['t-closed', 't-past', 't-stale', 't-api-old', 't-upcoming']) assert.ok(!open.includes(id), id);

  const listed = ids(await listListedPrograms(NOW));
  assert.ok(listed.includes('t-upcoming'));
  assert.ok(listed.includes('t-open'));
  assert.ok(!listed.includes('t-closed'));
});

test('readers skip a row whose file does not parse', async () => {
  await upsertProgram(programFixture({ id: 't-broken' }), 'file', NOW);
  await sql()`UPDATE programs SET file = file - 'title' WHERE id = 't-broken'`;
  assert.equal(await getProgram('t-broken'), null);
  assert.ok(!ids(await listOpenPrograms(NOW)).includes('t-broken'));
});

test('the synced program files are in the table', async () => {
  const row = await getProgram('base-builder-grants');
  assert.equal(row?.source, 'file');
  assert.equal(row?.file.form?.platform, 'google');
});

test('isOpen: active and not past ends_at', () => {
  const p = programFixture({ id: 't-isopen', ends_at: '2026-11-05T00:00:00Z' });
  assert.equal(isOpen(p, NOW), true);
  assert.equal(isOpen(p, new Date('2026-11-06T00:00:00Z')), false);
  assert.equal(isOpen({ ...p, status: 'closed' }, NOW), false);
  assert.equal(isOpen({ ...p, ends_at: null }, NOW), true);
});
