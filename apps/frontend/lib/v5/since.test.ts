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

/** L46-15: a draft out (a started claim, not held) for this owner. */
const started = (id: number, program: string, held = false) =>
  sql()`INSERT INTO applications (owner, installation_id, program_id, project_id, status, at, claimed_at, held_at)
    VALUES (${`i:${id}`}, ${id}, ${program}, 'p1', 'started', ${at(-5)}, ${at(-5)}, ${held ? at(-4) : null})`;

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
  assert.deepEqual(s.closing, [{ program_id: 's-soon', title: 'Soon Grant', closes_at: at(72).toISOString(), zone: 'UTC' }]);
});

test('an amount and a form change', async () => {
  const id = await installation();
  await upsertProgram(programFixture({ id: 's-amt', max_award_usd: 5000 }), 'file', at(-10));
  await upsertProgram(programFixture({ id: 's-amt', max_award_usd: 9000 }), 'file', at(1));
  await upsertProgram(programFixture({ id: 's-form', submission_url: 'https://example.com/a' }), 'file', at(-10));
  await upsertProgram(programFixture({ id: 's-form', submission_url: 'https://example.com/b' }), 'file', at(1));
  await started(id, 's-form');
  const s = await since(`i:${id}`, T0, await listOpenPrograms(at(2)), ['s-amt', 's-form'], at(2));
  assert.deepEqual(s.changed.map((c) => [c.program_id, c.what]).sort(), [['s-amt', 'amount changed'], ['s-form', 'form changed']]);
});

test('C33: a program opening for the first time is "now open"; one that was open before is "open again"', async () => {
  const id = await installation();
  await upsertProgram(programFixture({ id: 's-first-open', status: 'upcoming', opens_note: 'Opens soon' }), 'file', at(-10));
  await upsertProgram(programFixture({ id: 's-first-open', status: 'active' }), 'file', at(1));
  await upsertProgram(programFixture({ id: 's-reopen' }), 'file', at(-20));
  await upsertProgram(programFixture({ id: 's-reopen', status: 'closed' }), 'file', at(-10));
  await upsertProgram(programFixture({ id: 's-reopen', status: 'active' }), 'file', at(1));
  const s = await since(`i:${id}`, T0, await listOpenPrograms(at(2)), ['s-first-open', 's-reopen'], at(2));
  assert.deepEqual(s.changed.map((c) => [c.program_id, c.what]).sort(), [['s-first-open', 'now open'], ['s-reopen', 'open again']]);
});

test('L46-15 (v6.1.22): a sent program\'s form change is not said; a started one\'s is', async () => {
  const id = await installation();
  const p = (o: Parameters<typeof programFixture>[0]) => programFixture({ ends_at: at(24 * 20).toISOString(), ...o });
  for (const [pid, title] of [['s15-floss', 'FLOSS/fund'], ['s15-codegeist', 'Codegeist 2026'], ['s15-held', 'Held Grant'], ['s15-shown', 'Shown Grant']]) {
    await upsertProgram(p({ id: pid, title, submission_url: 'https://example.com/a' }), 'file', at(-10));
  }
  await record(`i:${id}`, 's15-floss', 'applied', { now: at(-5) });
  await started(id, 's15-codegeist');
  await started(id, 's15-held', true);
  for (const pid of ['s15-floss', 's15-codegeist', 's15-held', 's15-shown'])
    await upsertProgram(p({ id: pid, title: pid, submission_url: 'https://example.com/b' }), 'file', at(1));
  // A deadline move is said as before, for a sent program too.
  await upsertProgram(p({ id: 's15-floss', title: 's15-floss', submission_url: 'https://example.com/b', ends_at: '2026-11-20T23:59:00Z' }), 'file', at(1.5));
  const s = await since(`i:${id}`, T0, await listOpenPrograms(at(2)), ['s15-shown', 's15-floss', 's15-codegeist', 's15-held'], at(2));
  assert.deepEqual(s.changed.map((c) => [c.program_id, c.what]).sort(), [['s15-codegeist', 'form changed'], ['s15-floss', 'deadline moved to Nov 20']]);
});
