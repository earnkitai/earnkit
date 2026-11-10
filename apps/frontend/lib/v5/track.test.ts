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
  // One result per program (v6.1.7): each result on its own program.
  await upsertProgram(programFixture({ id: 't6-a2', title: 'Alpha Two' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't6-a3', title: 'Alpha Three' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't6-a4', title: 'Alpha Four' }), 'file', NOW);
  for (const id of ['t6-a2', 't6-a3']) await say({ program_id: id, status: 'applied' });
  assert.equal(await say({ program_id: 't6-a2', status: 'rejected' }), 'Recorded. On to the next one.');
  assert.equal(await say({ program_id: 't6-a3', status: 'no_result' }), 'Recorded.');
  assert.equal(await say({ program_id: 't6-a4', status: 'skipped' }), "Skipped Alpha Four. I won't bring it up again.");
  await upsertProgram(programFixture({ id: 't6-a5', title: 'Alpha Users', eligibility: [{ kind: 'users' }] }), 'file', NOW);
  assert.equal(await say({ program_id: 't6-a5', status: 'gap_done', item: 'users' }), 'Noted.');
  await upsertProgram(programFixture({ id: 't6-b', title: 'Beta' }), 'file', NOW);
  const r = await track(c, { program_id: 't6-b', status: 'applied' });
  assert.equal(r.agent_note, 'Call find again for the updated ledger.');
  assert.equal(r.ledger.applied, 4);
});

test('started on a program that is not open says so and claims nothing (v6.1.7, B7)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't7-closed', title: 'Closed Grant', status: 'closed' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't7-past', title: 'Past Grant', ends_at: '2026-11-01T00:00:00Z' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't7-soon', title: 'Soon Grant', status: 'upcoming', opens_note: 'Opens in December' }), 'file', NOW);
  for (const [id, title] of [['t7-closed', 'Closed Grant'], ['t7-past', 'Past Grant'], ['t7-soon', 'Soon Grant']]) {
    const r = await track(c, { program_id: id, status: 'started' });
    assert.equal(r.show_to_builder, `${title} is not open; nothing to start.`);
    assert.equal(r.agent_note, 'Do not submit this one; call find for what is open.');
    assert.equal('already_started' in r, false);
  }
  const n = (await sql()`SELECT count(*)::int AS n FROM applications WHERE installation_id = ${c.installationId}`)[0].n;
  assert.equal(n, 0);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM application_history WHERE installation_id = ${c.installationId}`)[0].n, 0);
});

test('one application and one result per program, in builder words (v6.1.7, B8, B13, C28)', async () => {
  const { a, c } = await twoAgents();
  await upsertProgram(programFixture({ id: 't7-one', title: 'One Grant' }), 'file', NOW);
  await track(a, { program_id: 't7-one', status: 'applied', submitted_by: 'agent' });
  const second = await track(c, { program_id: 't7-one', status: 'applied', submitted_by: 'agent' });
  assert.equal(second.show_to_builder, 'Already sent here on Nov 4 by Claude Code; nothing recorded.');
  assert.equal(second.agent_note, 'Nothing was recorded.');
  assert.equal((await track(a, { program_id: 't7-one', status: 'won', amount_usd: 0.4 })).show_to_builder, 'Tell me how much you won, as whole dollars.');
  assert.equal((await track(a, { program_id: 't7-one', status: 'won', amount_usd: 3000 })).show_to_builder, 'Recorded: $3,000 from One Grant.');
  const rej = await track(c, { program_id: 't7-one', status: 'rejected' });
  assert.equal(rej.show_to_builder, 'That one already has a result here: won $3,000.');
  assert.equal(rej.ledger.won_usd, 3000);
  assert.equal((await track(c, { program_id: 't7-one', status: 'won', amount_usd: 3000 })).show_to_builder, 'Already recorded.');
  assert.equal((await track(c, { program_id: 't7-one', status: 'skipped' })).show_to_builder, 'That one already has a result here; nothing to skip.');
});

test('Review Focus 1: A started, B applied, A applied is one application, sent by B; A hears it was already sent', async () => {
  const { a, c, owner } = await twoAgents();
  await sql()`UPDATE installations SET client_name = 'Codex' WHERE id = ${c.installationId}`;
  await upsertProgram(programFixture({ id: 't7-rf1', title: 'Focus Grant' }), 'file', NOW);
  assert.equal((await track(a, { program_id: 't7-rf1', status: 'started' })).show_to_builder, 'Started. Your other agents leave this one alone for 24 hours.');
  const sent = await track({ ...c, now: new Date(NOW.getTime() + 3_600_000) }, { program_id: 't7-rf1', status: 'applied', submitted_by: 'agent' });
  assert.equal(sent.show_to_builder, "Tracked. I'll ask how it went when results are due.");
  const again = await track({ ...a, now: new Date(NOW.getTime() + 2 * 3_600_000) }, { program_id: 't7-rf1', status: 'applied', submitted_by: 'agent' });
  assert.equal(again.show_to_builder, 'Already sent here on Nov 4 by Codex; nothing recorded.');
  assert.equal(again.agent_note, 'Nothing was recorded.');
  assert.equal(again.ledger.applied, 1);
  const rows = await sql()`SELECT status, installation_id FROM applications WHERE owner = ${owner} AND program_id = 't7-rf1'`;
  assert.deepEqual(rows.map((r) => [r.status, r.installation_id]), [['applied', c.installationId]]);
});

test('a result for a program gone from the catalog uses the title stored when it was sent (v6.1.7, C36)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't7-gone', title: 'Gone Grant' }), 'file', NOW);
  await track(c, { program_id: 't7-gone', status: 'applied' });
  await sql()`DELETE FROM programs WHERE id = 't7-gone'`;
  const r = await track(c, { program_id: 't7-gone', status: 'won', amount_usd: 2500 });
  assert.equal(r.show_to_builder, 'Recorded: $2,500 from Gone Grant.');
  assert.equal(r.ledger.won_usd, 2500);
});

test('refusals say so and record nothing', async () => {
  const c = await ctx();
  const r = await track(c, { program_id: 'nope-x', status: 'applied' });
  assert.equal(r.agent_note, 'Nothing was recorded.');
  assert.ok(r.show_to_builder.length > 0);
  const w = await track(c, { program_id: 'nope-x', status: 'won' });
  assert.equal(w.agent_note, 'Nothing was recorded.');
  const u = await track(c, { program_id: 'nope-x', status: 'applied', extra: 1 });
  assert.equal(u.show_to_builder, 'I could not read that. Send the program, a status, and for a win the amount.');
  assert.equal(u.agent_note, 'Nothing was recorded. input: Unrecognized key: "extra".');
  const long = await track(c, { program_id: 'nope-x', status: 'applied', note: 'x'.repeat(281) });
  assert.equal(long.agent_note, 'Nothing was recorded. note: Too big: expected string to have <=280 characters.');
  const n = (await sql()`SELECT count(*)::int AS n FROM application_history WHERE installation_id = ${c.installationId}`)[0].n;
  assert.equal(n, 0);
});

test('started then applied: the claim, then what was sent and by whom; the record project kept (C17)', async () => {
  const { a: c } = await twoAgents();
  const { getRecord, saveRecord } = await import('../v6/builders');
  const { mergeRecord } = await import('../v6/record');
  await saveRecord(c.builderId!, mergeRecord(await getRecord(c.builderId!), { projects: [{ id: 'earnkit', name: 'EarnKit' }] }, 'builder', NOW).record, NOW);
  await upsertProgram(programFixture({ id: 't6-s', title: 'Start Grant' }), 'file', NOW);
  const s = await track(c, { program_id: 't6-s', status: 'started', project_id: 'earnkit' });
  assert.equal(s.show_to_builder, 'Started. Your other agents leave this one alone for 24 hours.');
  assert.equal(s.ledger.applied, 0);
  assert.equal('already_started' in s, false);
  const a = await track({ ...c, now: new Date(NOW.getTime() + 3_600_000) }, { program_id: 't6-s', status: 'applied', submitted_by: 'agent', fields_used: ['project_name'], project_id: 'earnkit' });
  assert.equal(a.show_to_builder, "Tracked. I'll ask how it went when results are due.");
  assert.equal(a.ledger.applied, 1);
  assert.doesNotMatch(a.agent_note, /not known/);
  const [row] = await sql()`SELECT status, submitted_by, fields_used, project_id, claimed_at FROM applications WHERE program_id = 't6-s' AND installation_id = ${c.installationId}`;
  assert.deepEqual([row.status, row.submitted_by, row.fields_used, row.project_id], ['applied', 'agent', ['project_name'], 'earnkit']);
  assert.equal((row.claimed_at as Date).toISOString(), NOW.toISOString());
});

test('C17: an unknown project_id is ignored, and named in the agent note', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-p', title: 'Project Grant' }), 'file', NOW);
  const s = await track(c, { program_id: 't6-p', status: 'started', project_id: 'nope' });
  assert.equal(s.show_to_builder, 'Started.');
  assert.equal(s.agent_note, 'Fill the form from the fields, submit, then call track with applied, submitted_by and fields_used. project_id nope is not known; ignored.');
  const a = await track(c, { program_id: 't6-p', status: 'applied', submitted_by: 'agent', project_id: 'nope' });
  assert.match(a.agent_note, /project_id nope is not known; ignored\.$/);
  const [row] = await sql()`SELECT project_id FROM applications WHERE program_id = 't6-p' AND installation_id = ${c.installationId}`;
  assert.equal(row.project_id, null);
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
  assert.equal(again.show_to_builder, 'Started. Your other agents leave this one alone for 24 hours.');
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
  assert.equal(bad.agent_note, 'Nothing was recorded. submitted_by: Invalid option: expected one of "agent"|"builder".');
  const n = (await sql()`SELECT count(*)::int AS n FROM applications WHERE installation_id = ${c.installationId}`)[0].n;
  assert.equal(n, 0);
});

test('started over a skip: the skipped sentence; an older claim names its day', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-k', title: 'Kept Out' }), 'file', NOW);
  await track(c, { program_id: 't6-k', status: 'skipped' });
  const r = await track(c, { program_id: 't6-k', status: 'started' });
  assert.equal(r.show_to_builder, 'You skipped that one. Say unskip to bring it back.');
  assert.equal(r.agent_note, 'Do not submit this one.');
  assert.equal('already_started' in r, false);
  // Unskip takes it back: the row goes, a claim works again; unskipping a program that is not skipped is refused.
  const back = await track(c, { program_id: 't6-k', status: 'unskip' });
  assert.equal(back.show_to_builder, 'Unskipped Kept Out. It can come back in the list.');
  assert.equal((await track(c, { program_id: 't6-k', status: 'started' })).show_to_builder, 'Started.');
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
  await markFind(two.a.installationId, NOW, { 't6-gap': { what: 'add Base Builder Codes', kind: 'builder_codes', item: 'builder_codes' } });
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
  await markFind(c.installationId, NOW, { 'some-other-program': { what: 'add Base Builder Codes', kind: 'builder_codes', item: 'builder_codes' } });
  const r = await track(c, { program_id: 't6-nogap', status: 'started' });
  assert.equal(r.show_to_builder, 'Started.');
  assert.equal(r.agent_note, 'Fill the form from the fields, submit, then call track with applied, submitted_by and fields_used.');
});

test('gap_done forgets the remembered gap, so started keeps the plain line', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-gapdone', eligibility: [{ kind: 'users' }] }), 'file', NOW);
  const keep = { what: 'a demo video', kind: 'demo_video', item: 'demo_video' };
  await markFind(c.installationId, NOW, { 't6-gapdone': { what: 'tell me if real people use it', kind: 'users', item: 'users' }, 't6-keep': keep });
  await track(c, { program_id: 't6-gapdone', status: 'gap_done', item: 'users' });
  const r = await track(c, { program_id: 't6-gapdone', status: 'started' });
  assert.equal(r.show_to_builder, 'Started.');
  assert.deepEqual(await lastGaps(c.installationId), { 't6-keep': keep });
});

test('gap_done with an item the program does not have is refused, and the remembered gap stays (v6.1.6)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-gapbad', eligibility: [{ kind: 'chain', value: 'arc' }] }), 'file', NOW);
  const arc = { what: 'deploy on Arc', kind: 'chain', item: 'chain:arc' };
  await markFind(c.installationId, NOW, { 't6-gapbad': arc });
  const r = await track(c, { program_id: 't6-gapbad', status: 'gap_done', item: 'nope' });
  assert.equal(r.show_to_builder, 'Which change did you finish? Say the program and the change.');
  assert.equal(r.agent_note, 'Items for this program: chain:arc. Call track gap_done with one of them.');
  assert.deepEqual(await lastGaps(c.installationId), { 't6-gapbad': arc });
  // C27 (v6.1.7): users only when the program has a users item.
  const u = await track(c, { program_id: 't6-gapbad', status: 'gap_done', item: 'users' });
  assert.deepEqual([u.show_to_builder, u.agent_note], ['Which change did you finish? Say the program and the change.', 'Items for this program: chain:arc. Call track gap_done with one of them.']);
  // C11 (v6.1.7): without an item, the agent gets the same list.
  const none = await track(c, { program_id: 't6-gapbad', status: 'gap_done' });
  assert.deepEqual([none.show_to_builder, none.agent_note], ['Which change did you finish? Say the program and the change.', 'Items for this program: chain:arc. Call track gap_done with one of them.']);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM gaps_done WHERE installation_id = ${c.installationId}`)[0].n, 0);
});

test('TrackInput caps: program_id and item at 80, amount_usd finite and between 0 and 100,000,000 (security L2)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-cap', title: 'Cap Grant' }), 'file', NOW);
  const refused = [
    { program_id: 'x'.repeat(81), status: 'applied' },
    { program_id: 't6-cap', status: 'gap_done', item: 'i'.repeat(81) },
    { program_id: 't6-cap', status: 'won', amount_usd: -1 },
    { program_id: 't6-cap', status: 'won', amount_usd: 100_000_001 },
    { program_id: 't6-cap', status: 'won', amount_usd: Number.POSITIVE_INFINITY },
    { program_id: 't6-cap', status: 'won', amount_usd: Number.NaN },
  ];
  for (const input of refused) {
    const r = await track(c, input);
    assert.equal(r.show_to_builder, 'I could not read that. Send the program, a status, and for a win the amount.', JSON.stringify(input));
    assert.match(r.agent_note, /^Nothing was recorded\. (program_id|item|amount_usd): .+\.$/, JSON.stringify(input));
  }
  const n = (await sql()`SELECT count(*)::int AS n FROM application_history WHERE installation_id = ${c.installationId}`)[0].n;
  assert.equal(n, 0);
  // The cap itself passes the input check and meets the program's own limit instead.
  assert.equal((await track(c, { program_id: 't6-cap', status: 'won', amount_usd: 100_000_000 })).show_to_builder, "That's more than this program pays; check the amount.");
});

const RULE = 'a team of two or more';
const ruleWhat = async () => (await import('./eligibility')).ruleItem(RULE);

test('started on a remembered rule gap says it still had a rule to confirm (v6.1.7, m2, C25)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't7-rule', title: 'Rule Grant', eligibility: [{ kind: 'rule', note: RULE }] }), 'file', NOW);
  await markFind(c.installationId, NOW, { 't7-rule': { what: RULE, kind: 'rule', item: await ruleWhat() } });
  const r = await track(c, { program_id: 't7-rule', status: 'started' });
  assert.equal(r.show_to_builder, `Started. When I last looked it still had a rule to confirm: ${RULE}. Say yes if that is you.`);
  assert.equal(r.agent_note, 'If the builder says the rule fits, call track gap_done with that gap\'s item, then find again. Otherwise skip the program.');
});

test('a legacy last_gaps string reads as kind other and keeps the change line (v6.1.7, m2)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't7-legacy', title: 'Legacy Grant' }), 'file', NOW);
  await sql()`UPDATE installations SET last_gaps = ${sql().json({ 't7-legacy': 'a demo video' })} WHERE id = ${c.installationId}`;
  assert.deepEqual(await lastGaps(c.installationId), { 't7-legacy': { what: 'a demo video', kind: 'other' } });
  const r = await track(c, { program_id: 't7-legacy', status: 'started' });
  assert.equal(r.show_to_builder, 'Started. When I last looked it was still one change away: a demo video. Make sure that is done first.');
});

test("another agent's confirmation of the remembered gap skips the remark (v6.1.7, C23)", async () => {
  const { a, c } = await twoAgents();
  await upsertProgram(programFixture({ id: 't7-both', title: 'Both Grant', eligibility: [{ kind: 'rule', note: RULE }] }), 'file', NOW);
  const item = await ruleWhat();
  await markFind(c.installationId, NOW, { 't7-both': { what: RULE, kind: 'rule', item } });
  await track(a, { program_id: 't7-both', status: 'gap_done', item });
  const r = await track(c, { program_id: 't7-both', status: 'started' });
  assert.equal(r.show_to_builder, 'Started. Your other agents leave this one alone for 24 hours.');
});

test('gap_done on a rule says it counts as confirmed; any repeat says already noted (v6.1.7, m3, C26)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't7-gd', title: 'Confirm Grant', eligibility: [{ kind: 'rule', note: RULE }, { kind: 'users' }] }), 'file', NOW);
  const item = await ruleWhat();
  const first = await track(c, { program_id: 't7-gd', status: 'gap_done', item });
  assert.deepEqual([first.show_to_builder, first.agent_note], ['Noted. That rule counts as confirmed.', 'Call find again; the program comes back ready.']);
  const again = await track(c, { program_id: 't7-gd', status: 'gap_done', item });
  assert.deepEqual([again.show_to_builder, again.agent_note], ['Already noted.', 'Call find again for the updated ledger.']);
  const users = await track(c, { program_id: 't7-gd', status: 'gap_done', item: 'users' });
  assert.deepEqual([users.show_to_builder, users.agent_note], ['Noted.', 'Call find again; that step counts as done.']);
  assert.equal((await track(c, { program_id: 't7-gd', status: 'gap_done', item: 'users' })).show_to_builder, 'Already noted.');
  assert.equal((await sql()`SELECT count(*)::int AS n FROM gaps_done WHERE installation_id = ${c.installationId}`)[0].n, 2);
});

test('N2 (v6.1.8): gap_done on one of several rules says how many are left; the builder line is unchanged', async () => {
  const c = await ctx();
  const notes = [RULE, 'work not funded by an employer', 'an open source license'];
  await upsertProgram(programFixture({ id: 't8-rules', title: 'Three Rules', eligibility: notes.map((note) => ({ kind: 'rule' as const, note })) }), 'file', NOW);
  const { ruleItem } = await import('./eligibility');
  const say = async (note: string) => {
    const r = await track(c, { program_id: 't8-rules', status: 'gap_done', item: ruleItem(note) });
    return [r.show_to_builder, r.agent_note];
  };
  assert.deepEqual(await say(notes[0]), ['Noted. That rule counts as confirmed.', 'Call find again; 2 rules are left.']);
  assert.deepEqual(await say(notes[1]), ['Noted. That rule counts as confirmed.', 'Call find again; one rule is left.']);
  assert.deepEqual(await say(notes[2]), ['Noted. That rule counts as confirmed.', 'Call find again; the program comes back ready.']);
});

test('started on an application already sent whose program has since closed says it was sent (v6.1.7)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't7-sentclosed', title: 'Gone Grant' }), 'file', NOW);
  await track(c, { program_id: 't7-sentclosed', status: 'applied', submitted_by: 'agent' });
  await upsertProgram(programFixture({ id: 't7-sentclosed', title: 'Gone Grant', status: 'closed' }), 'file', NOW);
  const r = await track(c, { program_id: 't7-sentclosed', status: 'started' });
  assert.equal(r.show_to_builder, 'Gone Grant was already sent.');
  assert.equal(r.agent_note, 'Do not submit this one; it was already sent.');
  assert.equal(r.already_started, true);
});

test('B18: an agent send is under standing approval only within every limit; otherwise recorded as not, with the reason', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_101, login: 'limits', name: 'L', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  const linked = { ...c, builderId: b.id };
  const policy = (p: Record<string, unknown>) =>
    saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true, max_per_night: 1, categories: ['grant'], ...p } }, 'builder', NOW).record, NOW);
  const send = (id: string, at = NOW) => track({ ...linked, now: at }, { program_id: id, status: 'applied', submitted_by: 'agent' });
  const auto = async (id: string) => (await sql()`SELECT auto_applied FROM applications WHERE owner = ${'b:' + b.id} AND program_id = ${id}`)[0].auto_applied;
  const p = (id: string, over: Record<string, unknown> = {}) => upsertProgram(programFixture({ id, title: id, ...over }), 'file', NOW);
  await p('b18-a', { category: 'grant' });
  await p('b18-b', { category: 'grant' });
  await p('b18-bounty', { category: 'bounty' });
  await p('b18-big', { category: 'grant', max_award_usd: 5000, pool_usd: 900_000 });
  await p('b18-self', { category: 'grant', submit: 'builder' });
  await p('b18-room', { category: 'grant', in_person: true });
  await p('b18-nosub', { category: 'grant' });
  await policy({ max_ask_usd: 100_000 });

  const first = await send('b18-a');
  assert.equal(first.show_to_builder, "Tracked. I'll ask how it went when results are due.");
  assert.equal(await auto('b18-a'), true);
  const second = await send('b18-b', new Date(NOW.getTime() + 60_000));
  assert.equal(second.show_to_builder, 'Sent, but outside your standing approval: the nightly limit was reached.');
  assert.equal(await auto('b18-b'), false);
  const cases: [string, string][] = [
    ['b18-bounty', 'bounties are not in your categories'],
    ['b18-big', 'its award is above your limit'],
    ['b18-self', 'only you may apply to it'],
    ['b18-room', 'it is in person'],
  ];
  for (const [id, why] of cases) {
    const r = await send(id, new Date(NOW.getTime() + 2 * 86_400_000));
    assert.equal(r.show_to_builder, `Sent, but outside your standing approval: ${why}.`, id);
    assert.equal(await auto(id), false, id);
  }
  await policy({ agent_may_submit: false, max_per_night: 5 });
  const nosub = await send('b18-nosub', new Date(NOW.getTime() + 3 * 86_400_000));
  assert.equal(nosub.show_to_builder, 'Sent, but outside your standing approval: your agent may not press submit.');
  // The next find says nothing was applied under standing approval but the one within it.
  const { appliedOvernight } = await import('../v6/claims');
  assert.deepEqual((await appliedOvernight('b:' + b.id, new Date(NOW.getTime() - 1))).map((x) => x.program_id), ['b18-a']);
});

test('Review Focus 4 (v6.1.9 N2): recording an old win today does not use tonight\'s limit; the count reads the send time', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_102, login: 'sentat', name: 'S', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  const linked = { ...c, builderId: b.id };
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true, max_per_night: 1, categories: ['grant'] } }, 'builder', NOW).record, NOW);
  for (const id of ['rf4-old', 'rf4-new', 'rf4-next', 'rf4-legacy']) await upsertProgram(programFixture({ id, title: id, category: 'grant', max_award_usd: 5000 }), 'file', NOW);
  const owner = 'b:' + b.id;
  const threeDaysAgo = new Date(NOW.getTime() - 3 * 86_400_000);
  const sent = await track({ ...linked, now: threeDaysAgo }, { program_id: 'rf4-old', status: 'applied', submitted_by: 'agent' });
  assert.equal(sent.show_to_builder, "Tracked. I'll ask how it went when results are due.");
  // The result lands today: it moves `at`, never the send time.
  assert.equal((await track(linked, { program_id: 'rf4-old', status: 'won', amount_usd: 1000 })).show_to_builder, 'Recorded: $1,000 from rf4-old.');
  const [old] = await sql()`SELECT sent_at, at FROM applications WHERE owner = ${owner} AND program_id = 'rf4-old'`;
  assert.equal((old.sent_at as Date).toISOString(), threeDaysAgo.toISOString());
  assert.equal((old.at as Date).toISOString(), NOW.toISOString());
  const today = await track({ ...linked, now: new Date(NOW.getTime() + 60_000) }, { program_id: 'rf4-new', status: 'applied', submitted_by: 'agent' });
  assert.equal(today.show_to_builder, "Tracked. I'll ask how it went when results are due.");
  assert.equal((await sql()`SELECT auto_applied FROM applications WHERE owner = ${owner} AND program_id = 'rf4-new'`)[0].auto_applied, true);
  // The second send today is past the limit.
  const next = await track({ ...linked, now: new Date(NOW.getTime() + 120_000) }, { program_id: 'rf4-next', status: 'applied', submitted_by: 'agent' });
  assert.equal(next.show_to_builder, 'Sent, but outside your standing approval: the nightly limit was reached.');
});

test('N2 (v6.1.9): a row from before the send time was kept counts by its at', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_103, login: 'legacy', name: 'L', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true, max_per_night: 1, categories: ['grant'] } }, 'builder', NOW).record, NOW);
  await upsertProgram(programFixture({ id: 'n2-legacy', title: 'n2-legacy', category: 'grant' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'n2-now', title: 'n2-now', category: 'grant' }), 'file', NOW);
  await sql()`INSERT INTO applications (owner, installation_id, program_id, status, at, auto_applied)
    VALUES (${'b:' + b.id}, ${c.installationId}, 'n2-legacy', 'applied', ${new Date(NOW.getTime() - 3_600_000)}, true)`;
  const r = await track({ ...c, builderId: b.id }, { program_id: 'n2-now', status: 'applied', submitted_by: 'agent' });
  assert.equal(r.show_to_builder, 'Sent, but outside your standing approval: the nightly limit was reached.');
});

test('N1 (v6.1.9): the tonight list leaves out the sends already made under standing approval in the last 24 hours', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const { find } = await import('./find');
  const a = await ctx();
  const a2 = await ctx();
  const b = await upsertBuilder({ github_id: 930_104, login: 'tonight', name: 'T', avatar_url: null }, NOW);
  await linkInstallation(a.installationId, b.id, NOW);
  await linkInstallation(a2.installationId, b.id, NOW);
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true, max_per_night: 1, categories: ['grant'] } }, 'builder', NOW).record, NOW);
  await upsertProgram(programFixture({ id: 'n1-alpha', title: 'N1 Alpha Grant', category: 'grant' }), 'file', NOW);
  const project = { name: 'N1 App', description: 'An app for builders.', live_url: 'https://n1.example', users: true };
  const closing = async () => ((await find({ ...a2, builderId: b.id }, { project })) as { show_to_builder: string }).show_to_builder.split('\n\n').at(-1);
  assert.match((await closing())!, /^Applying tonight to /);
  await track({ ...a, builderId: b.id }, { program_id: 'n1-alpha', status: 'applied', submitted_by: 'agent' });
  assert.equal(await closing(), "Tonight's limit is used; the next sends wait until tomorrow.");
  // A day later the room is back.
  const tomorrow = ((await find({ ...a2, builderId: b.id, now: new Date(NOW.getTime() + 86_400_000 + 60_000) }, { project })) as { show_to_builder: string }).show_to_builder;
  assert.doesNotMatch(tomorrow, /limit is used/);
});

test('C51 (v6.1.9): track as the first call after the account was deleted carries the notice once', async () => {
  const { deleteBuilder, linkInstallation, upsertBuilder } = await import('../v6/builders');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_105, login: 'deleted', name: 'D', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  await deleteBuilder(b.id, NOW);
  await upsertProgram(programFixture({ id: 'c51-t', title: 'C51 Grant' }), 'file', NOW);
  const first = await track(c, { program_id: 'c51-t', status: 'started' });
  assert.equal(first.show_to_builder, 'Your record was deleted at earnkit.com/me; this agent is unlinked. Started.');
  const second = await track(c, { program_id: 'c51-t', status: 'applied', submitted_by: 'agent' });
  assert.equal(second.show_to_builder, "Tracked. I'll ask how it went when results are due.");
});
