import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { getProgram, upsertProgram } from './programs';
import { programFixture } from './fixtures/program';
import { CONFIRMED, EARLIER_RESULT, paymentKeyOf, askOutcome, outcomeAsksDue, codeDoneAt, doneItems, doneOn, excluded, markAsked, record, resultOf, summary, titleOf, applicationsLine } from './ledger';

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
  assert.deepEqual(await record(o(i), 'l-twice', 'applied', { now: new Date(NOW.getTime() + DAY) }), { ok: false, note: 'Already sent on Nov 4.' });
  assert.deepEqual(await counts(i), { apps: 1, hist: 1 });
});

/** An installation with a client name. */
async function named(client: string | null): Promise<number> {
  const [r] = await sql()`INSERT INTO installations (token_hash, client_name) VALUES (${'ledger-' + ++n + '-' + Date.now()}, ${client}) RETURNING id`;
  return r.id as number;
}

test('a second applied from another agent of the owner names the first and keeps it (v6.1.7, B13)', async () => {
  // L25-1 (v6.1.16, fix round 1): the stored "Claude Code (earnkit)" is named "Claude Code".
  const one = await named('Claude Code (earnkit)');
  const two = await named(null);
  const b = `b:${2 ** 30 + 7}`;
  // Both agents are linked to the owner's builder (fix round 2: only a linked agent writes a b: ledger).
  await sql()`UPDATE installations SET builder_id = ${2 ** 30 + 7} WHERE id IN (${one}, ${two})`;
  await prog('l-b13');
  await record(b, 'l-b13', 'applied', { installationId: one, submitted_by: 'agent', fields_used: ['a'], now: new Date('2026-11-03T22:10:00Z') });
  const r = await record(b, 'l-b13', 'applied', { installationId: two, submitted_by: 'builder', now: NOW });
  assert.deepEqual(r, { ok: false, note: 'Already sent on Nov 3.' });
  const [row] = await sql()`SELECT installation_id, submitted_by, fields_used, at FROM applications WHERE owner = ${b} AND program_id = 'l-b13'`;
  assert.deepEqual([row.installation_id, row.submitted_by, row.fields_used, (row.at as Date).toISOString()], [one, 'agent', ['a'], '2026-11-03T22:10:00.000Z']);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM application_history WHERE owner = ${b} AND program_id = 'l-b13'`)[0].n, 1);
  // The other way round: the unnamed agent sent it first.
  await prog('l-b13b');
  await record(b, 'l-b13b', 'applied', { installationId: two, now: NOW });
  assert.deepEqual(await record(b, 'l-b13b', 'applied', { installationId: one, now: NOW }), { ok: false, note: 'Already sent on Nov 4.' });
});

test('a win has an amount above 0 (v6.1.7, B8); L25-13, L22-6 (v6.1.16): cents are kept', async () => {
  const i = await install();
  await prog('l-whole');
  await record(o(i), 'l-whole', 'applied', { now: NOW });
  for (const amount_usd of [0, -1, Number.NaN, undefined]) {
    assert.deepEqual(await record(o(i), 'l-whole', 'won', { amount_usd, now: NOW }), { ok: false, note: 'Tell me how much you won.' });
  }
  assert.equal((await record(o(i), 'l-whole', 'won', { amount_usd: 1234.56, now: NOW })).ok, true);
  const [row] = await sql()`SELECT amount_usd, amounts FROM applications WHERE owner = ${o(i)} AND program_id = 'l-whole'`;
  assert.deepEqual([Number(row.amount_usd), row.amounts], [1234.56, { USD: 1234.56 }]);
});

test('a result over a result: no_result and applied are refused and change nothing; the same win again is already recorded; another amount corrects; a marked payment adds once (v6.1.7, B8, B12; L15-17, T8-F1; L16-1 v6.1.16)', async () => {
  const i = await install();
  await prog('l-res', { max_award_usd: 10_000 });
  await record(o(i), 'l-res', 'applied', { now: NOW });
  assert.equal((await record(o(i), 'l-res', 'won', { amount_usd: 3000, now: NOW })).ok, true);
  const before = await counts(i);
  const won = { ok: false, note: 'That one already has a result here: won $3,000.' };
  assert.deepEqual(await record(o(i), 'l-res', 'no_result', { now: NOW }), won);
  assert.deepEqual(await record(o(i), 'l-res', 'applied', { now: NOW }), won);
  assert.deepEqual(await counts(i), before);
  // T8-F1 (v6.1.14), L17-8 (v6.1.16): the same win resent is a confirmation; another amount, unmarked, is a correction that replaces it.
  assert.deepEqual(await record(o(i), 'l-res', 'won', { amount_usd: 3000, now: NOW }), { ok: false, note: CONFIRMED });
  assert.deepEqual(await record(o(i), 'l-res', 'won', { amount_usd: 2500, now: NOW }), { ok: true, corrected: true, replaced: { USD: 3000 } });
  assert.equal((await summary(o(i), [], NOW)).won_usd, 2500);
  // A further payment, marked with its key, adds once (L15-17); a repeat of the key changes nothing; the total stays under the cap.
  assert.deepEqual(await record(o(i), 'l-res', 'won', { amount_usd: 2500, payment: { key: 'tranche-2' }, now: NOW }), { ok: true, total: { USD: 5000 } });
  assert.deepEqual(await record(o(i), 'l-res', 'won', { amount_usd: 2500, payment: { key: 'tranche-2' }, now: NOW }), { ok: false, note: 'Already tracked.' });
  assert.deepEqual(await record(o(i), 'l-res', 'won', { amount_usd: 6000, payment: { key: 'tranche-3' }, now: NOW }), { ok: false, note: "Over the program's $10,000 cap; nothing recorded." });
  assert.deepEqual(await record(o(i), 'l-res', 'won', { amount_usd: 1000, payment: { key: 'tranche-3' }, now: NOW }), { ok: true, total: { USD: 6000 } });
  const [row] = await sql()`SELECT status, amount_usd FROM applications WHERE installation_id = ${i} AND program_id = 'l-res'`;
  assert.deepEqual([row.status, Number(row.amount_usd)], ['won', 6000]);
  assert.equal((await summary(o(i), [], NOW)).won, 1);
  assert.equal((await summary(o(i), [], NOW)).won_usd, 6000);
  // Each payment is kept in the history, its key with it; only the other amount is a correction.
  const paid = await sql()`SELECT amount_usd, payment_key, corrected FROM application_history WHERE owner = ${o(i)} AND program_id = 'l-res' AND status = 'won' ORDER BY at, amount_usd`;
  assert.deepEqual(paid.map((x) => `${Number(x.amount_usd)} ${x.payment_key ?? '-'} ${x.corrected}`).sort(), ['1000 tranche-3 false', '2500 - true', '2500 tranche-2 false', '3000 - false']);
  await prog('l-nr');
  await record(o(i), 'l-nr', 'applied', { now: NOW });
  await record(o(i), 'l-nr', 'no_result', { now: NOW });
  assert.deepEqual(await record(o(i), 'l-nr', 'no_result', { now: NOW }), { ok: false, note: 'Already tracked.' });
  // L16-2 (v6.1.16): the program's result over "no result" is the latest result.
  assert.deepEqual(await record(o(i), 'l-nr', 'rejected', { now: NOW }), { ok: true, corrected: true });
  assert.deepEqual(await record(o(i), 'l-nr', 'rejected', { now: NOW }), { ok: false, note: 'Already tracked.' });
  assert.deepEqual(await record(o(i), 'l-nr', 'no_result', { now: NOW }), { ok: false, note: 'That one already has a result here: rejected.' });
});

test('L16-1, L16-2 (v6.1.16, Review Focus 3): the ledger keeps the latest result; a further payment over a result that is not a win is refused and writes nothing', async () => {
  const i = await install();
  await prog('l-mirror', { max_award_usd: 10_000 });
  await record(o(i), 'l-mirror', 'applied', { now: NOW });
  const state = async () => (await sql()`SELECT status, amount_usd, note FROM applications WHERE owner = ${o(i)} AND program_id = 'l-mirror'`)
    .map((x) => [x.status, x.amount_usd === null ? null : Number(x.amount_usd), x.note])[0];
  assert.deepEqual(await record(o(i), 'l-mirror', 'won', { amount_usd: 100, now: NOW }), { ok: true });
  assert.deepEqual(await record(o(i), 'l-mirror', 'rejected', { now: NOW }), { ok: true, corrected: true });
  assert.deepEqual(await state(), ['rejected', null, null]);
  const before = await counts(i);
  assert.deepEqual(await record(o(i), 'l-mirror', 'won', { amount_usd: 10, payment: { key: 's:p2' }, now: NOW }),
    { ok: false, note: 'Further payment refused: the current result is rejected; post a win first.', current: 'rejected' });
  assert.deepEqual(await counts(i), before);
  assert.deepEqual(await state(), ['rejected', null, null]);
  // The builder's own win replaces the rejection, one corrected history row.
  assert.deepEqual(await record(o(i), 'l-mirror', 'won', { amount_usd: 150, now: NOW }), { ok: true, corrected: true });
  assert.deepEqual(await state(), ['won', 150, null]);
  assert.equal((await counts(i)).hist, before.hist + 1);
  const [last] = await sql()`SELECT status, amount_usd, corrected FROM application_history WHERE owner = ${o(i)} AND program_id = 'l-mirror' ORDER BY id DESC LIMIT 1`;
  assert.deepEqual([last.status, Number(last.amount_usd), last.corrected], ['won', 150, true]);
  const l = await summary(o(i), [], NOW);
  assert.deepEqual([l.applied, l.won, l.won_usd, l.rejected], [1, 1, 150, 0]);
  // A win in another currency (from a screen) after a dollar win: won, the currency note, no dollar amount.
  assert.deepEqual(await record(o(i), 'l-mirror', 'won', { amountNotGiven: true, note: 'amount in EUR, not converted', now: NOW }), { ok: true, corrected: true });
  assert.deepEqual(await state(), ['won', null, 'amount in EUR, not converted']);
  assert.deepEqual(await record(o(i), 'l-mirror', 'won', { amountNotGiven: true, note: 'amount in EUR, not converted', now: NOW }), { ok: false, note: CONFIRMED });
  const e = await summary(o(i), [], NOW);
  assert.deepEqual([e.won, e.won_usd], [1, 0]);
  // A no_result over a result is still refused.
  assert.deepEqual(await record(o(i), 'l-mirror', 'no_result', { now: NOW }), { ok: false, note: 'That one already has a result here: won, amount not given.' });
  // Fix round 1 (M1): a further payment over a send with no result yet is refused too, as the screen refuses it.
  await prog('l-m1');
  await record(o(i), 'l-m1', 'applied', { now: NOW });
  assert.deepEqual(await record(o(i), 'l-m1', 'won', { amount_usd: 10, payment: { key: 't:p1' }, now: NOW }),
    { ok: false, note: 'Further payment refused: no result yet; post a win first.', current: 'none' });
  assert.equal((await sql()`SELECT status FROM applications WHERE owner = ${o(i)} AND program_id = 'l-m1'`)[0].status, 'applied');
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
  // L17-1 (v6.1.16): a repeat changed nothing, so it writes no history row.
  assert.deepEqual(await counts(i), { apps: 0, hist: 1 });
  assert.deepEqual([...(await doneItems(o(i), 'l-gap', ''))], ['users']);
});

test('a done step belongs to its project: two projects of one owner never share it (v6.1.10, L1c-1)', async () => {
  const i = await install();
  await prog('l-gap-p', { eligibility: [{ kind: 'users' }, { kind: 'demo_video' }] });
  const A = 'https://github.com/acme/a';
  const B = 'name:b app';
  assert.deepEqual(await record(o(i), 'l-gap-p', 'gap_done', { item: 'users', projectKey: A, now: NOW }), { ok: true });
  assert.deepEqual([...(await doneItems(o(i), 'l-gap-p', A))], ['users']);
  assert.deepEqual([...(await doneItems(o(i), 'l-gap-p', B))], []);
  assert.deepEqual([...(await doneItems(o(i), 'l-gap-p', ''))], []);
  // The same item on the other project is new there, not a repeat.
  assert.deepEqual(await record(o(i), 'l-gap-p', 'gap_done', { item: 'users', projectKey: B, now: NOW }), { ok: true });
  assert.deepEqual(await record(o(i), 'l-gap-p', 'gap_done', { item: 'users', projectKey: B, now: NOW }), { ok: true, repeated: true });
  await record(o(i), 'l-gap-p', 'gap_done', { item: 'demo_video', projectKey: B, now: NOW });
  assert.deepEqual([...(await doneItems(o(i), 'l-gap-p', A))], ['users']);
  assert.deepEqual([...(await doneItems(o(i), 'l-gap-p', B))].sort(), ['demo_video', 'users']);
  assert.deepEqual([...((await doneOn(o(i), A)).own.get('l-gap-p') ?? [])], ['users']);
  assert.equal(await codeDoneAt(o(i), B), null);
});

test('L1e-4 (v6.1.13): a users yes on one program of a project counts for every program on it, and only that project', async () => {
  const i = await install();
  await prog('l-users-a', { eligibility: [{ kind: 'users' }] });
  await prog('l-users-b', { eligibility: [{ kind: 'users' }, { kind: 'demo_video' }] });
  const A = 'https://github.com/acme/users-a';
  await record(o(i), 'l-users-a', 'gap_done', { item: 'users', projectKey: A, now: NOW });
  await record(o(i), 'l-users-b', 'gap_done', { item: 'demo_video', projectKey: A, now: NOW });
  assert.deepEqual([...(await doneItems(o(i), 'l-users-b', A))].sort(), ['demo_video', 'users']);
  assert.deepEqual([...(await doneItems(o(i), 'l-users-c', A))], ['users']);
  assert.deepEqual([...(await doneItems(o(i), 'l-users-b', 'name:other'))], []);
  // A step that is the program's own (the demo video) stays its own; the yes said stays the program's it was said to.
  const done = await doneOn(o(i), A);
  assert.deepEqual([...done.of('l-users-a')], ['users']);
  assert.deepEqual([...(done.own.get('l-users-b') ?? [])], ['demo_video']);
  assert.equal(done.own.has('l-users-c'), false);
});

test('gap_done refuses an item that is not one of the program\'s, names the real ones and writes nothing (v6.1.6)', async () => {
  const i = await install();
  await prog('l-gap-arc', { eligibility: [{ kind: 'chain', value: 'arc' }] });
  const r = await record(o(i), 'l-gap-arc', 'gap_done', { item: 'nope', now: NOW });
  assert.deepEqual(r, { ok: false, note: 'Which change did you finish? Say the program and the change.', items: ['chain:arc', 'repo'] });
  // users only when the program has a users item (v6.1.7, C27); without an item the keys come back too (C11).
  assert.deepEqual(await record(o(i), 'l-gap-arc', 'gap_done', { item: 'users', now: NOW }), { ok: false, note: 'Which change did you finish? Say the program and the change.', items: ['chain:arc', 'repo'] });
  assert.deepEqual(await record(o(i), 'l-gap-arc', 'gap_done', { now: NOW }), { ok: false, note: 'Which change did you finish? Say the program and the change.', items: ['chain:arc', 'repo'] });
  assert.deepEqual(await counts(i), { apps: 0, hist: 0 });
  assert.deepEqual([...(await doneItems(o(i), 'l-gap-arc', ''))], []);
  assert.equal((await record(o(i), 'l-gap-arc', 'gap_done', { item: 'chain:arc', now: NOW })).ok, true);
  assert.deepEqual([...(await doneItems(o(i), 'l-gap-arc', ''))], ['chain:arc']);
});

test('L23-4 (v6.1.16): askOutcome lists every passed results date with no result on every find; each installation asks once a day', async () => {
  const i = await install();
  const j = await install();
  const past = await prog('l-ask', { results_due: { date: '2026-11-03' } });
  const future = await prog('l-ask-f', { results_due: { date: '2026-12-30' } });
  await record(o(i), 'l-ask', 'applied', { now: NOW });
  await record(o(i), 'l-ask-f', 'applied', { now: NOW });
  const list = await askOutcome(o(i), [past, future], NOW);
  assert.deepEqual(list, [{ program_id: 'l-ask', title: 'Test Grants', due_at: '2026-11-03T00:00:00.000Z' }]);
  // asked_outcome_at is kept for the record only: the next find still lists it.
  await markAsked(o(i), ['l-ask'], NOW);
  assert.deepEqual((await askOutcome(o(i), [past, future], NOW)).map((x) => x.program_id), ['l-ask']);
  // Two installations of one owner: each shows it once on the same day, and both again the next day.
  const later = new Date(NOW.getTime() + 3_600_000);
  assert.deepEqual((await outcomeAsksDue(i, o(i), list, NOW)).map((x) => x.program_id), ['l-ask']);
  assert.deepEqual(await outcomeAsksDue(i, o(i), list, later), []);
  assert.deepEqual((await outcomeAsksDue(j, o(i), list, later)).map((x) => x.program_id), ['l-ask']);
  assert.deepEqual(await outcomeAsksDue(j, o(i), list, later), []);
  const tomorrow = new Date(NOW.getTime() + DAY);
  assert.deepEqual((await outcomeAsksDue(i, o(i), list, tomorrow)).map((x) => x.program_id), ['l-ask']);
  assert.deepEqual((await outcomeAsksDue(j, o(i), list, tomorrow)).map((x) => x.program_id), ['l-ask']);
  // A result recorded ends it.
  await record(o(i), 'l-ask', 'rejected', { now: tomorrow });
  assert.deepEqual(await askOutcome(o(i), [past, future], tomorrow), []);
});

test('L23-6 (v6.1.16): closing soon is open programs not sent, by ends_at only; results due soon is its own list', async () => {
  const i = await install();
  const a = await prog('l-cs-a', { ends_at: new Date(NOW.getTime() + 5 * DAY).toISOString() });
  const b = await prog('l-cs-b', { ends_at: new Date(NOW.getTime() + 2 * DAY).toISOString() });
  const c = await prog('l-cs-c', { ends_at: new Date(NOW.getTime() + 20 * DAY).toISOString() });
  const d = await prog('l-cs-d', { ends_at: new Date(NOW.getTime() + 3 * DAY).toISOString(), results_due: { date: '2026-11-09' } });
  const e = await prog('l-cs-e', { ends_at: new Date(NOW.getTime() + 20 * DAY).toISOString(), results_due: { date: '2026-11-07' } });
  for (const id of ['l-cs-d', 'l-cs-e']) await record(o(i), id, 'applied', { now: NOW });
  const s = await summary(o(i), [a, b, c, d, e], NOW);
  assert.deepEqual(s.closing_soon.map((x) => x.program_id), ['l-cs-b', 'l-cs-a']);
  assert.deepEqual(s.results_soon!.map((x) => x.program_id), ['l-cs-e', 'l-cs-d']);
  // The applications line never counts programs not sent.
  const { ledgerCounts } = await import('./ledger');
  assert.equal(ledgerCounts(s), '2 sent, 2 waiting.');
});

test('a closed program still counts: asked_usd, closing_soon and askOutcome read its own row', async () => {
  const i = await install();
  await prog('l-closed', { results_due: { date: '2026-11-08' } });
  await record(o(i), 'l-closed', 'applied', { now: NOW });
  await upsertProgram(programFixture({ id: 'l-closed', max_award_usd: 5000, results_due: { date: '2026-11-08' }, ends_at: new Date(NOW.getTime() - 3 * DAY).toISOString() }), 'file', NOW);
  const s = await summary(o(i), [], NOW);
  assert.equal(s.asked_usd, 5000);
  // L23-6 (v6.1.16): sent and closed, so never closing soon; its results date is due soon.
  assert.deepEqual(s.closing_soon, []);
  assert.deepEqual(s.results_soon!.map((x) => x.program_id), ['l-closed']);
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
  assert.deepEqual(over, { ok: false, note: "Over the program's $5,000 cap; nothing recorded." });
  assert.deepEqual(await counts(i), before);
  assert.equal((await record(o(i), 'l-cap', 'won', { amount_usd: 5000, now: NOW })).ok, true);

  await upsertProgram(programFixture({ id: 'l-nocap' }), 'file', NOW);
  await record(o(i), 'l-nocap', 'applied', { now: NOW });
  const mid = await counts(i);
  assert.deepEqual(await record(o(i), 'l-nocap', 'won', { amount_usd: 10_000_001, now: NOW }), { ok: false, note: "Over the program's $10,000,000 cap; nothing recorded." });
  assert.deepEqual(await counts(i), mid);
  assert.equal((await record(o(i), 'l-nocap', 'won', { amount_usd: 6_000_000, now: NOW })).ok, true);
  // With a pool and no maximum, the pool is the cap.
  await upsertProgram(programFixture({ id: 'l-pool', pool_usd: 20_000 }), 'file', NOW);
  await record(o(i), 'l-pool', 'applied', { now: NOW });
  assert.deepEqual(await record(o(i), 'l-pool', 'won', { amount_usd: 20_001, now: NOW }), { ok: false, note: "Over the program's $20,000 cap; nothing recorded." });
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
  await sql()`UPDATE installations SET builder_id = ${2 ** 30} WHERE id IN (${one}, ${two})`;
  await prog('l-b1', { eligibility: [{ kind: 'users' }] });
  await record(b, 'l-b1', 'applied', { installationId: one, now: NOW });
  await record(b, 'l-b1', 'won', { installationId: two, amount_usd: 100, now: new Date(NOW.getTime() + DAY) });
  await record(b, 'l-b1', 'gap_done', { installationId: one, item: 'users', now: NOW });
  await record(b, 'l-b1', 'gap_done', { installationId: two, item: 'users', now: NOW });
  const rows = await sql()`SELECT installation_id, status FROM applications WHERE owner = ${b} AND program_id = 'l-b1'`;
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ installation_id: two, status: 'won' }]);
  const hist = await sql()`SELECT installation_id FROM application_history WHERE owner = ${b} AND program_id = 'l-b1' ORDER BY id`;
  // L17-1 (v6.1.16): the second gap_done changed nothing and writes no history row.
  assert.deepEqual(hist.map((r) => r.installation_id), [one, two, one]);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM gaps_done WHERE owner = ${b} AND program_id = 'l-b1'`)[0].n, 1);
  assert.equal((await summary(b, [], NOW)).won, 1);
  assert.deepEqual([...(await doneItems(b, 'l-b1', ''))], ['users']);
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
  // L23-4 (v6.1.16): asking marks nothing away; every find lists it until a result.
  await markAsked(o(i), ['ao-nodate-a'], NOW);
  assert.deepEqual((await askOutcome(o(i), [a, b], NOW)).map((x) => x.program_id), ['ao-nodate-a']);
  assert.deepEqual((await askOutcome(o(i), [a, b], new Date(NOW.getTime() + 2 * DAY))).map((x) => x.program_id), ['ao-nodate-a', 'ao-nodate-b']);
});

test('fix round 2 (v6.1.14): a b: ledger takes only calls of an installation linked to that builder; i: only its own', async () => {
  const { stillLinked } = await import('../v6/claims');
  const linked = await install();
  const unlinked = await install();
  const B = 2 ** 30 + 11;
  await sql()`UPDATE installations SET builder_id = ${B} WHERE id = ${linked}`;
  const at = (owner: string, i: number) => sql().begin((tx) => stillLinked(tx, owner, i)) as Promise<boolean>;
  assert.equal(await at(`b:${B}`, linked), true);
  assert.equal(await at(`b:${B + 1}`, linked), false);
  // NULL builder_id refuses whatever unlinked_at says; a missing row refuses.
  assert.equal(await at(`b:${B}`, unlinked), false);
  assert.equal(await at(`b:${B}`, 2 ** 30), false);
  assert.equal(await at(o(unlinked), unlinked), true);
  assert.equal(await at(o(linked), unlinked), false);
  // Every agent status is refused with the one line; nothing is written.
  await prog('l-fr2');
  const UNL = 'This agent was just unlinked from your account; nothing recorded.';
  for (const [status, extra] of [['applied', {}], ['won', { amount_usd: 10 }], ['skipped', {}], ['rejected', {}], ['no_result', {}]] as const)
    assert.deepEqual(await record(`b:${B}`, 'l-fr2', status, { installationId: unlinked, now: NOW, ...extra }), { ok: false, note: UNL }, status);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${`b:${B}`}`)[0].n, 0);
  // The linked one writes; a program's screen outcome (fromScreen) lands as the application's own installation.
  assert.deepEqual(await record(`b:${B}`, 'l-fr2', 'applied', { installationId: linked, now: NOW }), { ok: true });
  await sql()`UPDATE installations SET builder_id = NULL WHERE id = ${linked}`;
  assert.deepEqual(await record(`b:${B}`, 'l-fr2', 'won', { installationId: linked, amount_usd: 10, now: NOW }), { ok: false, note: UNL });
  assert.deepEqual(await record(`b:${B}`, 'l-fr2', 'won', { installationId: linked, amount_usd: 10, now: NOW, fromScreen: true }), { ok: true });
});

test('L16-7 (v6.1.16): resultOf reads a won, rejected or no-result row, else null', async () => {
  const i = await install();
  await prog('l-ro-a', { max_award_usd: 10_000 });
  await prog('l-ro-b', { max_award_usd: 10_000 });
  assert.equal(await resultOf(o(i), 'l-ro-a'), null);
  await record(o(i), 'l-ro-a', 'applied', { now: NOW });
  assert.equal(await resultOf(o(i), 'l-ro-a'), null);
  await record(o(i), 'l-ro-a', 'won', { amount_usd: 3000, now: NOW });
  const won = await resultOf(o(i), 'l-ro-a');
  assert.equal(won?.status, 'won');
  assert.equal(Number(won?.amount_usd), 3000);
  await record(o(i), 'l-ro-b', 'applied', { now: NOW });
  await record(o(i), 'l-ro-b', 'rejected', { now: NOW });
  assert.deepEqual(await resultOf(o(i), 'l-ro-b'), { status: 'rejected', amount_usd: null, amounts: null, note: null });
  // Another owner's row is not this one's.
  assert.equal(await resultOf(o(i + 100000), 'l-ro-a'), null);
});

test('ledgerCounts (L21-1, v6.1.16): the counts the find reply and /me share', async () => {
  const { ledgerCounts } = await import('./ledger');
  const l = { applied: 6, asked_usd: 0, won: 3, won_usd: 12_000, won_other: [], won_no_amount: 0, pending: 2, rejected: 1, skipped: 0, closing_soon: [] };
  assert.equal(ledgerCounts(l), '6 sent, 3 won ($12,000), 1 rejected, 2 waiting.');
  assert.equal(ledgerCounts({ ...l, won: 0, won_usd: 0, rejected: 0, pending: 6 }), '6 sent, 6 waiting.');
});

test('L17-8 (v6.1.16): paymentKeyOf strips a legacy s: or t: prefix only', () => {
  assert.equal(paymentKeyOf('final'), 'final');
  assert.equal(paymentKeyOf('s:final'), 'final');
  assert.equal(paymentKeyOf('t:final'), 'final');
  assert.equal(paymentKeyOf('x:final'), 'x:final');
  assert.equal(paymentKeyOf('t:s:final'), 's:final');
});

test('L17-2, L17-8 (v6.1.16): an older correction changes nothing; a key stored with a legacy prefix matches; history names its source', async () => {
  const i = await install();
  await prog('l-time', { max_award_usd: 10_000 });
  await record(o(i), 'l-time', 'applied', { now: NOW });
  const t = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
  assert.equal((await record(o(i), 'l-time', 'won', { amount_usd: 1000, now: t(5), fromScreen: true })).ok, true);
  assert.deepEqual(await record(o(i), 'l-time', 'rejected', { now: t(4) }), { ok: false, note: EARLIER_RESULT });
  assert.deepEqual(await record(o(i), 'l-time', 'won', { amount_usd: 2000, now: t(3) }), { ok: false, note: EARLIER_RESULT });
  // At the same time it applies.
  assert.deepEqual(await record(o(i), 'l-time', 'won', { amount_usd: 2000, now: t(5) }), { ok: true, corrected: true, replaced: { USD: 1000 } });
  // A key kept before v6.1.16 with the track prefix is the same key now, from either side.
  await sql()`INSERT INTO application_history (owner, installation_id, program_id, status, amount_usd, at, payment_key) VALUES (${o(i)}, ${i}, 'l-time', 'won', 100, ${t(6)}, 't:final')`;
  assert.deepEqual(await record(o(i), 'l-time', 'won', { amount_usd: 100, payment: { key: 'final' }, now: t(7), fromScreen: true }), { ok: false, note: 'Already tracked.' });
  const h = await sql()`SELECT status, source FROM application_history WHERE owner = ${o(i)} AND program_id = 'l-time' AND payment_key IS NULL ORDER BY id`;
  assert.deepEqual(h.map((r) => [r.status, r.source]), [['applied', 'builder'], ['won', 'screen'], ['won', 'builder']]);
  const [row] = await sql()`SELECT amount_usd, at FROM applications WHERE owner = ${o(i)} AND program_id = 'l-time'`;
  assert.deepEqual([Number(row.amount_usd), row.at.getTime()], [2000, t(5).getTime()]);
});

test('L22-8 (v6.1.16): no result counts as waiting, so the parts always sum to the sent count', async () => {
  const i = await install();
  for (const id of ['l-nr-a', 'l-nr-b']) {
    await prog(id, { max_award_usd: 10_000 });
    await record(o(i), id, 'applied', { now: NOW });
  }
  await record(o(i), 'l-nr-a', 'won', { amount_usd: 5000, now: NOW });
  await record(o(i), 'l-nr-b', 'no_result', { now: NOW });
  const { ledgerCounts } = await import('./ledger');
  const l = await summary(o(i), [], NOW);
  assert.equal(ledgerCounts(l), '2 sent, 1 won ($5,000), 1 waiting.');
  const base = { applied: 0, asked_usd: 0, won: 0, won_usd: 0, won_other: [], won_no_amount: 0, pending: 0, rejected: 0, skipped: 0, closing_soon: [] };
  for (const f of [l, { ...base, applied: 6, won: 3, won_usd: 12_000, rejected: 1, pending: 2 }, { ...base, applied: 3, won: 3, won_usd: 3500.5, won_other: [{ currency: 'EUR', amount: 2000 }] }]) {
    const parts = ledgerCounts(f).replace(/\([^)]*\)/g, '').replace(/\.$/, '').split(', ').map((x) => Number(x.split(' ')[0]));
    assert.equal(parts.slice(1).reduce((a, b) => a + b, 0), parts[0], ledgerCounts(f));
  }
  assert.equal(ledgerCounts({ ...base, applied: 3, won: 3, won_usd: 3500.5, won_other: [{ currency: 'EUR', amount: 2000 }] }), '3 sent, 3 won ($3,500.50 and EUR 2,000).');
});

test('L23-12 (v6.1.16), lane 23 K7: 181 days on, the sweep keeps the name key, its repo and the rule yes; only cached evidence goes', async () => {
  const { resolvedKey, saveReport, sweepReports } = await import('./ledger');
  const i = await install();
  await prog('l-k7');
  const repoKey = 'https://github.com/lane23/keeper';
  await saveReport(o(i), 'name:keeper', { name: 'Keeper', repo_url: repoKey } as never, NOW);
  assert.equal((await record(o(i), 'l-k7', 'gap_done', { item: 'repo', projectKey: repoKey, now: NOW })).ok, true);
  await sql()`INSERT INTO repo_cache (repo, facts, fetched_at) VALUES ('lane23/keeper-k7', '{}', ${NOW})`;
  const later = new Date(NOW.getTime() + 181 * DAY);
  assert.ok((await sweepReports(later)) >= 1);
  assert.equal(await resolvedKey(o(i), 'name:keeper'), repoKey);
  assert.deepEqual([...(await doneItems(o(i), 'l-k7', repoKey))], ['repo']);
  assert.equal((await sql()`SELECT 1 FROM repo_cache WHERE repo = 'lane23/keeper-k7'`).length, 0);
});

// ---- v6.1.16 Task 14: the application key (lane 28) ----

test('L28-4 (v6.1.16 Task 14): pickRow takes this project\'s row; a keyless or single row only where it fits', async () => {
  const { pickRow } = await import('./ledger');
  const rows = [{ project_id: 'https://github.com/a/x', s: 1 }, { project_id: 'name:y', s: 2 }];
  assert.equal(pickRow(rows, 'name:y')?.s, 2);
  assert.equal(pickRow(rows, 'name:z'), undefined);
  assert.equal(pickRow(rows, ''), undefined);
  assert.equal(pickRow([{ project_id: null, s: 3 }], 'name:z')?.s, 3);
  assert.equal(pickRow([{ project_id: 'name:y', s: 4 }], 'name:z'), undefined);
  assert.equal(pickRow([{ project_id: 'name:y', s: 4 }], 'name:z', true)?.s, 4);
});

test('L28-4 (v6.1.16 Task 14): two projects of one owner apply to one program; a result reaches its own project\'s row; excluded hides a send from its own project only', async () => {
  const i = await install();
  await prog('l28-k');
  assert.deepEqual(await record(o(i), 'l28-k', 'applied', { now: NOW, project_id: 'name:one' }), { ok: true });
  assert.deepEqual(await record(o(i), 'l28-k', 'applied', { now: NOW, project_id: 'name:two' }), { ok: true });
  assert.deepEqual(await record(o(i), 'l28-k', 'won', { now: NOW, project_id: 'name:two', amount_usd: 100 }), { ok: true });
  const rows = await sql()`SELECT project_id, status FROM applications WHERE owner = ${o(i)} AND program_id = 'l28-k' ORDER BY project_id`;
  assert.deepEqual(rows.map((r) => [r.project_id, r.status]), [['name:one', 'applied'], ['name:two', 'won']]);
  assert.equal((await resultOf(o(i), 'l28-k', 'name:one')), null);
  assert.equal((await resultOf(o(i), 'l28-k', 'name:two'))?.status, 'won');
  assert.ok((await excluded(o(i), (p) => p === 'name:one')).has('l28-k'));
  await prog('l28-k2');
  await record(o(i), 'l28-k2', 'applied', { now: NOW, project_id: 'name:one' });
  assert.equal((await excluded(o(i), (p) => p === 'name:three')).has('l28-k2'), false);
});

test('L28-4 (v6.1.16 Task 14): the schema run twice turns the old (owner, program) index into the project key one and backfills the repo key', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const schema = readFileSync(join(import.meta.dirname, '../../db/schema.sql'), 'utf8');
  const i = await install();
  await prog('l28-idx');
  await sql()`DROP INDEX IF EXISTS applications_owner_program_project`;
  await sql()`DELETE FROM applications WHERE program_id = 'l28-idx'`;
  // The state before Task 14: one row per owner and program.
  await sql()`DELETE FROM applications a USING applications b WHERE a.owner = b.owner AND a.program_id = b.program_id AND a.ctid < b.ctid`;
  await sql()`CREATE UNIQUE INDEX applications_owner_program ON applications (owner, program_id)`;
  await sql()`INSERT INTO applications (owner, installation_id, program_id, status, project_id) VALUES (${o(i)}, ${i}, 'l28-idx', 'applied', 'https://github.com/a/idx')`;
  await sql().unsafe(schema);
  await sql().unsafe(schema);
  const idx = (await sql()`SELECT indexname FROM pg_indexes WHERE tablename = 'applications' AND indexname LIKE 'applications_owner_program%'`).map((r) => r.indexname);
  // L35-2 (v6.1.16.1 Task 2): the identity index beside it, the old one kept for one release.
  assert.deepEqual(idx.sort(), ['applications_owner_program_identity', 'applications_owner_program_project']);
  const [row] = await sql()`SELECT project_id, repo_key, identity FROM applications WHERE program_id = 'l28-idx'`;
  assert.deepEqual([row.project_id, row.repo_key, row.identity], ['https://github.com/a/idx', 'https://github.com/a/idx', 'https://github.com/a/idx']);
  assert.deepEqual(await record(o(i), 'l28-idx', 'applied', { now: NOW, project_id: 'name:other' }), { ok: true });
});

test('FR-5 (Task 14 fix round 1): two projects of one owner win one program; the same payment key adds once on each', async () => {
  const i = await install();
  await prog('l28-fr5', { max_award_usd: 100000 });
  for (const p of ['name:one', 'name:two']) {
    assert.deepEqual(await record(o(i), 'l28-fr5', 'applied', { now: NOW, project_id: p }), { ok: true });
    assert.deepEqual(await record(o(i), 'l28-fr5', 'won', { now: NOW, project_id: p, amount_usd: 1000 }), { ok: true });
    const paid = await record(o(i), 'l28-fr5', 'won', { now: NOW, project_id: p, amount_usd: 500, payment: { key: 'p1' } });
    assert.equal(paid.ok, true, `${p} ${JSON.stringify(paid)}`);
    assert.deepEqual(await record(o(i), 'l28-fr5', 'won', { now: NOW, project_id: p, amount_usd: 500, payment: { key: 'p1' } }), { ok: false, note: 'Already tracked.' });
  }
  const rows = await sql()`SELECT project_id, amount_usd FROM applications WHERE owner = ${o(i)} AND program_id = 'l28-fr5' ORDER BY project_id`;
  assert.deepEqual(rows.map((r) => [r.project_id, Number(r.amount_usd)]), [['name:one', 1500], ['name:two', 1500]]);
  assert.deepEqual((await sql()`SELECT DISTINCT project_id FROM application_history WHERE owner = ${o(i)} AND program_id = 'l28-fr5' ORDER BY project_id`).map((r) => r.project_id), ['name:one', 'name:two']);
});

test('N2 (Task 14 fix round 1): the record-id backfill keeps the newest of two record ids on one repo, and reruns', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const schema = readFileSync(join(import.meta.dirname, '../../db/schema.sql'), 'utf8');
  await prog('l28-n2');
  const [b] = await sql()`INSERT INTO builders (github_id, login, record) VALUES (${980_000 + n}, 'n2', ${sql().json({ projects: [
    { id: 'mono-web', repo_url: 'https://github.com/Org/Mono.git/' }, { id: 'mono-api', repo_url: 'https://github.com/org/mono' }] })}) RETURNING id`;
  const i = await install();
  const owner = `b:${b.id}`;
  await sql()`INSERT INTO applications (owner, installation_id, program_id, status, project_id, at) VALUES
    (${owner}, ${i}, 'l28-n2', 'applied', 'mono-web', ${NOW}), (${owner}, ${i}, 'l28-n2', 'applied', 'mono-api', ${new Date(NOW.getTime() + DAY)})`;
  await sql().unsafe(schema);
  await sql().unsafe(schema);
  const rows = await sql()`SELECT project_id FROM applications WHERE owner = ${owner} AND program_id = 'l28-n2' ORDER BY project_id`;
  assert.deepEqual(rows.map((r) => r.project_id), ['https://github.com/org/mono', 'mono-web']);
});

test('L35-2, L35-3, L35-11, L35-20 (v6.1.16.1 Task 2): sentForRepo by key, id, parent and an off-GitHub key; a row found by identity; formerSentAt with no key', async () => {
  const { sentForRepo, formerSentAt, offHostSent } = await import('./ledger');
  await prog('l35-sfr');
  const a = await install();
  const b = await install();
  const repo = 'https://github.com/l35/sfr';
  assert.deepEqual(await record(o(a), 'l35-sfr', 'applied', { installationId: a, now: NOW, project_id: repo, repoId: 35800 }), { ok: true });
  const [row] = await sql()`SELECT identity FROM applications WHERE owner = ${o(a)} AND program_id = 'l35-sfr'`;
  assert.equal(row.identity, 'gh:35800');
  assert.equal((await sentForRepo(sql(), 'l35-sfr', repo, o(b)))?.by, 'key');
  assert.equal((await sentForRepo(sql(), 'l35-sfr', 'https://github.com/l35/other', o(b), 35800))?.by, 'id');
  assert.equal((await sentForRepo(sql(), 'l35-sfr', 'https://github.com/l35/fork', o(b), 35801, { id: 35800, key: null }))?.by, 'id');
  assert.equal((await sentForRepo(sql(), 'l35-sfr', 'https://github.com/l35/fork', o(b), 35801, { id: null, key: repo }))?.by, 'id');
  assert.equal(await sentForRepo(sql(), 'l35-sfr', 'https://github.com/l35/fork', o(b), 35801), null);
  assert.equal(await sentForRepo(sql(), 'l35-sfr', repo, o(a)), null);
  // Controller ruling: a row with this identity under another repo key is never this call's row; the identity is not
  // written twice (a rename is re-keyed before, by track's followRepoId).
  const other = await record(o(a), 'l35-sfr', 'applied', { installationId: a, now: NOW, project_id: 'https://github.com/l35/sfr-renamed', repoId: 35800 });
  assert.deepEqual(other, { ok: true });
  assert.deepEqual((await sql()`SELECT project_id, identity FROM applications WHERE owner = ${o(a)} AND program_id = 'l35-sfr' ORDER BY project_id`).map((r) => [r.project_id, r.identity]),
    [['https://github.com/l35/sfr', 'gh:35800'], ['https://github.com/l35/sfr-renamed', null]]);
  // Off GitHub, a send kept under the name never blocks another builder: advisory only.
  await prog('l35-gl');
  assert.deepEqual(await record(o(a), 'l35-gl', 'applied', { installationId: a, now: NOW, project_id: 'name:gl', offRepo: 'https://gitlab.com/l35/gl' }), { ok: true });
  assert.equal(await sentForRepo(sql(), 'l35-gl', 'https://gitlab.com/l35/gl', o(b)), null);
  assert.equal(await sql().begin((tx) => offHostSent(tx, 'l35-gl', 'https://gitlab.com/l35/gl', o(b))), true);
  assert.deepEqual(await record(o(b), 'l35-gl', 'applied', { installationId: b, now: NOW, project_id: 'name:gl2', offRepo: 'https://gitlab.com/l35/gl' }), { ok: true, off_host_sent: true });
  // An unlinked installation's former builder: with no key, any send of that program counts.
  const { upsertBuilder, linkInstallation, unlinkInstallation } = await import('../v6/builders');
  const bd = await upsertBuilder({ github_id: 935_801, login: 'l35-former', name: null, avatar_url: null }, NOW);
  const i = await install();
  await linkInstallation(i, bd.id, NOW);
  await prog('l35-former');
  for (const k of ['name:a', 'name:b'])
    assert.deepEqual(await record(`b:${bd.id}`, 'l35-former', 'applied', { installationId: i, now: NOW, project_id: k }), { ok: true });
  assert.equal(await unlinkInstallation(i, bd.id, NOW), true);
  assert.ok(await sql().begin((tx) => formerSentAt(tx, `i:${i}`, 'l35-former', '')));
  assert.equal(await sql().begin((tx) => formerSentAt(tx, `i:${i}`, 'l35-former', 'name:c')), null);
});

test('v6.1.16 Task 15 N4 (v6.1.17): a win sent outside EarnKit has no send date: the line names the result alone', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  assert.equal(applicationsLine([{ program_id: 'thiel', title: 'Thiel Fellowship', status: 'won', sent_at: null, result_at: '2026-11-11T10:00:00.000Z', amount: 'EUR 2,000' }], now), 'Your applications: Thiel Fellowship (won EUR 2,000).');
  assert.equal(applicationsLine([{ program_id: 'a', title: 'A Grant', status: 'won', sent_at: '2026-11-03T10:00:00.000Z', result_at: '2026-11-11T10:00:00.000Z', amount: '$5,000' }], now), 'Your applications: A Grant (sent Nov 3, won $5,000).');
});
