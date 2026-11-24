/**
 * v3.8 E9 (plan item 6, cutover A4, A6, A9): the track state machine behind `track_v2`: proof on applied, a reason on
 * held, the parked and after-send states, closed past deadline, the paged list and catalog reads (a full read equals
 * the database count), deadlines in the builder's timezone. Off, track and find are unchanged.
 */
import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { TrackInput, track, trackAdvertised, trackDescription, V2_TRACK_TEXT } from '../v5/track';
import { FindArgs, find } from '../v5/find';
import { listListedPrograms, upsertProgram } from '../v5/programs';
import { programFixture } from '../v5/fixtures/program';
import { withCatalog } from '../v5/catalog-page';
import { EMPTY_RECORD } from './record';
import { saveRecord, upsertBuilder } from './builders';
import { PROOF_NEEDED, REASON_NEEDED, inZone, listTracked, stateOf } from './track-states';

after(() => sql().end());

const NOW = new Date('2026-11-24T09:00:00Z');
const ENDS = '2026-12-01T18:29:00Z';
const PROOF = { url: 'https://example.org/thanks/123' };
beforeEach(() => {
  process.env.EARNKIT_FLAGS = 'track_v2';
});
afterEach(() => {
  delete process.env.EARNKIT_FLAGS;
});

let gh = 770_000 + Math.floor(Math.random() * 10_000);
async function ctx(builderId: number | null = null) {
  const [r] = await sql()`INSERT INTO installations (token_hash, builder_id) VALUES (${'ts-' + Math.random()}, ${builderId}) RETURNING id`;
  return { installationId: r.id as number, builderId, now: NOW };
}
const owner = (c: { installationId: number; builderId: number | null }) => (c.builderId !== null ? `b:${c.builderId}` : `i:${c.installationId}`);
let k = 0;
async function program(over: Record<string, unknown> = {}) {
  const id = `ts-${++k}-${Math.random().toString(36).slice(2, 7)}`;
  await upsertProgram(programFixture({ id, title: `State Grant ${id}`, ends_at: ENDS, ...over }), 'file', NOW);
  return id;
}
const stateIn = async (c: Awaited<ReturnType<typeof ctx>>, id: string, now = NOW) => {
  const page = await listTracked(owner(c), c.builderId, { limit: 200 }, now);
  assert.ok(!('error' in page));
  return page.items.find((x) => x.program_id === id);
};

test('off: proof and held_reason are unknown arguments, the new statuses are refused, the tool lists are unchanged', async () => {
  delete process.env.EARNKIT_FLAGS;
  const c = await ctx();
  const id = await program();
  assert.equal((await track(c, { program_id: id, status: 'applied', proof: PROOF })).refused, true);
  assert.equal((await track(c, { program_id: id, status: 'registered' })).refused, true);
  assert.equal((await track(c, { action: 'list' })).refused, true);
  assert.equal((await track(c, { program_id: id, status: 'applied' })).show_to_builder, `Sent State Grant ${id}.`);
  assert.equal(trackAdvertised({}), TrackInput);
  assert.equal(trackDescription({}).includes(V2_TRACK_TEXT), false);
  assert.equal(withCatalog(FindArgs, {}), FindArgs);
});

test('A9: applied without proof is refused and writes nothing; with proof it is stored', async () => {
  const c = await ctx();
  const id = await program();
  const bare = await track(c, { program_id: id, status: 'applied' });
  assert.equal(bare.refused, true);
  assert.equal(bare.agent_note, `${PROOF_NEEDED.replace(/[.;\s]+$/, '')}; fix it and call again.`);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${owner(c)}`)[0].n, 0);
  assert.equal((await track(c, { program_id: id, status: 'applied', proof: { url: 'http://plain.example' } })).refused, true);
  const sent = await track(c, { program_id: id, status: 'applied', proof: { confirmation: 'Email "We got your application" #A-77' }, round: 'Q4 2026' });
  assert.equal(sent.refused, undefined);
  const row = await stateIn(c, id);
  assert.equal(row?.state, 'applied');
  assert.deepEqual(row?.proof, { confirmation: 'Email "We got your application" #A-77' });
  assert.equal(row?.round, 'Q4 2026');
  assert.equal((await track(c, { program_id: id, status: 'started', proof: PROOF })).refused, true, 'proof goes with applied only');
});

test('held needs a reason code; the parked states and a later send', async () => {
  const c = await ctx();
  const id = await program();
  const noReason = await track(c, { program_id: id, status: 'held' });
  assert.equal(noReason.refused, true);
  assert.match(noReason.agent_note, new RegExp(REASON_NEEDED.slice(20, 60)));
  assert.equal((await track(c, { program_id: id, status: 'held', held_reason: 'tokens' })).refused, true);
  assert.equal((await track(c, { program_id: id, status: 'held', held_reason: 'kyc' })).refused, undefined);
  assert.deepEqual({ state: (await stateIn(c, id))?.state, reason: (await stateIn(c, id))?.held_reason }, { state: 'held', reason: 'kyc' });

  const reg = await program();
  const r = await track(c, { program_id: reg, status: 'registered' });
  assert.equal(r.show_to_builder, `Registered on State Grant ${reg}; nothing is sent yet.`);
  assert.equal((await stateIn(c, reg))?.state, 'registered');
  const found = await program();
  await track(c, { program_id: found, status: 'found' });
  assert.equal((await stateIn(c, found))?.state, 'found');
  const build = await program();
  await track(c, { program_id: build, status: 'needs_build' });
  assert.equal((await stateIn(c, build))?.state, 'needs_build');
  // The send supersedes the parked stage.
  assert.equal((await track(c, { program_id: reg, status: 'applied', proof: PROOF })).refused, undefined);
  assert.equal((await stateIn(c, reg))?.state, 'applied');
  // Closed past deadline: a parked row whose program's deadline passed.
  assert.equal((await stateIn(c, found, new Date('2026-12-02T00:00:00Z')))?.state, 'closed_past_deadline');
  assert.equal((await stateIn(c, reg, new Date('2026-12-02T00:00:00Z')))?.state, 'applied');
});

test('interview after a send, delivered after a win; neither before', async () => {
  const c = await ctx();
  const id = await program();
  const early = await track(c, { program_id: id, status: 'interview' });
  assert.equal(early.refused, true);
  assert.equal(early.show_to_builder, `State Grant ${id} isn't sent yet. Tell me once it's in.`);
  await track(c, { program_id: id, status: 'applied', proof: PROOF });
  assert.equal((await track(c, { program_id: id, status: 'interview' })).show_to_builder, `State Grant ${id}: interview noted.`);
  assert.equal((await stateIn(c, id))?.state, 'interview');
  assert.equal((await track(c, { program_id: id, status: 'delivered' })).refused, true);
  assert.equal((await track(c, { program_id: id, status: 'won', amount_usd: 2500 })).refused, undefined);
  assert.equal((await stateIn(c, id))?.state, 'won');
  assert.equal((await track(c, { program_id: id, status: 'delivered' })).refused, undefined);
  assert.equal((await stateIn(c, id))?.state, 'delivered');
  const history = await sql()`SELECT status FROM application_history WHERE owner = ${owner(c)} AND program_id = ${id} ORDER BY id`;
  assert.deepEqual(history.map((h) => h.status), ['applied', 'interview', 'won', 'delivered']);
});

test('A4: track list pages through every row; the full read equals the database count', async () => {
  const c = await ctx();
  for (let n = 0; n < 7; n++) await track(c, { program_id: await program(), status: 'found' });
  await track(c, { program_id: await program(), status: 'skipped' });
  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  for (;;) {
    const r = await track(c, { action: 'list', limit: 3, ...(cursor ? { cursor } : {}) });
    assert.equal(r.refused, undefined);
    seen.push(...r.applications!.map((x) => x.program_id));
    pages++;
    if (!r.next_cursor) {
      assert.equal(r.total, 8);
      break;
    }
    cursor = r.next_cursor;
  }
  assert.equal(pages, 3);
  const [{ n }] = await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${owner(c)}`;
  assert.equal(seen.length, n);
  assert.equal(new Set(seen).size, n);
  assert.equal((await track(c, { action: 'list', cursor: 'not-a-cursor' })).refused, true);
  assert.equal((await track(c, { action: 'list', limit: 0 })).refused, true);
});

test('deadlines are stored as an instant with the zone and shown in the builder timezone (IST for India)', async () => {
  assert.equal(inZone('2026-11-24T23:59:00Z', 'Asia/Kolkata'), 'Nov 25, 2026, 5:29 AM IST');
  assert.match(inZone('2026-11-24T23:59:00Z', 'UTC'), /^Nov 24, 2026, 11:59 PM UTC$/);
  const b = await upsertBuilder({ github_id: ++gh, login: 'tzjenil', name: null, avatar_url: null }, NOW);
  await saveRecord(b.id, { ...EMPTY_RECORD, person: { timezone: 'Asia/Kolkata' } }, NOW);
  const c = await ctx(b.id);
  const id = await program({ ends_at: '2026-11-30T23:59:00Z', tz: 'UTC' });
  await track(c, { program_id: id, status: 'found' });
  const row = await stateIn(c, id);
  assert.deepEqual(row?.deadline, { at: '2026-11-30T23:59:00.000Z', zone: 'UTC', shown: 'Dec 1, 2026, 5:29 AM IST' });
});

test('A4: find catalog pages through every listed program; the full read equals the listed count', async () => {
  const c = await ctx();
  const ids: string[] = [];
  let cursor: string | undefined;
  let total = -1;
  for (;;) {
    const r = (await find(c, { catalog: { limit: 7, ...(cursor ? { cursor } : {}) } })) as unknown as { programs: { program_id: string }[]; total: number; next_cursor: string | null };
    ids.push(...r.programs.map((p) => p.program_id));
    total = r.total;
    if (!r.next_cursor) break;
    cursor = r.next_cursor;
  }
  const listed = await listListedPrograms(NOW);
  assert.equal(total, listed.length);
  assert.equal(ids.length, listed.length);
  assert.deepEqual([...ids].sort(), listed.map((p) => p.id).sort());
});

test('stateOf: the stage counts only while the status matches', () => {
  const held = new Date();
  assert.equal(stateOf({ status: 'started', held_at: null, stage: null }, null, NOW), 'started');
  assert.equal(stateOf({ status: 'started', held_at: held, stage: 'registered' }, null, NOW), 'registered');
  assert.equal(stateOf({ status: 'applied', held_at: null, stage: 'registered' }, null, NOW), 'applied');
  assert.equal(stateOf({ status: 'won', held_at: null, stage: 'interview' }, null, NOW), 'won');
  assert.equal(stateOf({ status: 'started', held_at: held, stage: null }, '2026-11-01T00:00:00Z', NOW), 'closed_past_deadline');
  assert.equal(stateOf({ status: 'skipped', held_at: null, stage: null }, '2026-11-01T00:00:00Z', NOW), 'skipped');
});
