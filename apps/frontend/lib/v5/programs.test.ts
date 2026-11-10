import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { getProgram, isOpen, listListedPrograms, listOpenPrograms, programByName, unknownProgramLine, upsertProgram } from './programs';
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

test('Review Focus 3 (v6.1.12, F4): a program by its id, title or organizer, any case, spaces and punctuation ignored', async () => {
  const one = async (name: string) => {
    const r = await programByName(name, NOW);
    return { id: r.row?.id ?? null, line: r.row ? null : unknownProgramLine(r.suggest) };
  };
  // Exactly one match resolves.
  for (const [name, id] of [
    ['yc', 'y-combinator'], ['YC', 'y-combinator'], ['ycombinator', 'y-combinator'], ['Y Combinator', 'y-combinator'], ['y-combinator', 'y-combinator'],
    ['Y.Combinator', 'y-combinator'], ['circle', 'circle-developer-grants'], ['Thiel Foundation', 'thiel-fellowship'], ['zerodha', 'floss-fund-zerodha'],
    ['a16z', 'a16z-speedrun'], ['Solana Foundation', 'solana-foundation-grants'], ['monad blitz oregon', 'monad-blitz-oregon'],
  ] as const) assert.deepEqual(await one(name), { id, line: null }, name);
  // Several: the first two by rank (open first, then the larger award, the sooner close), as a question.
  assert.deepEqual(await one('Base'), { id: null, line: "I don't know that program. Did you mean Base Builder Grant Program or Base Ecosystem Fund?" });
  assert.deepEqual(await one('monad'), { id: null, line: "I don't know that program. Did you mean Monad Blitz Oregon or Monad Blitz @广州 (Guangzhou)?" });
  assert.deepEqual(await one('Monad Blitz'), { id: null, line: "I don't know that program. Did you mean Monad Blitz Oregon or Monad Blitz @广州 (Guangzhou)?" });
  assert.deepEqual(await one('uniswap'), { id: null, line: "I don't know that program. Did you mean Uniswap Foundation Open Grants or Uniswap Foundation Security Fund (UFSF) Audit Subsidies?" });
  // None.
  for (const name of ['qqq-unknown', '', '  ', '?!']) assert.deepEqual(await one(name), { id: null, line: "I don't know that program." }, name);
});
