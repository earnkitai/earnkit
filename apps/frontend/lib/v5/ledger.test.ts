import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { getProgram, upsertProgram } from './programs';
import { programFixture } from './fixtures/program';
import { askOutcome, doneItems, excluded, markAsked, record, summary, titleOf } from './ledger';

after(() => sql().end());

const NOW = new Date('2026-11-04T12:00:00Z');
const DAY = 86_400_000;
let n = 0;
/** The ledger owner of an unlinked installation. */
const o = (i: number) => `i:${i}`;
async function install(): Promise<number> {
  const [r] = await sql()`INSERT INTO installations (token_hash) VALUES (${'ledger-' + ++n + '-' + Date.now()}) RETURNING id`;
  return r.id as number;
}
async function prog(id: string, over: Record<string, unknown> = {}) {
  await upsertProgram(programFixture({ id, max_award_usd: 5000, ...over }), 'file', NOW);
  return (await getProgram(id))!;
}
const counts = async (i: number) => ({
  apps: (await sql()`SELECT count(*)::int AS n FROM applications WHERE installation_id = ${i}`)[0].n as number,
  hist: (await sql()`SELECT count(*)::int AS n FROM application_history WHERE installation_id = ${i}`)[0].n as number,
});

test('won needs a positive amount, and an unknown program is refused', async () => {
  const i = await install();
  await prog('l-won');
  await record(o(i), 'l-won', 'applied', { now: NOW });
  for (const amount_usd of [undefined, 0, -5]) {
    const r = await record(o(i), 'l-won', 'won', { amount_usd, now: NOW });
    assert.equal(r.ok, false);
  }
  assert.equal((await record(o(i), 'l-nope', 'applied', { now: NOW })).ok, false);
  assert.deepEqual(await counts(i), { apps: 1, hist: 1 });
});

test('results need a prior application; gap_done needs an item', async () => {
  const i = await install();
  await prog('l-never');
  const r = await record(o(i), 'l-never', 'rejected', { now: NOW });
  assert.deepEqual(r, { ok: false, note: "You haven't applied to that one here." });
  assert.equal((await record(o(i), 'l-never', 'gap_done', { now: NOW })).ok, false);
  assert.deepEqual(await counts(i), { apps: 0, hist: 0 });
});

test('applied then won: summary counts', async () => {
  const i = await install();
  const p = await prog('l-aw');
  await record(o(i), 'l-aw', 'applied', { now: NOW });
  let s = await summary(o(i), [p], NOW);
  assert.equal(s.applied, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.asked_usd, 5000);
  assert.equal((await record(o(i), 'l-aw', 'won', { amount_usd: 3000, now: NOW })).ok, true);
  s = await summary(o(i), [p], NOW);
  assert.equal(s.applied, 1);
  assert.equal(s.won, 1);
  assert.equal(s.won_usd, 3000);
  assert.equal(s.pending, 0);
  assert.equal(s.asked_usd, 5000);
});

test('applied twice is one row and one history row: the second is refused (v6.1.7, B13)', async () => {
  const i = await install();
  await prog('l-twice');
  await record(o(i), 'l-twice', 'applied', { now: NOW });
  assert.deepEqual(await record(o(i), 'l-twice', 'applied', { now: new Date(NOW.getTime() + DAY) }), { ok: false, note: 'Already sent here on Nov 4 by another agent; nothing recorded.' });
  assert.deepEqual(await counts(i), { apps: 1, hist: 1 });
});

/** An installation with a client name. */
async function named(client: string | null): Promise<number> {
  const [r] = await sql()`INSERT INTO installations (token_hash, client_name) VALUES (${'ledger-' + ++n + '-' + Date.now()}, ${client}) RETURNING id`;
  return r.id as number;
}

test('a second applied from another agent of the owner names the first and keeps it (v6.1.7, B13)', async () => {
  const one = await named('Claude Code');
  const two = await named(null);
  const b = `b:${2 ** 30 + 7}`;
  await prog('l-b13');
  await record(b, 'l-b13', 'applied', { installationId: one, submitted_by: 'agent', fields_used: ['a'], now: new Date('2026-11-03T22:10:00Z') });
  const r = await record(b, 'l-b13', 'applied', { installationId: two, submitted_by: 'builder', now: NOW });
  assert.deepEqual(r, { ok: false, note: 'Already sent here on Nov 3 by Claude Code; nothing recorded.' });
  const [row] = await sql()`SELECT installation_id, submitted_by, fields_used, at FROM applications WHERE owner = ${b} AND program_id = 'l-b13'`;
  assert.deepEqual([row.installation_id, row.submitted_by, row.fields_used, (row.at as Date).toISOString()], [one, 'agent', ['a'], '2026-11-03T22:10:00.000Z']);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM application_history WHERE owner = ${b} AND program_id = 'l-b13'`)[0].n, 1);
  // The other way round: the unnamed agent sent it first.
  await prog('l-b13b');
  await record(b, 'l-b13b', 'applied', { installationId: two, now: NOW });
  assert.deepEqual(await record(b, 'l-b13b', 'applied', { installationId: one, now: NOW }), { ok: false, note: 'Already sent here on Nov 4 by another agent; nothing recorded.' });
});

test('a win is whole dollars, at least 1 (v6.1.7, B8)', async () => {
  const i = await install();
  await prog('l-whole');
  await record(o(i), 'l-whole', 'applied', { now: NOW });
  for (const amount_usd of [0.4, 2.5, 0, undefined]) {
    assert.deepEqual(await record(o(i), 'l-whole', 'won', { amount_usd, now: NOW }), { ok: false, note: 'Tell me how much you won, as whole dollars.' });
  }
  assert.equal((await record(o(i), 'l-whole', 'won', { amount_usd: 1, now: NOW })).ok, true);
});

test('a result over a result is refused and changes nothing; the same one again is already recorded (v6.1.7, B8, B12)', async () => {
  const i = await install();
  await prog('l-res', { max_award_usd: 10_000 });
  await record(o(i), 'l-res', 'applied', { now: NOW });
  assert.equal((await record(o(i), 'l-res', 'won', { amount_usd: 3000, now: NOW })).ok, true);
  const before = await counts(i);
  const won = { ok: false, note: 'That one already has a result here: won $3,000.' };
  assert.deepEqual(await record(o(i), 'l-res', 'rejected', { now: NOW }), won);
  assert.deepEqual(await record(o(i), 'l-res', 'no_result', { now: NOW }), won);
  assert.deepEqual(await record(o(i), 'l-res', 'won', { amount_usd: 5000, now: NOW }), won);
  assert.deepEqual(await record(o(i), 'l-res', 'applied', { now: NOW }), won);
  assert.deepEqual(await record(o(i), 'l-res', 'won', { amount_usd: 3000, now: NOW }), { ok: false, note: 'Already recorded.' });
  assert.deepEqual(await counts(i), before);
  const [row] = await sql()`SELECT status, amount_usd FROM applications WHERE installation_id = ${i} AND program_id = 'l-res'`;
  assert.deepEqual([row.status, Number(row.amount_usd)], ['won', 3000]);
  assert.equal((await summary(o(i), [], NOW)).won_usd, 3000);
  await prog('l-rej');
  await record(o(i), 'l-rej', 'applied', { now: NOW });
  await record(o(i), 'l-rej', 'rejected', { now: NOW });
  assert.deepEqual(await record(o(i), 'l-rej', 'won', { amount_usd: 100, now: NOW }), { ok: false, note: 'That one already has a result here: rejected.' });
  assert.deepEqual(await record(o(i), 'l-rej', 'rejected', { now: NOW }), { ok: false, note: 'Already recorded.' });
  await prog('l-nr');
  await record(o(i), 'l-nr', 'applied', { now: NOW });
  await record(o(i), 'l-nr', 'no_result', { now: NOW });
  assert.deepEqual(await record(o(i), 'l-nr', 'rejected', { now: NOW }), { ok: false, note: 'That one already has a result here: no result.' });
});

test('a skip over a result is refused (v6.1.7, C28)', async () => {
  const i = await install();
  await prog('l-skres');
  await record(o(i), 'l-skres', 'applied', { now: NOW });
  await record(o(i), 'l-skres', 'won', { amount_usd: 100, now: NOW });
  const before = await counts(i);
  assert.deepEqual(await record(o(i), 'l-skres', 'skipped', { now: NOW }), { ok: false, note: 'That one already has a result here; nothing to skip.' });
  assert.deepEqual(await counts(i), before);
});

test('a result for a program gone from the catalog is still recorded when the owner applied; the title is the stored one (v6.1.7, C36)', async () => {
  const i = await install();
  await prog('l-gone', { title: 'Gone Grant' });
  await record(o(i), 'l-gone', 'applied', { now: NOW });
  const [t] = await sql()`SELECT title FROM applications WHERE installation_id = ${i} AND program_id = 'l-gone'`;
  assert.equal(t.title, 'Gone Grant');
  await sql()`DELETE FROM programs WHERE id = 'l-gone'`;
  assert.deepEqual(await record(o(i), 'l-gone', 'won', { amount_usd: 7_000_000, now: NOW }), { ok: true });
  assert.equal(await titleOf(o(i), 'l-gone'), 'Gone Grant');
  // No row in the ledger: still unknown.
  assert.deepEqual(await record(o(await install()), 'l-gone', 'won', { amount_usd: 100, now: NOW }), { ok: false, note: "I don't know that program." });
  assert.deepEqual(await record(o(i), 'l-gone', 'skipped', { now: NOW }), { ok: false, note: "I don't know that program." });
  // A row with no stored title answers with the id.
  await prog('l-gone2');
  await record(o(i), 'l-gone2', 'applied', { now: NOW });
  await sql()`UPDATE applications SET title = NULL WHERE installation_id = ${i} AND program_id = 'l-gone2'`;
  await sql()`DELETE FROM programs WHERE id = 'l-gone2'`;
  assert.deepEqual(await record(o(i), 'l-gone2', 'rejected', { now: NOW }), { ok: true });
  assert.equal(await titleOf(o(i), 'l-gone2'), 'l-gone2');
  // A program still in the catalog answers with its own title.
  await prog('l-here', { title: 'Here Grant' });
  assert.equal(await titleOf(o(i), 'l-here'), 'Here Grant');
});

test('excluded holds applied and skipped; skipped keeps an application', async () => {
  const i = await install();
  await prog('l-ex-a');
  await prog('l-ex-s');
  await prog('l-ex-o');
  await record(o(i), 'l-ex-a', 'applied', { now: NOW });
  await record(o(i), 'l-ex-s', 'skipped', { now: NOW });
  assert.deepEqual([...(await excluded(o(i)))].sort(), ['l-ex-a', 'l-ex-s']);
  await record(o(i), 'l-ex-a', 'skipped', { now: NOW });
  const s = await summary(o(i), [], NOW);
  assert.equal(s.skipped, 1);
  assert.equal(s.applied, 1);
});

test('gap_done writes gaps_done only', async () => {
  const i = await install();
  await prog('l-gap', { eligibility: [{ kind: 'users' }] });
  assert.deepEqual(await record(o(i), 'l-gap', 'gap_done', { item: 'users', now: NOW }), { ok: true });
  // The row existed: the same item again says so (v6.1.7, C26).
  assert.deepEqual(await record(o(i), 'l-gap', 'gap_done', { item: 'users', now: NOW }), { ok: true, repeated: true });
  assert.deepEqual(await counts(i), { apps: 0, hist: 2 });
  assert.deepEqual([...(await doneItems(o(i), 'l-gap'))], ['users']);
});

test('gap_done refuses an item that is not one of the program\'s, names the real ones and writes nothing (v6.1.6)', async () => {
  const i = await install();
  await prog('l-gap-arc', { eligibility: [{ kind: 'chain', value: 'arc' }] });
  const r = await record(o(i), 'l-gap-arc', 'gap_done', { item: 'nope', now: NOW });
  assert.deepEqual(r, { ok: false, note: 'Which change did you finish? Say the program and the change.', items: ['chain:arc'] });
  // users only when the program has a users item (v6.1.7, C27); without an item the keys come back too (C11).
  assert.deepEqual(await record(o(i), 'l-gap-arc', 'gap_done', { item: 'users', now: NOW }), { ok: false, note: 'Which change did you finish? Say the program and the change.', items: ['chain:arc'] });
  assert.deepEqual(await record(o(i), 'l-gap-arc', 'gap_done', { now: NOW }), { ok: false, note: 'Which change did you finish? Say the program and the change.', items: ['chain:arc'] });
  assert.deepEqual(await counts(i), { apps: 0, hist: 0 });
  assert.deepEqual([...(await doneItems(o(i), 'l-gap-arc'))], []);
  assert.equal((await record(o(i), 'l-gap-arc', 'gap_done', { item: 'chain:arc', now: NOW })).ok, true);
  assert.deepEqual([...(await doneItems(o(i), 'l-gap-arc'))], ['chain:arc']);
});

test('askOutcome lists a passed results date once asked is marked', async () => {
  const i = await install();
  const past = await prog('l-ask', { results_due: { date: '2026-11-03' } });
  const future = await prog('l-ask-f', { results_due: { date: '2026-12-30' } });
  await record(o(i), 'l-ask', 'applied', { now: NOW });
  await record(o(i), 'l-ask-f', 'applied', { now: NOW });
  const list = await askOutcome(o(i), [past, future], NOW);
  assert.deepEqual(list.map((x) => x.program_id), ['l-ask']);
  await markAsked(o(i), ['l-ask'], NOW);
  assert.deepEqual(await askOutcome(o(i), [past, future], NOW), []);
});

test('closing_soon: applied programs within 7 days, soonest first', async () => {
  const i = await install();
  const a = await prog('l-cs-a', { ends_at: new Date(NOW.getTime() + 5 * DAY).toISOString() });
  const b = await prog('l-cs-b', { ends_at: new Date(NOW.getTime() + 2 * DAY).toISOString() });
  const c = await prog('l-cs-c', { ends_at: new Date(NOW.getTime() + 20 * DAY).toISOString() });
  for (const id of ['l-cs-a', 'l-cs-b', 'l-cs-c']) await record(o(i), id, 'applied', { now: NOW });
  const s = await summary(o(i), [a, b, c], NOW);
  assert.deepEqual(s.closing_soon.map((x) => x.program_id), ['l-cs-b', 'l-cs-a']);
});

test('a closed program still counts: asked_usd, closing_soon and askOutcome read its own row', async () => {
  const i = await install();
  await prog('l-closed', { results_due: { date: '2026-11-08' } });
  await record(o(i), 'l-closed', 'applied', { now: NOW });
  await upsertProgram(programFixture({ id: 'l-closed', max_award_usd: 5000, results_due: { date: '2026-11-08' }, ends_at: new Date(NOW.getTime() - 3 * DAY).toISOString() }), 'file', NOW);
  const s = await summary(o(i), [], NOW);
  assert.equal(s.asked_usd, 5000);
  assert.deepEqual(s.closing_soon.map((x) => x.program_id), ['l-closed']);
  assert.deepEqual(await askOutcome(o(i), [], NOW), []);
  const later = new Date(NOW.getTime() + 5 * DAY);
  assert.deepEqual((await askOutcome(o(i), [], later)).map((x) => x.program_id), ['l-closed']);
});

test('a skipped-only row refuses a result; a resulted row refuses applied', async () => {
  const i = await install();
  await prog('l-sk');
  await record(o(i), 'l-sk', 'skipped', { now: NOW });
  for (const st of ['won', 'rejected', 'no_result'] as const) {
    assert.deepEqual(await record(o(i), 'l-sk', st, { amount_usd: 10, now: NOW }), { ok: false, note: "You haven't applied to that one here." });
  }
  await record(o(i), 'l-sk', 'applied', { now: NOW });
  await record(o(i), 'l-sk', 'rejected', { now: NOW });
  const before = await counts(i);
  assert.deepEqual(await record(o(i), 'l-sk', 'applied', { now: NOW }), { ok: false, note: 'That one already has a result here: rejected.' });
  assert.deepEqual(await counts(i), before);
});

test('won above the program max is refused and writes nothing; with no max and no pool, above 10,000,000 is refused (v6.1.7, C34)', async () => {
  const i = await install();
  await prog('l-cap');
  await record(o(i), 'l-cap', 'applied', { now: NOW });
  const before = await counts(i);
  const over = await record(o(i), 'l-cap', 'won', { amount_usd: 5001, now: NOW });
  assert.deepEqual(over, { ok: false, note: "That's more than this program pays; check the amount." });
  assert.deepEqual(await counts(i), before);
  assert.equal((await record(o(i), 'l-cap', 'won', { amount_usd: 5000, now: NOW })).ok, true);

  await upsertProgram(programFixture({ id: 'l-nocap' }), 'file', NOW);
  await record(o(i), 'l-nocap', 'applied', { now: NOW });
  const mid = await counts(i);
  assert.deepEqual(await record(o(i), 'l-nocap', 'won', { amount_usd: 10_000_001, now: NOW }), { ok: false, note: "That's more than this program pays; check the amount." });
  assert.deepEqual(await counts(i), mid);
  assert.equal((await record(o(i), 'l-nocap', 'won', { amount_usd: 6_000_000, now: NOW })).ok, true);
  // With a pool and no maximum, the pool is the cap.
  await upsertProgram(programFixture({ id: 'l-pool', pool_usd: 20_000 }), 'file', NOW);
  await record(o(i), 'l-pool', 'applied', { now: NOW });
  assert.deepEqual(await record(o(i), 'l-pool', 'won', { amount_usd: 20_001, now: NOW }), { ok: false, note: "That's more than this program pays; check the amount." });
  assert.equal((await record(o(i), 'l-pool', 'won', { amount_usd: 20_000, now: NOW })).ok, true);
});

test('asked_usd leaves out investment programs', async () => {
  const i = await install();
  const g = await prog('l-ask-g', { max_award_usd: 5000 });
  const inv = await prog('l-ask-inv', { max_award_usd: 500_000, investment: true });
  const cat = await prog('l-ask-cat', { max_award_usd: 250_000, category: 'investment' });
  for (const id of ['l-ask-g', 'l-ask-inv', 'l-ask-cat']) await record(o(i), id, 'applied', { now: NOW });
  const s = await summary(o(i), [g, inv, cat], NOW);
  assert.equal(s.applied, 3);
  assert.equal(s.asked_usd, 5000);
});

test('a record under one b: owner from two installations is one row, written by the last installation', async () => {
  const one = await install();
  const two = await install();
  // Past the builders sequence, so no other file's builder shares it.
  const b = `b:${2 ** 30}`;
  await prog('l-b1', { eligibility: [{ kind: 'users' }] });
  await record(b, 'l-b1', 'applied', { installationId: one, now: NOW });
  await record(b, 'l-b1', 'won', { installationId: two, amount_usd: 100, now: new Date(NOW.getTime() + DAY) });
  await record(b, 'l-b1', 'gap_done', { installationId: one, item: 'users', now: NOW });
  await record(b, 'l-b1', 'gap_done', { installationId: two, item: 'users', now: NOW });
  const rows = await sql()`SELECT installation_id, status FROM applications WHERE owner = ${b} AND program_id = 'l-b1'`;
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ installation_id: two, status: 'won' }]);
  const hist = await sql()`SELECT installation_id FROM application_history WHERE owner = ${b} AND program_id = 'l-b1' ORDER BY id`;
  assert.deepEqual(hist.map((r) => r.installation_id), [one, two, one, two]);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM gaps_done WHERE owner = ${b} AND program_id = 'l-b1'`)[0].n, 1);
  assert.equal((await summary(b, [], NOW)).won, 1);
  assert.deepEqual([...(await doneItems(b, 'l-b1'))], ['users']);
  assert.deepEqual(await counts(one), { apps: 0, hist: 2 });
});

test('a b: owner without the writing installation is refused', async () => {
  await prog('l-b-none');
  await assert.rejects(record(`b:${2 ** 30 + 1}`, 'l-b-none', 'applied', { now: NOW }));
});

test('v6.1.9: with no results date, EarnKit asks 30 days after the send', async () => {
  const i = await install();
  const a = await prog('ao-nodate-a');
  const b = await prog('ao-nodate-b');
  assert.equal(a.file.results_due ?? null, null);
  await record(o(i), 'ao-nodate-a', 'applied', { now: new Date(NOW.getTime() - 31 * DAY) });
  await record(o(i), 'ao-nodate-b', 'applied', { now: new Date(NOW.getTime() - 29 * DAY) });
  assert.deepEqual((await askOutcome(o(i), [a, b], NOW)).map((x) => x.program_id), ['ao-nodate-a']);
  await markAsked(o(i), ['ao-nodate-a'], NOW);
  assert.deepEqual(await askOutcome(o(i), [a, b], NOW), []);
  assert.deepEqual((await askOutcome(o(i), [a, b], new Date(NOW.getTime() + 2 * DAY))).map((x) => x.program_id), ['ao-nodate-b']);
});
