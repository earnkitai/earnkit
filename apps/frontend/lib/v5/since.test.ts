import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { listOpenPrograms, upsertProgram } from './programs';
import { programFixture } from './fixtures/program';
import { record } from './ledger';
import { since } from './since';

after(() => sql().end());

const T0 = new Date('2026-11-04T12:00:00Z');
const H = 3_600_000;
const at = (h: number) => new Date(T0.getTime() + h * H);

async function installation() {
  const [r] = await sql()`INSERT INTO installations (token_hash) VALUES (${'since-' + Math.random()}) RETURNING id`;
  return r.id as number;
}

test('empty on the first find', async () => {
  const id = await installation();
  await upsertProgram(programFixture({ id: 's-first', ends_at: at(48).toISOString() }), 'file', at(1));
  const s = await since(`i:${id}`, null, await listOpenPrograms(at(2)), ['s-first'], at(2));
  assert.deepEqual(s, { from: null, new: [], changed: [], closing: [] });
});

test('new, changed and closing, only for programs shown or in the ledger', async () => {
  const id = await installation();
  await sql()`UPDATE programs SET created_at = ${at(-1000)}`;
  const p = (o: Parameters<typeof programFixture>[0]) => programFixture({ ends_at: at(24 * 20).toISOString(), ...o });
  await upsertProgram(p({ id: 's-old', title: 'Old Grant' }), 'file', at(-500));
  await upsertProgram(p({ id: 's-applied', title: 'Applied Grant' }), 'file', at(-500));
  await record(`i:${id}`, 's-applied', 'applied', { now: at(-400) });
  await upsertProgram(p({ id: 's-hidden', title: 'Hidden Grant' }), 'file', at(-500));
  // After the last find (T0): one new, one deadline move, one amount change, one close, one not shown.
  await upsertProgram(p({ id: 's-new', title: 'New Grant' }), 'file', at(1));
  await upsertProgram(p({ id: 's-old', title: 'Old Grant', ends_at: '2026-11-20T23:59:00Z' }), 'file', at(2));
  await upsertProgram(p({ id: 's-applied', title: 'Applied Grant', status: 'closed' }), 'file', at(3));
  await upsertProgram(p({ id: 's-hidden', title: 'Hidden Grant', ends_at: '2026-11-21T00:00:00Z' }), 'file', at(3));
  await upsertProgram(p({ id: 's-soon', title: 'Soon Grant', ends_at: at(72).toISOString() }), 'file', at(-500));
  const programs = await listOpenPrograms(at(4));
  const s = await since(`i:${id}`, T0, programs, ['s-new', 's-old', 's-soon'], at(4));
  assert.equal(s.from, T0.toISOString());
  assert.deepEqual(s.new, [{ program_id: 's-new', title: 'New Grant' }]);
  assert.deepEqual(
    s.changed.map((c) => [c.program_id, c.what]).sort(),
    [['s-applied', 'closed'], ['s-old', 'deadline moved to Nov 20']],
  );
  assert.deepEqual(s.closing, [{ program_id: 's-soon', title: 'Soon Grant', closes_at: at(72).toISOString() }]);
});

test('an amount and a form change', async () => {
  const id = await installation();
  await upsertProgram(programFixture({ id: 's-amt', max_award_usd: 5000 }), 'file', at(-10));
  await upsertProgram(programFixture({ id: 's-amt', max_award_usd: 9000 }), 'file', at(1));
  await upsertProgram(programFixture({ id: 's-form', submission_url: 'https://example.com/a' }), 'file', at(-10));
  await upsertProgram(programFixture({ id: 's-form', submission_url: 'https://example.com/b' }), 'file', at(1));
  const s = await since(`i:${id}`, T0, await listOpenPrograms(at(2)), ['s-amt', 's-form'], at(2));
  assert.deepEqual(s.changed.map((c) => [c.program_id, c.what]).sort(), [['s-amt', 'amount changed'], ['s-form', 'form changed']]);
});
