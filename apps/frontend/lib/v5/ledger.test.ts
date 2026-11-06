import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { getProgram, upsertProgram } from './programs';
import { programFixture } from './fixtures/program';
import { askOutcome, doneItems, excluded, markAsked, record, summary } from './ledger';

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

test('applied twice is one row and two history rows', async () => {
  const i = await install();
  await prog('l-twice');
  await record(o(i), 'l-twice', 'applied', { now: NOW });
  await record(o(i), 'l-twice', 'applied', { now: new Date(NOW.getTime() + DAY) });
  assert.deepEqual(await counts(i), { apps: 1, hist: 2 });
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
  await prog('l-gap');
  assert.equal((await record(o(i), 'l-gap', 'gap_done', { item: 'license', now: NOW })).ok, true);
  assert.deepEqual(await counts(i), { apps: 0, hist: 1 });
  assert.deepEqual([...(await doneItems(o(i), 'l-gap'))], ['license']);
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
  assert.deepEqual(await record(o(i), 'l-sk', 'applied', { now: NOW }), { ok: false, note: 'That one already has a result here.' });
  assert.deepEqual(await counts(i), before);
});

test('won above the program max is refused and writes nothing; with no max, above 5,000,000 is refused', async () => {
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
  assert.deepEqual(await record(o(i), 'l-nocap', 'won', { amount_usd: 5_000_001, now: NOW }), { ok: false, note: "That's more than this program pays; check the amount." });
  assert.deepEqual(await counts(i), mid);
  assert.equal((await record(o(i), 'l-nocap', 'won', { amount_usd: 5_000_000, now: NOW })).ok, true);
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
  await prog('l-b1');
  await record(b, 'l-b1', 'applied', { installationId: one, now: NOW });
  await record(b, 'l-b1', 'won', { installationId: two, amount_usd: 100, now: new Date(NOW.getTime() + DAY) });
  await record(b, 'l-b1', 'gap_done', { installationId: one, item: 'x', now: NOW });
  await record(b, 'l-b1', 'gap_done', { installationId: two, item: 'x', now: NOW });
  const rows = await sql()`SELECT installation_id, status FROM applications WHERE owner = ${b} AND program_id = 'l-b1'`;
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ installation_id: two, status: 'won' }]);
  const hist = await sql()`SELECT installation_id FROM application_history WHERE owner = ${b} AND program_id = 'l-b1' ORDER BY id`;
  assert.deepEqual(hist.map((r) => r.installation_id), [one, two, one, two]);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM gaps_done WHERE owner = ${b} AND program_id = 'l-b1'`)[0].n, 1);
  assert.equal((await summary(b, [], NOW)).won, 1);
  assert.deepEqual([...(await doneItems(b, 'l-b1'))], ['x']);
  assert.deepEqual(await counts(one), { apps: 0, hist: 2 });
});

test('a b: owner without the writing installation is refused', async () => {
  await prog('l-b-none');
  await assert.rejects(record(`b:${2 ** 30 + 1}`, 'l-b-none', 'applied', { now: NOW }));
});
