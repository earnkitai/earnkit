import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { upsertProgram } from './programs';
import { programFixture } from './fixtures/program';
import { track } from './track';
import { lastGaps, markFind } from './installations';

after(() => sql().end());

const NOW = new Date('2026-11-04T12:00:00Z');
async function ctx() {
  const [r] = await sql()`INSERT INTO installations (token_hash) VALUES (${'track-' + Math.random()}) RETURNING id`;
  return { installationId: r.id as number, builderId: null, now: NOW };
}

test('the six replies', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-a', title: 'Alpha Grant', max_award_usd: 9000 }), 'file', NOW);
  const say = async (input: unknown) => (await track(c, input)).show_to_builder;
  assert.equal(await say({ program_id: 't6-a', status: 'applied' }), "Tracked. I'll ask how it went when results are due.");
  assert.equal(await say({ program_id: 't6-a', status: 'won', amount_usd: 5000 }), 'Recorded: $5,000 from Alpha Grant.');
  assert.equal(await say({ program_id: 't6-a', status: 'rejected' }), 'Recorded. On to the next one.');
  assert.equal(await say({ program_id: 't6-a', status: 'no_result' }), 'Recorded.');
  assert.equal(await say({ program_id: 't6-a', status: 'skipped' }), "Skipped Alpha Grant. I won't bring it up again.");
  assert.equal(await say({ program_id: 't6-a', status: 'gap_done', item: 'users' }), 'Noted. I\'ll re-check the repo on the next look.');
  await upsertProgram(programFixture({ id: 't6-b', title: 'Beta' }), 'file', NOW);
  const r = await track(c, { program_id: 't6-b', status: 'applied' });
  assert.equal(r.agent_note, 'Call find again for the updated ledger.');
  assert.equal(r.ledger.applied, 2);
});

test('refusals say so and record nothing', async () => {
  const c = await ctx();
  const r = await track(c, { program_id: 'nope-x', status: 'applied' });
  assert.equal(r.agent_note, 'Nothing was recorded.');
  assert.ok(r.show_to_builder.length > 0);
  const w = await track(c, { program_id: 'nope-x', status: 'won' });
  assert.equal(w.agent_note, 'Nothing was recorded.');
  const u = await track(c, { program_id: 'nope-x', status: 'applied', extra: 1 });
  assert.equal(u.agent_note, 'Nothing was recorded.');
  const long = await track(c, { program_id: 'nope-x', status: 'applied', note: 'x'.repeat(281) });
  assert.equal(long.agent_note, 'Nothing was recorded.');
  const n = (await sql()`SELECT count(*)::int AS n FROM application_history WHERE installation_id = ${c.installationId}`)[0].n;
  assert.equal(n, 0);
});

test('started then applied: the claim, then what was sent and by whom', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-s', title: 'Start Grant' }), 'file', NOW);
  const s = await track(c, { program_id: 't6-s', status: 'started', project_id: 'earnkit' });
  assert.equal(s.show_to_builder, 'Started. Nothing else will submit this one for 24 hours.');
  assert.equal(s.ledger.applied, 0);
  assert.equal('already_started' in s, false);
  const a = await track({ ...c, now: new Date(NOW.getTime() + 3_600_000) }, { program_id: 't6-s', status: 'applied', submitted_by: 'agent', fields_used: ['project_name'], project_id: 'earnkit' });
  assert.equal(a.show_to_builder, "Tracked. I'll ask how it went when results are due.");
  assert.equal(a.ledger.applied, 1);
  const [row] = await sql()`SELECT status, submitted_by, fields_used, project_id, claimed_at FROM applications WHERE program_id = 't6-s' AND installation_id = ${c.installationId}`;
  assert.deepEqual([row.status, row.submitted_by, row.fields_used, row.project_id], ['applied', 'agent', ['project_name'], 'earnkit']);
  assert.equal((row.claimed_at as Date).toISOString(), NOW.toISOString());
});

let gh = 931_000;
/** Two installations linked to one builder (the first named `client`, the second unnamed), as track contexts. */
async function twoAgents(client: string | null = 'Claude Code') {
  const { linkInstallation, upsertBuilder } = await import('../v6/builders');
  const b = await upsertBuilder({ github_id: ++gh, login: 'tr' + gh, name: 'Tr', avatar_url: null }, NOW);
  const make = async (name: string | null) => {
    const [r] = await sql()`INSERT INTO installations (token_hash, client_name) VALUES (${'track-' + Math.random()}, ${name}) RETURNING id`;
    await linkInstallation(r.id as number, b.id, NOW);
    return { installationId: r.id as number, builderId: b.id as number | null, now: NOW };
  };
  return { a: await make(client), c: await make(null), owner: 'b:' + b.id };
}

test("a second started within 24 hours from another of the builder's agents answers already_started with the agent and the time", async () => {
  const { a, c } = await twoAgents();
  await upsertProgram(programFixture({ id: 't6-d', title: 'Double Grant' }), 'file', NOW);
  await track(a, { program_id: 't6-d', status: 'started' });
  const again = await track({ ...c, now: new Date(NOW.getTime() + 2 * 3_600_000) }, { program_id: 't6-d', status: 'started' });
  assert.equal(again.already_started, true);
  assert.equal(again.show_to_builder, 'Double Grant is already being handled since 12:00 UTC by Claude Code.');
  assert.equal(again.agent_note, 'Do not submit this one; call find again later.');
  // Without a client name: "another agent".
  const two = await twoAgents();
  await track(two.c, { program_id: 't6-d', status: 'started' });
  const b = await track(two.a, { program_id: 't6-d', status: 'started' });
  assert.equal(b.show_to_builder, 'Double Grant is already being handled since 12:00 UTC by another agent.');
});

test('the same installation starting again within 24 hours is ok and moves the claim; another installation is still held', async () => {
  const { a, c, owner } = await twoAgents();
  await upsertProgram(programFixture({ id: 't6-re', title: 'Again Grant' }), 'file', NOW);
  await track(a, { program_id: 't6-re', status: 'started' });
  const later = new Date(NOW.getTime() + 3 * 3_600_000);
  const again = await track({ ...a, now: later }, { program_id: 't6-re', status: 'started' });
  assert.equal(again.show_to_builder, 'Started. Nothing else will submit this one for 24 hours.');
  assert.equal('already_started' in again, false);
  const [row] = await sql()`SELECT status, claimed_at, claimed_by FROM applications WHERE owner = ${owner} AND program_id = 't6-re'`;
  assert.deepEqual([row.status, (row.claimed_at as Date).toISOString(), row.claimed_by], ['started', later.toISOString(), a.installationId]);
  const other = await track({ ...c, now: new Date(later.getTime() + 3_600_000) }, { program_id: 't6-re', status: 'started' });
  assert.equal(other.already_started, true);
  assert.equal(other.show_to_builder, 'Again Grant is already being handled since 15:00 UTC by Claude Code.');
});

test('started on an application already sent says it was sent, for any installation', async () => {
  const { a, c } = await twoAgents();
  await upsertProgram(programFixture({ id: 't6-sent', title: 'Sent Grant' }), 'file', NOW);
  await track(a, { program_id: 't6-sent', status: 'applied', submitted_by: 'agent' });
  for (const who of [a, c]) {
    const r = await track({ ...who, now: new Date(NOW.getTime() + 3_600_000) }, { program_id: 't6-sent', status: 'started' });
    assert.equal(r.already_started, true);
    assert.equal(r.show_to_builder, 'Sent Grant was already sent.');
    assert.equal(r.agent_note, 'Do not submit this one; it was already sent.');
  }
});

test('started for an unknown program refuses and records nothing', async () => {
  const c = await ctx();
  const r = await track(c, { program_id: 'nope-started', status: 'started' });
  assert.equal(r.agent_note, 'Nothing was recorded.');
  assert.equal(r.show_to_builder, "I don't know that program.");
  const bad = await track(c, { program_id: 't6-a', status: 'applied', submitted_by: 'robot' });
  assert.equal(bad.agent_note, 'Nothing was recorded.');
  const n = (await sql()`SELECT count(*)::int AS n FROM applications WHERE installation_id = ${c.installationId}`)[0].n;
  assert.equal(n, 0);
});

test('started over a skip: the skipped sentence; an older claim names its day', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-k', title: 'Kept Out' }), 'file', NOW);
  await track(c, { program_id: 't6-k', status: 'skipped' });
  const r = await track(c, { program_id: 't6-k', status: 'started' });
  assert.equal(r.show_to_builder, "You skipped Kept Out here; say unskip it if you want it back.");
  assert.equal(r.agent_note, 'Do not submit this one.');
  assert.equal('already_started' in r, false);
  // Unskip takes it back: the row goes, a claim works again; unskipping a program that is not skipped is refused.
  const back = await track(c, { program_id: 't6-k', status: 'unskip' });
  assert.equal(back.show_to_builder, 'Unskipped Kept Out. It can come back in the list.');
  assert.equal((await track(c, { program_id: 't6-k', status: 'started' })).show_to_builder, 'Started. Nothing else will submit this one for 24 hours.');
  assert.equal((await track(c, { program_id: 't6-k', status: 'unskip' })).show_to_builder, "That one isn't skipped here.");
  await upsertProgram(programFixture({ id: 't6-y', title: 'Yesterday Grant' }), 'file', NOW);
  const two = await twoAgents(null);
  await track({ ...two.a, now: new Date('2026-11-03T22:10:00Z') }, { program_id: 't6-y', status: 'started' });
  const again = await track(two.c, { program_id: 't6-y', status: 'started' });
  assert.equal(again.show_to_builder, 'Yesterday Grant is already being handled since Nov 3, 22:10 UTC by another agent.');
});

test('applied sets auto_applied from the builder record at that moment; unlinked never', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_001, login: 'auto', name: 'Auto', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  const linked = { ...c, builderId: b.id };
  await upsertProgram(programFixture({ id: 't6-on', title: 'On' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't6-off', title: 'Off' }), 'file', NOW);
  await track(linked, { program_id: 't6-off', status: 'applied', submitted_by: 'agent' });
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true } }, 'builder', NOW).record, NOW);
  await track(linked, { program_id: 't6-on', status: 'applied', submitted_by: 'agent' });
  // With standing approval on, a form the builder sent themselves is still not an auto-applied one.
  await upsertProgram(programFixture({ id: 't6-self', title: 'Self' }), 'file', NOW);
  await track(linked, { program_id: 't6-self', status: 'applied', submitted_by: 'builder' });
  const rows = await sql()`SELECT program_id, auto_applied FROM applications WHERE owner = ${'b:' + b.id} ORDER BY program_id`;
  assert.deepEqual(rows.map((r) => [r.program_id, r.auto_applied]), [['t6-off', false], ['t6-on', true], ['t6-self', false]]);
  const u = await ctx();
  await track(u, { program_id: 't6-on', status: 'applied', submitted_by: 'agent' });
  const [ur] = await sql()`SELECT auto_applied FROM applications WHERE installation_id = ${u.installationId}`;
  assert.equal(ur.auto_applied, false);
});

test('started on a program the last find called a gap says so', async () => {
  const two = await twoAgents();
  await upsertProgram(programFixture({ id: 't6-gap', title: 'Gap Grant' }), 'file', NOW);
  await markFind(two.a.installationId, NOW, { 't6-gap': 'add Base Builder Codes' });
  const r = await track(two.a, { program_id: 't6-gap', status: 'started' });
  assert.equal(r.show_to_builder, 'Started. When I last looked it was still one change away: add Base Builder Codes. Make sure that is done first.');
  assert.equal(r.agent_note, 'Make the change before you submit, or call find again to check it. Then fill the form from the fields, submit, and call track with applied, submitted_by and fields_used.');
  assert.equal('already_started' in r, false);
  const other = await track({ ...two.c, now: new Date(NOW.getTime() + 3_600_000) }, { program_id: 't6-gap', status: 'started' });
  assert.equal(other.already_started, true);
});

test('started on a program the last find did not call a gap keeps the plain line', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-nogap' }), 'file', NOW);
  await markFind(c.installationId, NOW, { 'some-other-program': 'add Base Builder Codes' });
  const r = await track(c, { program_id: 't6-nogap', status: 'started' });
  assert.equal(r.show_to_builder, 'Started. Nothing else will submit this one for 24 hours.');
  assert.equal(r.agent_note, 'Fill the form from the fields, submit, then call track with applied, submitted_by and fields_used.');
});

test('gap_done forgets the remembered gap, so started keeps the plain line', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-gapdone' }), 'file', NOW);
  await markFind(c.installationId, NOW, { 't6-gapdone': 'add Base Builder Codes', 't6-keep': 'a demo video' });
  await track(c, { program_id: 't6-gapdone', status: 'gap_done', item: 'users' });
  const r = await track(c, { program_id: 't6-gapdone', status: 'started' });
  assert.equal(r.show_to_builder, 'Started. Nothing else will submit this one for 24 hours.');
  assert.deepEqual(await lastGaps(c.installationId), { 't6-keep': 'a demo video' });
});

test('gap_done with an item the program does not have is refused, and the remembered gap stays (v6.1.6)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-gapbad', eligibility: [{ kind: 'chain', value: 'arc' }] }), 'file', NOW);
  await markFind(c.installationId, NOW, { 't6-gapbad': 'deploy on Arc' });
  const r = await track(c, { program_id: 't6-gapbad', status: 'gap_done', item: 'nope' });
  assert.equal(r.show_to_builder, 'Tell me which item you finished.');
  assert.equal(r.agent_note, 'Items for this program: chain:arc, users. Call track gap_done with one of them.');
  assert.deepEqual(await lastGaps(c.installationId), { 't6-gapbad': 'deploy on Arc' });
});
