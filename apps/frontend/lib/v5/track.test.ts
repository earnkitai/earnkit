import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { closeDay } from './deadline';
import { ProgramFile } from './program-file';
import { findProgramsDir } from './programs-api';
import { upsertProgram } from './programs';
import { programFixture } from './fixtures/program';
import { namedFirst, track } from './track';
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
  assert.equal(await say({ program_id: 't6-a', status: 'applied' }), 'Sent Alpha Grant.');
  assert.equal(await say({ program_id: 't6-a', status: 'won', amount_usd: 5000 }), 'Tracked: $5,000 from Alpha Grant.');
  // One result per program (v6.1.7): each result on its own program.
  await upsertProgram(programFixture({ id: 't6-a2', title: 'Alpha Two' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't6-a3', title: 'Alpha Three' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't6-a4', title: 'Alpha Four' }), 'file', NOW);
  for (const id of ['t6-a2', 't6-a3']) await say({ program_id: id, status: 'applied' });
  assert.equal(await say({ program_id: 't6-a2', status: 'rejected' }), 'Tracked. On to the next one.');
  assert.equal(await say({ program_id: 't6-a3', status: 'no_result' }), 'Tracked.');
  assert.equal(await say({ program_id: 't6-a4', status: 'skipped' }), 'Skipped Alpha Four for good. Say bring it back and I list it again.');
  await upsertProgram(programFixture({ id: 't6-a5', title: 'Alpha Users', eligibility: [{ kind: 'users' }] }), 'file', NOW);
  assert.equal(await say({ program_id: 't6-a5', status: 'gap_done', item: 'users' }), 'Tracked.');
  await upsertProgram(programFixture({ id: 't6-b', title: 'Beta' }), 'file', NOW);
  const r = await track(c, { program_id: 't6-b', status: 'applied' });
  assert.equal(r.agent_note, 'Call find again for the updated applications. Pass fields_used next time; nothing was checked against your record.');
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
  await track(a, { program_id: 't7-one', status: 'applied', submitted_by: 'agent', project: { name: 'App' } });
  const second = await track(c, { program_id: 't7-one', status: 'applied', submitted_by: 'agent', project: { name: 'App' } });
  assert.equal(second.show_to_builder, 'Already sent here on Nov 4 by "Claude Code"; nothing recorded.');
  assert.equal(second.agent_note, 'Nothing was recorded.');
  assert.equal((await track(a, { program_id: 't7-one', status: 'won', amount_usd: 0 })).show_to_builder, 'Tell me the amount as a number, like 5000 for $5,000.' /* L31-5 */);
  assert.equal((await track(a, { program_id: 't7-one', status: 'won', amount_usd: 3000 })).show_to_builder, 'Tracked: $3,000 from One Grant.');
  // L16-2 (v6.1.16): no_result over a result is refused; a rejection would be a correction (the next test).
  const rej = await track(c, { program_id: 't7-one', status: 'no_result' });
  assert.equal(rej.show_to_builder, 'That one already has a result here: won $3,000.');
  assert.equal(rej.ledger.won_usd, 3000);
  // T8-F1 (v6.1.14), L17-8 (v6.1.16): a resend is a confirmation; another amount corrects; a marked further payment adds once.
  assert.equal((await track(c, { program_id: 't7-one', status: 'won', amount_usd: 3000 })).show_to_builder, 'Already recorded; nothing new.');
  const fixed = await track(c, { program_id: 't7-one', status: 'won', amount_usd: 2000 });
  assert.equal(fixed.show_to_builder, 'Tracked: $2,000 from One Grant. Replaced the earlier amount.');
  assert.equal(fixed.ledger.won_usd, 2000);
  const more = await track(c, { program_id: 't7-one', status: 'won', amount_usd: 1250, payment: { key: 'second' } });
  assert.equal(more.show_to_builder, 'Tracked: $1,250 more from One Grant, $3,250 in total.');
  assert.equal(more.ledger.won_usd, 3250);
  assert.equal(more.ledger.won, 1);
  // A retried call with the same key adds nothing.
  const retry = await track(a, { program_id: 't7-one', status: 'won', amount_usd: 1250, payment: { key: 'second' } });
  assert.equal(retry.show_to_builder, 'Already tracked.');
  assert.equal(retry.ledger.won_usd, 3250);
  assert.equal((await track(c, { program_id: 't7-one', status: 'skipped' })).show_to_builder, 'That one already has a result here; nothing to skip.');
});

test('L16-1, L16-2 (v6.1.16, Review Focus 3): won $100, rejected, a further payment refused, then the builder\'s own win corrects the rejection', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't7-fix', title: 'Fix Grant', max_award_usd: 5000 }), 'file', NOW);
  await track(c, { program_id: 't7-fix', status: 'applied' });
  assert.equal((await track(c, { program_id: 't7-fix', status: 'won', amount_usd: 100 })).show_to_builder, 'Tracked: $100 from Fix Grant.');
  const rej = await track(c, { program_id: 't7-fix', status: 'rejected' });
  assert.equal(rej.show_to_builder, 'Tracked. On to the next one.');
  assert.deepEqual([rej.ledger.won, rej.ledger.rejected], [0, 1]);
  const hist = async () => (await sql()`SELECT count(*)::int AS n FROM application_history WHERE installation_id = ${c.installationId} AND program_id = 't7-fix'`)[0].n as number;
  const before = await hist();
  const pay = await track(c, { program_id: 't7-fix', status: 'won', amount_usd: 10, payment: { key: 'p2' } });
  assert.equal(pay.show_to_builder, 'Further payment refused: the current result is rejected; post a win first.');
  assert.equal(pay.agent_note, 'Nothing was recorded.');
  assert.equal(await hist(), before);
  const won = await track(c, { program_id: 't7-fix', status: 'won', amount_usd: 150 });
  assert.equal(won.show_to_builder, 'Tracked: $150 from Fix Grant.');
  assert.deepEqual([won.ledger.applied, won.ledger.won, won.ledger.won_usd, won.ledger.rejected], [1, 1, 150, 0]);
  const rows = await sql()`SELECT status, amount_usd, corrected FROM application_history WHERE installation_id = ${c.installationId} AND program_id = 't7-fix' ORDER BY id OFFSET ${before}`;
  assert.deepEqual(rows.map((x) => [x.status, Number(x.amount_usd), x.corrected]), [['won', 150, true]]);
});

test('Review Focus 1, re-pinned by L23-3 (v6.1.16): A started, B applied is recorded with the warning and clears the claim; A hears it was already sent', async () => {
  const { a, c, owner } = await twoAgents();
  await sql()`UPDATE installations SET client_name = 'Codex' WHERE id = ${c.installationId}`;
  await upsertProgram(programFixture({ id: 't7-rf1', title: 'Focus Grant' }), 'file', NOW);
  assert.equal((await track(a, { program_id: 't7-rf1', status: 'started' })).show_to_builder, '');
  const over = await track({ ...c, now: new Date(NOW.getTime() + 3_600_000) }, { program_id: 't7-rf1', status: 'applied', submitted_by: 'agent', project: { name: 'App' } });
  // L23-3 (v6.1.16): a real send is never refused or lost.
  assert.equal(over.show_to_builder, 'Sent Focus Grant.');
  assert.equal(over.agent_note, 'Recorded. Another agent had started this one too; tell the builder so it is not sent twice.');
  assert.equal(over.ledger.applied, 1);
  const again = await track({ ...a, now: new Date(NOW.getTime() + 2 * 3_600_000) }, { program_id: 't7-rf1', status: 'applied', submitted_by: 'agent', project: { name: 'App' } });
  assert.equal(again.show_to_builder, 'Already sent here on Nov 4 by "Codex"; nothing recorded.');
  assert.equal(again.agent_note, 'Nothing was recorded.');
  assert.equal(again.ledger.applied, 1);
  const rows = await sql()`SELECT status, installation_id, claimed_at, claimed_by FROM applications WHERE owner = ${owner} AND program_id = 't7-rf1'`;
  assert.deepEqual(rows.map((r) => [r.status, r.installation_id, r.claimed_at, r.claimed_by]), [['applied', c.installationId, null, null]]);
});

test('a result for a program gone from the catalog uses the title stored when it was sent (v6.1.7, C36)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't7-gone', title: 'Gone Grant' }), 'file', NOW);
  await track(c, { program_id: 't7-gone', status: 'applied' });
  await sql()`DELETE FROM programs WHERE id = 't7-gone'`;
  const r = await track(c, { program_id: 't7-gone', status: 'won', amount_usd: 2500 });
  assert.equal(r.show_to_builder, 'Tracked: $2,500 from Gone Grant.');
  assert.equal(r.ledger.won_usd, 2500);
});

test('refusals say so and record nothing', async () => {
  const c = await ctx();
  const r = await track(c, { program_id: 'nope-x', status: 'applied' });
  assert.equal(r.agent_note, 'Nothing was recorded. program_id takes the id or the name; a list number maps to the id in the JSON.');
  assert.ok(r.show_to_builder.length > 0);
  const w = await track(c, { program_id: 'nope-x', status: 'won' });
  assert.equal(w.agent_note, 'Nothing was recorded. program_id takes the id or the name; a list number maps to the id in the JSON.');
  const u = await track(c, { program_id: 'nope-x', status: 'applied', extra: 1 });
  assert.equal(u.show_to_builder, '');
  assert.equal(u.agent_note, 'Nothing was recorded. input: Unrecognized key: "extra"; fix it and call again.');
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
  assert.equal(s.show_to_builder, '');
  assert.equal(s.ledger.applied, 0);
  assert.equal('already_started' in s, false);
  const a = await track({ ...c, now: new Date(NOW.getTime() + 3_600_000) }, { program_id: 't6-s', status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: ['project_name'], project_id: 'earnkit' });
  assert.equal(a.show_to_builder, 'Sent Start Grant.');
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
  assert.equal(s.show_to_builder, '');
  assert.equal(s.agent_note, "Started Project Grant. Fill the form from the fields, submit, then call track with applied, submitted_by and fields_used. If the form has a reference field, put application_id in it, so the program's result reaches these applications. project_id nope is not known; ignored.");
  const a = await track(c, { program_id: 't6-p', status: 'applied', submitted_by: 'agent', project: { name: 'App' }, project_id: 'nope' });
  assert.match(a.agent_note, /project_id nope is not known; ignored\.$/);
  const [row] = await sql()`SELECT project_id FROM applications WHERE program_id = 't6-p' AND installation_id = ${c.installationId}`;
  // FR-3 (v6.1.14 final fix): the unknown id is never stored; the send keeps its project key, as a claim does.
  assert.equal(row.project_id, 'name:app');
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
  assert.equal(again.show_to_builder, 'Double Grant is already being handled since 12:00 UTC by "Claude Code".');
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
  assert.equal(again.show_to_builder, '');
  assert.equal('already_started' in again, false);
  const [row] = await sql()`SELECT status, claimed_at, claimed_by FROM applications WHERE owner = ${owner} AND program_id = 't6-re'`;
  assert.deepEqual([row.status, (row.claimed_at as Date).toISOString(), row.claimed_by], ['started', later.toISOString(), a.installationId]);
  const other = await track({ ...c, now: new Date(later.getTime() + 3_600_000) }, { program_id: 't6-re', status: 'started' });
  assert.equal(other.already_started, true);
  assert.equal(other.show_to_builder, 'Again Grant is already being handled since 15:00 UTC by "Claude Code".');
});

test('started on an application already sent says it was sent, for any installation', async () => {
  const { a, c } = await twoAgents();
  await upsertProgram(programFixture({ id: 't6-sent', title: 'Sent Grant' }), 'file', NOW);
  await track(a, { program_id: 't6-sent', status: 'applied', submitted_by: 'agent', project: { name: 'App' } });
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
  assert.equal(r.agent_note, 'Nothing was recorded. program_id takes the id or the name; a list number maps to the id in the JSON.');
  assert.equal(r.show_to_builder, 'Which program do you mean?');
  const bad = await track(c, { program_id: 't6-a', status: 'applied', submitted_by: 'robot' });
  // L29-10 (v6.1.16 Task 15): an input error has no builder text; the note says what to fix.
  assert.equal(bad.show_to_builder, '');
  assert.equal(bad.refused, true);
  assert.match(bad.agent_note, /^Nothing was recorded\. submitted_by: .+; fix it and call again\.$/);
  const n = (await sql()`SELECT count(*)::int AS n FROM applications WHERE installation_id = ${c.installationId}`)[0].n;
  assert.equal(n, 0);
});

test('started over a skip: the skipped sentence; an older claim names its day', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-k', title: 'Kept Out' }), 'file', NOW);
  await track(c, { program_id: 't6-k', status: 'skipped' });
  const r = await track(c, { program_id: 't6-k', status: 'started' });
  assert.equal(r.show_to_builder, 'You skipped that one. Say bring it back and I list it again.');
  assert.equal(r.agent_note, 'Do not submit this one. On "bring it back", call track with unskip.');
  assert.equal('already_started' in r, false);
  // Unskip takes it back: the row goes, a claim works again; unskipping a program that is not skipped is refused.
  const back = await track(c, { program_id: 't6-k', status: 'unskip' });
  assert.equal(back.show_to_builder, 'Unskipped Kept Out. It can come back in the list.');
  assert.equal((await track(c, { program_id: 't6-k', status: 'started' })).show_to_builder, '');
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
  await track(linked, { program_id: 't6-off', status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: ['project_name'] });
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true } }, 'builder', NOW).record, NOW);
  await track(linked, { program_id: 't6-on', status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: ['project_name'] });
  // With standing approval on, a form the builder sent themselves is still not an auto-applied one.
  await upsertProgram(programFixture({ id: 't6-self', title: 'Self' }), 'file', NOW);
  await track(linked, { program_id: 't6-self', status: 'applied', submitted_by: 'builder' });
  const rows = await sql()`SELECT program_id, auto_applied FROM applications WHERE owner = ${'b:' + b.id} ORDER BY program_id`;
  assert.deepEqual(rows.map((r) => [r.program_id, r.auto_applied]), [['t6-off', false], ['t6-on', true], ['t6-self', false]]);
  const u = await ctx();
  await track(u, { program_id: 't6-on', status: 'applied', submitted_by: 'agent', project: { name: 'App' } });
  const [ur] = await sql()`SELECT auto_applied FROM applications WHERE installation_id = ${u.installationId}`;
  assert.equal(ur.auto_applied, false);
});

test('started on a program the last find called a gap says so', async () => {
  const two = await twoAgents();
  await upsertProgram(programFixture({ id: 't6-gap', title: 'Gap Grant' }), 'file', NOW);
  await markFind(two.a.installationId, NOW, { 't6-gap': { what: 'add Base Builder Codes', kind: 'builder_codes', item: 'builder_codes' } });
  const r = await track(two.a, { program_id: 't6-gap', status: 'started' });
  assert.equal(r.show_to_builder, '');
  assert.equal(r.agent_note, "Started Gap Grant. When EarnKit last looked it was still one change away: add Base Builder Codes. Tell the builder; make the change before you submit, or call find again to check it. Then fill the form from the fields, submit, and call track with applied, submitted_by and fields_used. Other agents of this builder leave it alone for 24 hours. If the form has a reference field, put application_id in it, so the program's result reaches these applications.");
  assert.equal('already_started' in r, false);
  const other = await track({ ...two.c, now: new Date(NOW.getTime() + 3_600_000) }, { program_id: 't6-gap', status: 'started' });
  assert.equal(other.already_started, true);
});

test('started on a program the last find did not call a gap keeps the plain line', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-nogap' }), 'file', NOW);
  await markFind(c.installationId, NOW, { 'some-other-program': { what: 'add Base Builder Codes', kind: 'builder_codes', item: 'builder_codes' } });
  const r = await track(c, { program_id: 't6-nogap', status: 'started' });
  assert.equal(r.show_to_builder, '');
  assert.equal(r.agent_note, "Started Test Grants. Fill the form from the fields, submit, then call track with applied, submitted_by and fields_used. If the form has a reference field, put application_id in it, so the program's result reaches these applications.");
});

test('gap_done forgets the remembered gap, so started keeps the plain line', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-gapdone', eligibility: [{ kind: 'users' }] }), 'file', NOW);
  const keep = { what: 'a demo video', kind: 'demo_video', item: 'demo_video' };
  await markFind(c.installationId, NOW, { 't6-gapdone': { what: 'tell me if real people use it', kind: 'users', item: 'users' }, 't6-keep': keep });
  await track(c, { program_id: 't6-gapdone', status: 'gap_done', item: 'users' });
  const r = await track(c, { program_id: 't6-gapdone', status: 'started' });
  assert.equal(r.show_to_builder, '');
  assert.deepEqual(await lastGaps(c.installationId), { 't6-keep': keep });
});

test('gap_done with an item the program does not have is refused, and the remembered gap stays (v6.1.6)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-gapbad', eligibility: [{ kind: 'chain', value: 'arc' }] }), 'file', NOW);
  const arc = { what: 'deploy on Arc', kind: 'chain', item: 'chain:arc' };
  await markFind(c.installationId, NOW, { 't6-gapbad': arc });
  const r = await track(c, { program_id: 't6-gapbad', status: 'gap_done', item: 'nope' });
  assert.equal(r.show_to_builder, 'Which change did you finish? Say the program and the change.');
  assert.equal(r.agent_note, 'Items for this program: chain:arc, repo. Call track gap_done with one of them.');
  assert.deepEqual(await lastGaps(c.installationId), { 't6-gapbad': arc });
  // C27 (v6.1.7): users only when the program has a users item.
  const u = await track(c, { program_id: 't6-gapbad', status: 'gap_done', item: 'users' });
  assert.deepEqual([u.show_to_builder, u.agent_note], ['Which change did you finish? Say the program and the change.', 'Items for this program: chain:arc, repo. Call track gap_done with one of them.']);
  // C11 (v6.1.7): without an item, the agent gets the same list.
  const none = await track(c, { program_id: 't6-gapbad', status: 'gap_done' });
  assert.deepEqual([none.show_to_builder, none.agent_note], ['Which change did you finish? Say the program and the change.', 'Items for this program: chain:arc, repo. Call track gap_done with one of them.']);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM gaps_done WHERE installation_id = ${c.installationId}`)[0].n, 0);
});

test('TrackInput caps: program_id and item at 80, amount_usd finite and at least 0 (security L2; L13-5 v6.1.14: no ceiling in the input)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't6-cap', title: 'Cap Grant' }), 'file', NOW);
  const refused = [
    { program_id: 'x'.repeat(81), status: 'applied' },
    { program_id: 't6-cap', status: 'gap_done', item: 'i'.repeat(81) },
    { program_id: 't6-cap', status: 'won', amount_usd: -1 },
    { program_id: 't6-cap', status: 'won', amount_usd: Number.POSITIVE_INFINITY },
    { program_id: 't6-cap', status: 'won', amount_usd: Number.NaN },
  ];
  for (const input of refused) {
    const r = await track(c, input);
    // L31-5 (v6.1.16 Task 17): an unreadable amount is the one bad-amount line.
    assert.equal(r.show_to_builder, input.status === 'won' ? 'Tell me the amount as a number, like 5000 for $5,000.' : '', JSON.stringify(input));
    assert.match(r.agent_note, /^Nothing was recorded\. (program_id|item|amount_usd): .+\.$/, JSON.stringify(input));
  }
  const n = (await sql()`SELECT count(*)::int AS n FROM application_history WHERE installation_id = ${c.installationId}`)[0].n;
  assert.equal(n, 0);
  // Any amount passes the input check and meets the program's own limit instead (L13-5: 1e12 too).
  for (const amount_usd of [100_000_000, 100_000_001, 1e12])
    assert.equal((await track(c, { program_id: 't6-cap', status: 'won', amount_usd })).show_to_builder, "Over the program's $10,000,000 cap; nothing recorded.");
});

const RULE = 'a team of two or more';
const ruleWhat = async () => (await import('./eligibility')).ruleItem(RULE);

// Re-pinned by L29-8 (v6.1.16 Task 15): a rule not confirmed refuses the claim and writes nothing; once confirmed it starts.
test('started on a program with an unconfirmed rule asks for it first and claims nothing (v6.1.7, m2, C25; L29-8)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't7-rule', title: 'Rule Grant', eligibility: [{ kind: 'rule', note: RULE }] }), 'file', NOW);
  await markFind(c.installationId, NOW, { 't7-rule': { what: RULE, kind: 'rule', item: await ruleWhat() } });
  const r = await track(c, { program_id: 't7-rule', status: 'started' });
  assert.equal(r.show_to_builder, `Confirm the rule first: ${RULE}. Say yes if that is you.`);
  assert.equal(r.refused, true);
  assert.equal(r.agent_note, `Nothing was recorded. If the builder says yes, call track gap_done with item ${await ruleWhat()}, then track started again.`);
  assert.equal((await sql()`SELECT 1 FROM applications WHERE program_id = 't7-rule'`).length, 0);
  await track(c, { program_id: 't7-rule', status: 'gap_done', item: await ruleWhat() });
  const s = await track(c, { program_id: 't7-rule', status: 'started' });
  assert.equal(s.show_to_builder, '');
  assert.equal(s.refused, undefined);
  assert.match(s.agent_note, /^Started Rule Grant\. /);
});

test('a legacy last_gaps string reads as kind other and keeps the change line (v6.1.7, m2)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't7-legacy', title: 'Legacy Grant' }), 'file', NOW);
  await sql()`UPDATE installations SET last_gaps = ${sql().json({ 't7-legacy': 'a demo video' })} WHERE id = ${c.installationId}`;
  assert.deepEqual(await lastGaps(c.installationId), { 't7-legacy': { what: 'a demo video', kind: 'other' } });
  const r = await track(c, { program_id: 't7-legacy', status: 'started' });
  assert.equal(r.show_to_builder, '');
});

test("another agent's confirmation of the remembered gap skips the remark (v6.1.7, C23)", async () => {
  const { a, c } = await twoAgents();
  await upsertProgram(programFixture({ id: 't7-both', title: 'Both Grant', eligibility: [{ kind: 'rule', note: RULE }] }), 'file', NOW);
  const item = await ruleWhat();
  await markFind(c.installationId, NOW, { 't7-both': { what: RULE, kind: 'rule', item } });
  await track(a, { program_id: 't7-both', status: 'gap_done', item });
  const r = await track(c, { program_id: 't7-both', status: 'started' });
  assert.equal(r.show_to_builder, '');
});

test('gap_done on a rule says it counts as confirmed; any repeat says already noted (v6.1.7, m3, C26)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't7-gd', title: 'Confirm Grant', eligibility: [{ kind: 'rule', note: RULE }, { kind: 'users' }] }), 'file', NOW);
  const item = await ruleWhat();
  const first = await track(c, { program_id: 't7-gd', status: 'gap_done', item });
  assert.deepEqual([first.show_to_builder, first.agent_note], ['Tracked. That rule counts as confirmed.', 'Call find again; the program comes back ready.']);
  const again = await track(c, { program_id: 't7-gd', status: 'gap_done', item });
  assert.deepEqual([again.show_to_builder, again.agent_note], ['Already tracked.', 'Call find again for the updated applications.']);
  const users = await track(c, { program_id: 't7-gd', status: 'gap_done', item: 'users' });
  assert.deepEqual([users.show_to_builder, users.agent_note], ['Tracked.', 'Call find again; that step counts as done.']);
  assert.equal((await track(c, { program_id: 't7-gd', status: 'gap_done', item: 'users' })).show_to_builder, 'Already tracked.');
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
  assert.deepEqual(await say(notes[0]), ['Tracked. That rule counts as confirmed.', 'Call find again; 2 rules are left.']);
  assert.deepEqual(await say(notes[1]), ['Tracked. That rule counts as confirmed.', 'Call find again; one rule is left.']);
  assert.deepEqual(await say(notes[2]), ['Tracked. That rule counts as confirmed.', 'Call find again; the program comes back ready.']);
});

test('started on an application already sent whose program has since closed says it was sent (v6.1.7)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't7-sentclosed', title: 'Gone Grant' }), 'file', NOW);
  await track(c, { program_id: 't7-sentclosed', status: 'applied', submitted_by: 'agent', project: { name: 'App' } });
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
  const send = (id: string, at = NOW) => track({ ...linked, now: at }, { program_id: id, status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: ['project_name'] });
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
  assert.equal(first.show_to_builder, 'Sent b18-a.');
  assert.equal(first.agent_note, "Done for now. The builder's next find reports it; do not call find again until they ask.");
  assert.equal(await auto('b18-a'), true);
  const second = await send('b18-b', new Date(NOW.getTime() + 60_000));
  assert.equal(second.show_to_builder, 'Sent, but outside your standing approval: the daily limit was reached.');
  assert.match(second.agent_note, /Call find again for the updated applications\.$/);
  assert.equal(await auto('b18-b'), false);
  const cases: [string, string][] = [
    ['b18-bounty', 'bounties are not in your categories'],
    ['b18-big', 'its award is above your limit'],
    ['b18-self', 'only you may apply to it'],
  ];
  for (const [id, why] of cases) {
    const r = await send(id, new Date(NOW.getTime() + 2 * 86_400_000));
    assert.equal(r.show_to_builder, `Sent, but outside your standing approval: ${why}.`, id);
    // L29-9 (v6.1.16 Task 15): recorded, and answered as a refusal.
    assert.equal(r.refused, true, id);
    assert.equal(await auto(id), false, id);
  }
  // L29-7 (v6.1.16 Task 15): an in-person program is never an agent's send: refused, nothing written.
  const room = await send('b18-room', new Date(NOW.getTime() + 2 * 86_400_000));
  assert.equal(room.show_to_builder, 'b18-room is applied for in person; nothing to send.');
  assert.equal((await sql()`SELECT 1 FROM applications WHERE program_id = 'b18-room'`).length, 0);
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
  const sent = await track({ ...linked, now: threeDaysAgo }, { program_id: 'rf4-old', status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: ['project_name'] });
  assert.equal(sent.show_to_builder, 'Sent rf4-old.');
  // The result lands today: it moves `at`, never the send time.
  assert.equal((await track(linked, { program_id: 'rf4-old', status: 'won', amount_usd: 1000 })).show_to_builder, 'Tracked: $1,000 from rf4-old.');
  const [old] = await sql()`SELECT sent_at, at FROM applications WHERE owner = ${owner} AND program_id = 'rf4-old'`;
  assert.equal((old.sent_at as Date).toISOString(), threeDaysAgo.toISOString());
  assert.equal((old.at as Date).toISOString(), NOW.toISOString());
  const today = await track({ ...linked, now: new Date(NOW.getTime() + 60_000) }, { program_id: 'rf4-new', status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: ['project_name'] });
  assert.equal(today.show_to_builder, 'Sent rf4-new.');
  assert.equal((await sql()`SELECT auto_applied FROM applications WHERE owner = ${owner} AND program_id = 'rf4-new'`)[0].auto_applied, true);
  // The second send today is past the limit.
  const next = await track({ ...linked, now: new Date(NOW.getTime() + 120_000) }, { program_id: 'rf4-next', status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: ['project_name'] });
  assert.equal(next.show_to_builder, 'Sent, but outside your standing approval: the daily limit was reached.');
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
  const r = await track({ ...c, builderId: b.id }, { program_id: 'n2-now', status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: ['project_name'] });
  assert.equal(r.show_to_builder, 'Sent, but outside your standing approval: the daily limit was reached.');
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
  // F1 (v6.1.10): a catalog program whose prose answer the record lacks is never sent alone, so the room left is
  // shown on a second fixture; users left unsaid keeps the users yes (F3) out of the closing.
  await upsertProgram(programFixture({ id: 'n1-beta', title: 'N1 Beta Grant', category: 'grant' }), 'file', NOW);
  const project = { name: 'N1 App', description: 'An app for builders.', live_url: 'https://n1.example' };
  const closing = async () => ((await find({ ...a2, builderId: b.id }, { project })) as { show_to_builder: string }).show_to_builder.split('\n').at(-1);
  assert.match((await closing())!, /^Applying now to [^\n]+ under your standing approval\./);
  await track({ ...a, builderId: b.id }, { program_id: 'n1-alpha', status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: ['project_name'] });
  assert.match((await closing())!, /^Your daily limit is used; the next sends wait until 24 hours have passed\. Say yes and I apply/);
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
  assert.equal(first.show_to_builder, 'Your record was deleted at earnkit.com/me; this agent is unlinked.');
  const second = await track(c, { program_id: 'c51-t', status: 'applied', submitted_by: 'agent', project: { name: 'App' } });
  assert.equal(second.show_to_builder, 'Sent C51 Grant.');
});

test('S6 (v6.1.9): a send under standing approval with a required answer left out is recorded as not approved', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_201, login: 's6', name: 'S', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true, max_per_night: 5, categories: ['grant'] } }, 'builder', NOW).record, NOW);
  const two = [
    { key: 'project_name', label: 'Project name', type: 'text', required: true, from: 'project', kind: 'name', todo: 'a project name' },
    { key: 'problem', label: 'The problem', type: 'text', required: true, from: 'builder', kind: 'problem', todo: 'the problem' },
    { key: 'extra', label: 'Anything else', type: 'text', required: false, from: 'builder', kind: 'other', todo: 'anything else' },
  ];
  for (const id of ['s6-short', 's6-none', 's6-full']) await upsertProgram(programFixture({ id, title: id, category: 'grant', submission_requirements: two as never }), 'file', NOW);
  const owner = 'b:' + b.id;
  const auto = async (id: string) => (await sql()`SELECT auto_applied FROM applications WHERE owner = ${owner} AND program_id = ${id}`)[0].auto_applied;
  const short = await track({ ...c, builderId: b.id }, { program_id: 's6-short', status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: ['project_name', 'extra'] });
  assert.equal(short.show_to_builder, 'Sent, but outside your standing approval: a required answer was missing.');
  assert.equal(await auto('s6-short'), false);
  const none = await track({ ...c, builderId: b.id }, { program_id: 's6-none', status: 'applied', submitted_by: 'agent', project: { name: 'App' } });
  assert.equal(none.show_to_builder, 'Sent, but outside your standing approval: a required answer was missing.');
  assert.equal(await auto('s6-none'), false);
  // F1 and lane 8 #1 (v6.1.10): naming every key does not fill the problem the record lacks: not approved.
  const named = await track({ ...c, builderId: b.id }, { program_id: 's6-full', status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: ['project_name', 'problem'] });
  assert.equal(named.show_to_builder, 'Sent, but outside your standing approval: a required answer was missing.');
  assert.equal(await auto('s6-full'), false);
  // With the problem approved in the record, the same send is under standing approval.
  const { approvePath } = await import('../v6/record');
  const answered = mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true, max_per_night: 5, categories: ['grant'] }, answers: { problem: { text: 'Builders lose weeks on grant forms.' } } }, 'builder', NOW).record;
  await saveRecord(b.id, approvePath(answered, 'answers.problem', NOW), NOW);
  await upsertProgram(programFixture({ id: 's6-held', title: 's6-held', category: 'grant', submission_requirements: two as never }), 'file', NOW);
  const held = await track({ ...c, builderId: b.id }, { program_id: 's6-held', status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: ['project_name', 'problem'] });
  assert.equal(held.show_to_builder, 'Sent s6-held.');
  assert.equal(await auto('s6-held'), true);
});

test('v6.1.9: started on an in-person or builder-only program tells the agent the builder presses submit', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'bs-room', title: 'Room', in_person: true }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'bs-self', title: 'Self', submit: 'builder' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'bs-agent', title: 'Agent' }), 'file', NOW);
  for (const id of ['bs-room', 'bs-self']) {
    const r = await track(c, { program_id: id, status: 'started' });
    assert.equal(r.show_to_builder, id === 'bs-room' ? '' : '', id);
    assert.ok(r.agent_note.includes('The builder presses submit; prepare the answers and hand them over.'), id);
    assert.doesNotMatch(r.agent_note, /fields, submit,/);
  }
  const plain = await track(c, { program_id: 'bs-agent', status: 'started' });
  assert.equal(plain.agent_note, "Started Agent. Fill the form from the fields, submit, then call track with applied, submitted_by and fields_used. If the form has a reference field, put application_id in it, so the program's result reaches these applications.");
});

test('v6.1.9: applied as the first call after the account was deleted answers the notice alone and writes nothing', async () => {
  const { deleteBuilder, linkInstallation, upsertBuilder } = await import('../v6/builders');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_202, login: 'gone', name: 'G', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  await deleteBuilder(b.id, NOW);
  await upsertProgram(programFixture({ id: 'del-a', title: 'Del Grant' }), 'file', NOW);
  const r = await track(c, { program_id: 'del-a', status: 'applied', submitted_by: 'agent', project: { name: 'App' } });
  assert.equal(r.show_to_builder, 'Your record was deleted at earnkit.com/me; this agent is unlinked.');
  assert.match(r.agent_note, /^Nothing was recorded/);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE installation_id = ${c.installationId}`)[0].n, 0);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM application_history WHERE installation_id = ${c.installationId}`)[0].n, 0);
  // The notice is said once; the next send is this installation's own.
  const again = await track(c, { program_id: 'del-a', status: 'applied', submitted_by: 'agent', project: { name: 'App' } });
  assert.equal(again.show_to_builder, 'Sent Del Grant.');
});

test('v6.1.16 Task 16 (ruling 40): the closed line names the day in the program\'s zone, as its Closes line does; the 9 catalog programs whose UTC day differs', async () => {
  const days: Record<string, string> = {
    // L23-11 (v6.1.16): through dayWords, with the year when it is not this one.
    'a16z-speedrun': 'Nov 1', 'arc-microgrants-studio': 'Nov 1', 'arc-microgrants': 'Oct 14', 'colosseum-eternal': 'Mar 20, 2027',
    'colosseum-worlds-fair': 'Oct 12', 'monad-blitz-oregon': 'Nov 10', 'monad-metropolis': 'Oct 13',
    'solana-incubator-cohort-6': 'Dec 4', 'ugreen-ai-nas-hackathon-2026': 'Nov 15',
  };
  const dir = findProgramsDir()!;
  for (const [id, day] of Object.entries(days)) {
    const file = ProgramFile.parse(JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')));
    assert.equal(closeDay(file, NOW), day, id);
  }
  const c = await ctx();
  const oregon = ProgramFile.parse(JSON.parse(readFileSync(join(dir, 'monad-blitz-oregon.json'), 'utf8')));
  await upsertProgram({ ...oregon, id: 'tz-oregon', status: 'active' }, 'file', NOW);
  const r = await track({ ...c, now: new Date('2026-11-12T12:00:00Z') }, { program_id: 'tz-oregon', status: 'applied', submitted_by: 'builder' });
  assert.equal(r.show_to_builder, `${oregon.title} closed on Nov 10; recorded anyway.`);
});

test('v6.1.9: applied after the program closed is recorded and says so', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'cl-late', title: 'Late Grant', ends_at: '2026-11-04T03:14:00Z' }), 'file', NOW);
  const r = await track(c, { program_id: 'cl-late', status: 'applied', submitted_by: 'builder' });
  assert.equal(r.show_to_builder, 'Late Grant closed on Nov 4; recorded anyway.');
  assert.equal(r.ledger.applied, 1);
});

test('v6.1.9: a second skip says it is already skipped', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'sk-two', title: 'Skip Two' }), 'file', NOW);
  assert.equal((await track(c, { program_id: 'sk-two', status: 'skipped' })).show_to_builder, 'Skipped Skip Two for good. Say bring it back and I list it again.');
  assert.equal((await track(c, { program_id: 'sk-two', status: 'skipped' })).show_to_builder, 'Already skipped.');
});

test('v6.1.9: the night routine\'s find before a send under standing approval leaves the overnight report for the morning', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const { find } = await import('./find');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_203, login: 'night', name: 'N', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true, max_per_night: 1, categories: ['grant'] } }, 'builder', NOW).record, NOW);
  for (const id of ['nf-a', 'nf-b']) await upsertProgram(programFixture({ id, title: id, category: 'grant' }), 'file', NOW);
  const linked = (h: number) => ({ ...c, builderId: b.id, now: new Date(NOW.getTime() + h * 3_600_000) });
  const project = { name: 'Night App', description: 'An app.', live_url: 'https://night.example', users: true };
  const send = (h: number, id: string) => track(linked(h), { program_id: id, status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: ['project_name'] });
  await find(linked(0), { project });
  // Night 1: the routine's find, then a send.
  await find(linked(10), { project });
  await send(10.1, 'nf-a');
  // Night 2: the routine's find sees night 1's send, then sends again.
  await find(linked(34), { project });
  await send(34.1, 'nf-b');
  const morning = (await find(linked(40), { project })) as { applied_overnight: { program_id: string }[] };
  assert.deepEqual(morning.applied_overnight.map((x) => x.program_id), ['nf-a', 'nf-b']);
  // The morning find was the builder's: the next one starts after it.
  const later = (await find(linked(41), { project })) as { applied_overnight: unknown[] };
  assert.deepEqual(later.applied_overnight, []);
});

test('I1 (v6.1.9 final): the night sequence: a send under standing approval, no find after it, and the morning find of another installation of the builder reports it', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const { find } = await import('./find');
  const night = await ctx();
  const day = await ctx();
  const b = await upsertBuilder({ github_id: 930_204, login: 'night2', name: 'N', avatar_url: null }, NOW);
  await linkInstallation(night.installationId, b.id, NOW);
  await linkInstallation(day.installationId, b.id, NOW);
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true, max_per_night: 1, categories: ['grant'] } }, 'builder', NOW).record, NOW);
  await upsertProgram(programFixture({ id: 'i1-a', title: 'Night Grant', category: 'grant' }), 'file', NOW);
  const at = (c: typeof night, h: number) => ({ ...c, builderId: b.id, now: new Date(NOW.getTime() + h * 3_600_000) });
  const project = { name: 'Night App', description: 'An app.', live_url: 'https://night.example', users: true };
  await find(at(day, 0), { project });
  // The night routine: its find, then the send; the note tells the agent to stop there.
  await find(at(night, 10), { project });
  const sent = await track(at(night, 10.1), { program_id: 'i1-a', status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: ['project_name'] });
  assert.equal(sent.agent_note, "Done for now. The builder's next find reports it; do not call find again until they ask.");
  assert.doesNotMatch(sent.agent_note, /Call find again/);
  // The morning: the builder's other installation reports it.
  const morning = (await find(at(day, 18), { project })) as { applied_overnight: { program_id: string }[]; show_to_builder: string };
  assert.deepEqual(morning.applied_overnight.map((x) => x.program_id), ['i1-a']);
  assert.match(morning.show_to_builder, /Applied under your standing approval: Night Grant\./);
});

test('gap_done marks the step on its project: the one passed, else the last find\'s; started on another project skips the last find\'s remark (v6.1.10, L1c-1)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't10-pk', title: 'Project Grant', eligibility: [{ kind: 'users' }, { kind: 'demo_video' }] }), 'file', NOW);
  const A = { name: 'Alpha', repo_url: 'https://github.com/acme/alpha' };
  const keys = async () =>
    (await sql()`SELECT project_key, item FROM gaps_done WHERE installation_id = ${c.installationId} ORDER BY project_key, item`).map((r) => ({ ...r }));
  await markFind(c.installationId, NOW, { 't10-pk': { what: 'a demo video', kind: 'demo_video', item: 'demo_video' } }, 'https://github.com/acme/alpha');
  // A project passed wins (extra project fields are ignored), and Beta's step leaves Alpha's remembered gap alone.
  const b = await track(c, { program_id: 't10-pk', status: 'gap_done', item: 'demo_video', project: { name: 'Beta App', description: 'x', users: true } });
  assert.equal(b.show_to_builder, 'Tracked.');
  assert.deepEqual(Object.keys(await lastGaps(c.installationId)), ['t10-pk']);
  // Started on Beta does not speak for Alpha's gap; on Alpha it does.
  assert.equal((await track(c, { program_id: 't10-pk', status: 'started', project: { name: 'Beta App' } })).show_to_builder, '');
  // The last find was Alpha's: a track without a project marks it there; the same item is new on Alpha.
  assert.equal((await track(c, { program_id: 't10-pk', status: 'gap_done', item: 'demo_video' })).show_to_builder, 'Tracked.');
  assert.equal((await track(c, { program_id: 't10-pk', status: 'gap_done', item: 'demo_video', project: A })).show_to_builder, 'Already tracked.');
  assert.deepEqual(await keys(), [{ project_key: 'https://github.com/acme/alpha', item: 'demo_video' }, { project_key: 'name:beta app', item: 'demo_video' }]);
});

test('started on the last find\'s project keeps the remembered remark (v6.1.10, L1c-1)', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't10-pk2', title: 'Remark Grant', eligibility: [{ kind: 'demo_video' }] }), 'file', NOW);
  await markFind(c.installationId, NOW, { 't10-pk2': { what: 'a demo video', kind: 'demo_video', item: 'demo_video' } }, 'https://github.com/acme/alpha');
  const s = await track(c, { program_id: 't10-pk2', status: 'started', project: { repo_url: 'https://github.com/Acme/Alpha.git' } });
  assert.equal(s.show_to_builder, '');
});

test('F1 fix round 2 (v6.1.10): five real programs, a send naming every key is outside approval; the field no record or project holds is the reason', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const { getProgram } = await import('./programs');
  const { unvouchedAtSend } = await import('./track');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_301, login: 'fr2', name: 'F', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { person: { name: 'Ada Lovelace', email: 'ada@example.com' }, policy: { auto_apply: true, max_per_night: 10, categories: ['grant', 'hackathon', 'investment', 'bounty'] } }, 'builder', NOW).record, NOW);
  const linked = { ...c, builderId: b.id };
  const project = { name: 'Rent Split', description: 'Splits rent between roommates.', repo_url: 'https://github.com/ada/rent-split', live_url: 'https://rentsplit.example' };
  const cases: [string, string][] = [
    ['spc-founder-fellowship-spring-2027', 'linkedin'], ['floss-fund-zerodha', 'funding_json_url'], ['base-ecosystem-fund', 'x_url'],
    ['entrepreneurs-first-us', 'personal_webpage'], ['colosseum-worlds-fair', 'chains_and_tools'],
  ];
  const { eligibilityOf } = await import('./program-file');
  const { itemKey } = await import('./eligibility');
  // L29-8 (v6.1.16 Task 15): each program's rules confirmed first, so the send reaches the approval check.
  for (const [id] of cases)
    for (const x of eligibilityOf((await getProgram(id))!.file).filter((y) => y.kind === 'rule'))
      await track(linked, { program_id: id, status: 'gap_done', item: itemKey(x), project });
  for (const [id, key] of cases) {
    const row = (await getProgram(id))!;
    // L29-7 (v6.1.16 Task 15): an in-person program is never an agent's send.
    if (row.file.in_person) {
      const r = await track(linked, { program_id: id, status: 'applied', submitted_by: 'agent', fields_used: row.file.submission_requirements.map((x) => x.key), project });
      assert.equal(r.show_to_builder, `${row.file.title} is applied for in person; nothing to send.`, id);
      assert.equal(r.refused, true, id);
      continue;
    }
    const every = row.file.submission_requirements.map((r) => r.key);
    const i = { program_id: id, status: 'applied' as const, submitted_by: 'agent' as const, fields_used: every, project };
    assert.ok((await unvouchedAtSend(linked, i, row)).includes(key), id);
    const r = await track(linked, i);
    assert.match(r.show_to_builder, /Sent, but outside your standing approval: [^.]+\.$/, id);
    assert.equal((await sql()`SELECT auto_applied FROM applications WHERE owner = ${'b:' + b.id} AND program_id = ${id}`)[0].auto_applied, false, id);
  }
  // FLOSS/fund and Base Ecosystem Fund are within every limit: the unvouched answer is the reason.
  for (const id of ['floss-fund-zerodha', 'base-ecosystem-fund']) {
    await sql()`DELETE FROM applications WHERE owner = ${'b:' + b.id} AND program_id = ${id}`;
    const row = (await getProgram(id))!;
    const r = await track(linked, { program_id: id, status: 'applied', submitted_by: 'agent', fields_used: row.file.submission_requirements.map((x) => x.key), project });
    assert.equal(r.show_to_builder, 'Sent, but outside your standing approval: a required answer was missing.', id);
  }
});

test('F1 fix round 2 (v6.1.10): an agent field with no sources holds a send; the same send with its project named is approved', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_302, login: 'fr2b', name: 'F', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true, max_per_night: 10, categories: ['grant'] } }, 'builder', NOW).record, NOW);
  await upsertProgram(programFixture({ id: 'fr2-bare', title: 'Bare Grant', category: 'grant' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'fr2-named', title: 'Named Grant', category: 'grant' }), 'file', NOW);
  // No project anywhere: the project name is an agent draft with nothing to draft from.
  const bare = await track({ ...c, builderId: b.id }, { program_id: 'fr2-bare', status: 'applied', submitted_by: 'agent', fields_used: ['project_name'] });
  assert.equal(bare.show_to_builder, 'Sent, but outside your standing approval: a required answer was missing.');
  const named = await track({ ...c, builderId: b.id }, { program_id: 'fr2-named', status: 'applied', submitted_by: 'agent', fields_used: ['project_name'], project: { name: 'App' } });
  assert.equal(named.show_to_builder, 'Sent Named Grant.');
});

test('F1 fix round 2 (v6.1.10): find and track judge one fixture by the same list', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const { find } = await import('./find');
  const { getProgram } = await import('./programs');
  const { unvouchedAtSend } = await import('./track');
  const { unvouchedRequired } = await import('./prefill');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_303, login: 'fr2c', name: 'F', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { person: { email: 'ada@example.com' }, policy: { auto_apply: true, max_per_night: 10, categories: ['grant'] } }, 'builder', NOW).record, NOW);
  const fields = [
    { key: 'project_name', label: 'Project name', type: 'text', required: true, from: 'project', kind: 'name', todo: 'a project name' },
    { key: 'problem', label: 'What problem do you solve', type: 'text', required: true, from: 'project', kind: 'problem', todo: 'the problem' },
    { key: 'linkedin', label: 'LinkedIn', type: 'url', required: true, from: 'builder', kind: 'links', todo: 'your LinkedIn' },
    { key: 'email', label: 'Contact email', type: 'email', required: true, from: 'builder', kind: 'contact', todo: 'your email' },
  ];
  await upsertProgram(programFixture({ id: 'fr2-same', title: 'Same Grant', category: 'grant', submission_requirements: fields as never }), 'file', NOW);
  const project = { name: 'Same App', description: 'An app.', live_url: 'https://same.example' };
  const r = (await find({ ...c, builderId: b.id }, { project, filter: { all: true } })) as unknown as { ready: { program_id: string; fields: never[]; need_you: string[] }[]; show_to_builder: string };
  const ready = r.ready.find((p) => p.program_id === 'fr2-same')!;
  // L26-4 (v6.1.16 Task 12): the full list's fields are key, label, value and source; the program's own find has the rest.
  const one = (await find({ ...c, builderId: b.id }, { program_id: 'fr2-same', project })) as unknown as { fields: never[] };
  const fromFind = unvouchedRequired(one.fields).map((f: { key: string }) => f.key);
  assert.deepEqual(fromFind, ['problem', 'linkedin']);
  assert.deepEqual(ready.need_you, ['the problem', 'your LinkedIn']);
  assert.doesNotMatch(r.show_to_builder.split('\n').at(-1)!, /Same Grant/);
  const row = (await getProgram('fr2-same'))!;
  const i = { program_id: 'fr2-same', status: 'applied' as const, submitted_by: 'agent' as const, fields_used: fields.map((f) => f.key), project };
  assert.deepEqual(await unvouchedAtSend({ ...c, builderId: b.id }, i, row), fromFind);
  assert.equal((await track({ ...c, builderId: b.id }, i)).show_to_builder, 'Sent, but outside your standing approval: a required answer was missing.');
});

test('I3 final (v6.1.10): a required contract find filled from the cached repo read is vouched at send time; with no cached read it is not', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const { find } = await import('./find');
  const { getProgram } = await import('./programs');
  const { unvouchedAtSend } = await import('./track');
  const { unvouchedRequired } = await import('./prefill');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_304, login: 'fr3', name: 'F', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true, max_per_night: 10, categories: ['grant'] } }, 'builder', NOW).record, NOW);
  const fields = [
    { key: 'project_name', label: 'Project name', type: 'text', required: true, from: 'project', kind: 'name', todo: 'a project name' },
    { key: 'contract_address', label: 'Contract address on Base', type: 'text', required: true, from: 'project', kind: 'other', todo: 'your contract address on Base' },
  ];
  await upsertProgram(programFixture({ id: 'fi3-contract', title: 'Contract Grant', category: 'grant', submission_requirements: fields as never }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'fi3-unread', title: 'Unread Grant', category: 'grant', submission_requirements: fields as never }), 'file', NOW);
  const address = '0x' + 'ab'.repeat(20);
  const cached = {
    chains: [{ chain: 'base', mainnet: true }], contracts: [{ chain: 'base', address }], builder_codes: false, integrations: [],
    first_commit_at: '2026-01-01T00:00:00.000Z', last_commit_at: '2026-11-01T00:00:00.000Z', readme_excerpt: 'A vault on Base.', homepage: null, topics: [],
    html_url: 'https://github.com/ada/vault', pushed_at: '2026-11-01T00:00:00.000Z', fork: false, archived: false, empty: false, readme_lead: 'A vault on Base.',
  };
  await sql()`DELETE FROM repo_cache WHERE repo = 'ada/vault'`;
  await sql()`INSERT INTO repo_cache (repo, facts, fetched_at, pushed_at) VALUES ('ada/vault', ${sql().json(cached)}, ${NOW}, ${new Date(cached.pushed_at)})`;
  const project = { name: 'Vault', description: 'A vault on Base.', repo_url: 'https://github.com/ada/vault' };
  // Find fills the contract from the cached read: nothing unvouched, so it is on tonight's list.
  const r = (await find({ ...c, builderId: b.id }, { project, filter: { all: true } })) as unknown as { ready: { program_id: string; fields: never[] }[] };
  const ready = r.ready.find((p) => p.program_id === 'fi3-contract')!;
  assert.deepEqual(unvouchedRequired(ready.fields), []);
  // Track reads the same cached row (no fetch is possible here: no gh is passed) and agrees.
  const row = (await getProgram('fi3-contract'))!;
  const i = { program_id: 'fi3-contract', status: 'applied' as const, submitted_by: 'agent' as const, fields_used: ['project_name', 'contract_address'], project };
  assert.deepEqual(await unvouchedAtSend({ ...c, builderId: b.id }, i, row), []);
  assert.equal((await track({ ...c, builderId: b.id }, i)).show_to_builder, 'Sent Contract Grant.');
  assert.equal((await sql()`SELECT auto_applied FROM applications WHERE owner = ${'b:' + b.id} AND program_id = 'fi3-contract'`)[0].auto_applied, true);
  // The last find's project key alone (no project passed) reaches the same cached row.
  assert.deepEqual(await unvouchedAtSend({ ...c, builderId: b.id }, { ...i, project: undefined }, row), []);
  // No cached read for the repo: the report alone, which holds no contract, so the send is outside approval.
  const other = { ...project, repo_url: 'https://github.com/ada/unread' };
  const j = { ...i, program_id: 'fi3-unread', project: other };
  assert.deepEqual(await unvouchedAtSend({ ...c, builderId: b.id }, j, (await getProgram('fi3-unread'))!), ['contract_address']);
  assert.equal((await track({ ...c, builderId: b.id }, j)).show_to_builder, 'Sent, but outside your standing approval: a required answer was missing.');
});

test('final round (v6.1.10), B5 (v6.1.13): the track project is read as find reads it (cut and dropped, never refused) and keyed as find keys it', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'fcap-a', title: 'Cap Grant', eligibility: [{ kind: 'users' }] }), 'file', NOW);
  const long = await track(c, { program_id: 'fcap-a', status: 'started', project: { name: 'n'.repeat(121) } });
  assert.equal(long.show_to_builder, '');
  assert.match(long.agent_note, / Project: name cut to 80 characters\.$/);
  const [claimRow] = await sql()`SELECT project_id FROM applications WHERE owner = ${'i:' + c.installationId} AND program_id = 'fcap-a'`;
  assert.equal(claimRow.project_id, `name:${'n'.repeat(80)}`);
  const longRepo = await track(c, { program_id: 'fcap-a', status: 'gap_done', item: 'users', project: { name: 'A', repo_url: 'https://github.com/a/' + 'b'.repeat(480) } });
  assert.equal(longRepo.show_to_builder, 'Tracked.');
  assert.match(longRepo.agent_note, /Project: repo_url dropped: not a web link\.$/);
  // A name with two spaces lands on the key find gives the parsed name.
  assert.equal((await track(c, { program_id: 'fcap-a', status: 'gap_done', item: 'users', project: { name: 'My  App' } })).show_to_builder, 'Tracked.');
  const rows = await sql()`SELECT project_key FROM gaps_done WHERE owner = ${'i:' + c.installationId} AND program_id = 'fcap-a' ORDER BY project_key`;
  assert.deepEqual(rows.map((r) => r.project_key), ['name:a', 'name:my app']);
  // L13-4 (v6.1.14): a project that is not an object is dropped and named for the agent; the step still records.
  const str = await track(c, { program_id: 'fcap-a', status: 'skipped', project: 'My App' });
  assert.equal(str.show_to_builder, 'Skipped Cap Grant for good. Say bring it back and I list it again.');
  assert.match(str.agent_note, / Some arguments were not read: project dropped: not an object\.$/);
});

test('Review Focus 4 (v6.1.13, B5): the find\'s own project, however long, is accepted by track', async () => {
  const { parseProject, projectKeyOf } = await import('./project-input');
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'rf4-a', title: 'Long Grant', eligibility: [{ kind: 'users' }] }), 'file', NOW);
  const P = {
    name: 'N'.repeat(200), description: 'd'.repeat(1000), repo_url: 'https://github.com/a/' + 'b'.repeat(540), live_url: 'nope',
    chains: [{ chain: 'base', mainnet: true }, 'not-a-chain'], users: 'yes', last_commit_at: 'soon',
  };
  const found = parseProject(P, NOW);
  assert.ok(found.ok);
  for (const status of ['gap_done', 'started', 'skipped', 'unskip'] as const) {
    const r = await track(c, { program_id: 'rf4-a', status, project: P, ...(status === 'gap_done' ? { item: 'users' } : {}) });
    assert.doesNotMatch(r.show_to_builder, /could not read/, status);
  }
  const [row] = await sql()`SELECT project_key FROM gaps_done WHERE owner = ${'i:' + c.installationId} AND program_id = 'rf4-a'`;
  assert.equal(row.project_key, projectKeyOf(found.project));
});

test('Review Focus 4 (v6.1.12, F8): a send under standing approval to a program closed over an hour ago is not under it: it had closed', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_311, login: 'f8', name: 'F', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true, max_per_night: 5, categories: ['grant'] } }, 'builder', NOW).record, NOW);
  const H = 3_600_000;
  const p = (id: string, endsAgo: number) => upsertProgram(programFixture({ id, title: id, category: 'grant', ends_at: new Date(NOW.getTime() - endsAgo).toISOString() }), 'file', NOW);
  await p('f8-hours', 3 * H);
  await p('f8-minutes', 20 * 60_000);
  const send = (id: string) => track({ ...c, builderId: b.id }, { program_id: id, status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: ['project_name'] });
  const auto = async (id: string) => (await sql()`SELECT auto_applied FROM applications WHERE owner = ${'b:' + b.id} AND program_id = ${id}`)[0].auto_applied;
  const late = await send('f8-hours');
  assert.equal(late.show_to_builder, 'f8-hours closed on Nov 4; recorded anyway, not under your standing approval.');
  assert.equal(await auto('f8-hours'), false);
  assert.equal(late.ledger.applied, 1);
  // Within the hour it still counts: the agent sent it as it closed.
  const just = await send('f8-minutes');
  assert.equal(just.show_to_builder, 'f8-minutes closed on Nov 4; recorded anyway.');
  assert.equal(await auto('f8-minutes'), true);
  // The ledger's own check: a send recorded as approved after the hour is stored as not.
  const { record } = await import('./ledger');
  await p('f8-direct', 2 * H);
  assert.deepEqual(await record('b:' + b.id, 'f8-direct', 'applied', { installationId: c.installationId, now: NOW, submitted_by: 'agent', autoApplied: true }), { ok: true, closed: true });
  assert.equal(await auto('f8-direct'), false);
  // Final fix (v6.1.12): the edge. Closed exactly an hour ago still counts; a minute past the hour it had closed.
  await p('f8-hour', H);
  await p('f8-hour-1', H + 60_000);
  assert.equal((await send('f8-hour')).show_to_builder, 'f8-hour closed on Nov 4; recorded anyway.');
  assert.equal(await auto('f8-hour'), true);
  assert.equal((await send('f8-hour-1')).show_to_builder, 'f8-hour-1 closed on Nov 4; recorded anyway, not under your standing approval.');
  assert.equal(await auto('f8-hour-1'), false);
});

test('F4 (v6.1.12), re-pinned by L24-3 (v6.1.16 Task 11): track takes a program by its id, title or title words only; several or none says so and records nothing', async () => {
  const c = await ctx();
  // An organizer's name is find's lookup, never track's (strict). Initials name the program (v6.1.16 Task 15 ruling).
  const yc = await track(c, { program_id: 'yc', status: 'started' });
  assert.match(yc.agent_note, /^Matched y-combinator\. /);
  await sql()`DELETE FROM applications WHERE program_id = 'y-combinator'`;
  assert.equal((await track(c, { program_id: 'Thiel Foundation', status: 'skipped' })).show_to_builder, 'Which program do you mean?');
  const started = await track(c, { program_id: 'Y Combinator Winter 2027 Batch', status: 'started' });
  assert.equal(started.show_to_builder, '');
  assert.match(started.agent_note, /^Matched y-combinator\. /);
  assert.equal((await sql()`SELECT program_id FROM applications WHERE installation_id = ${c.installationId}`)[0].program_id, 'y-combinator');
  const skipped = await track(c, { program_id: 'Thiel Fellowship', status: 'skipped' });
  assert.equal(skipped.show_to_builder, 'Skipped Thiel Fellowship for good. Say bring it back and I list it again.');
  const several = await track(c, { program_id: 'uniswap', status: 'applied', submitted_by: 'builder' });
  assert.equal(several.show_to_builder, "Did you mean Uniswap Foundation Open Grants or Uniswap Foundation Security Fund (UFSF) Audit Subsidies?");
  assert.equal(several.agent_note, 'Nothing was recorded. program_id takes the id or the name; a list number maps to the id in the JSON.');
  assert.equal((await track(c, { program_id: 'qqq-zzz', status: 'skipped' })).show_to_builder, 'Which program do you mean?');
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE installation_id = ${c.installationId}`)[0].n, 2);
});

test('F6 (v6.1.12): a code step marked done on a project with no repo asks to be told when it is live', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'f6-live', title: 'F6 Live', eligibility: [{ kind: 'live_product' }] }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'f6-chain', title: 'F6 Chain', eligibility: [{ kind: 'chain', value: 'arc' }] as never }), 'file', NOW);
  const bare = await track(c, { program_id: 'f6-chain', status: 'gap_done', item: 'chain:arc', project: { name: 'No Repo' } });
  assert.deepEqual([bare.show_to_builder, bare.agent_note], ['Tracked. Tell me when it is live and I look again.', 'When the builder says it is live, call find again with its repo or live link.']);
  assert.doesNotMatch(bare.show_to_builder, /repo/);
  const none = await track(c, { program_id: 'f6-live', status: 'gap_done', item: 'live_product' });
  assert.equal(none.show_to_builder, 'Tracked. Tell me when it is live and I look again.');
  // With a repo the read is the check.
  const repo = await track(c, { program_id: 'f6-live', status: 'gap_done', item: 'live_product', project: { name: 'Has Repo', repo_url: 'https://github.com/a/b' } });
  assert.deepEqual([repo.show_to_builder, repo.agent_note], ['Tracked. I check the repo on the next look.', 'Call find again so the repo is re-read.']);
});

test('final fix (v6.1.12, I2), re-pinned by L24-3 (v6.1.16 Task 11): loose names record nothing; a title word that is one program says which it recorded', async () => {
  const c = await ctx();
  const count = async () => (await sql()`SELECT count(*)::int AS n FROM applications WHERE installation_id = ${c.installationId}`)[0].n;
  // A parent organizer in brackets, two letters, the start of a title: no program, nothing written.
  for (const name of ['aws', 'fi', 'kiro'])
    assert.equal((await track(c, { program_id: name, status: 'applied', submitted_by: 'builder' })).show_to_builder, 'Which program do you mean?', name);
  assert.equal(await count(), 0);
  // A whole title word that is one program resolves, and the line names it.
  const sent = await track(c, { program_id: 'kiroween', status: 'applied', submitted_by: 'builder' });
  assert.equal(sent.show_to_builder, 'Sent Kiroween 2026.');
  assert.match(sent.agent_note, /^Matched kiroween-2026\. /);
  assert.equal((await sql()`SELECT program_id FROM applications WHERE installation_id = ${c.installationId}`)[0].program_id, 'kiroween-2026');
  assert.equal((await track(c, { program_id: 'kiroween', status: 'no_result' })).show_to_builder, 'Tracked: Kiroween 2026.');
  const thiel = await track(c, { program_id: 'thiel', status: 'skipped' });
  assert.equal(thiel.show_to_builder, 'Skipped Thiel Fellowship for good. Say bring it back and I list it again.');
  assert.equal((await track(c, { program_id: 'floss', status: 'started' })).show_to_builder, '');
  // The id itself: the plain line, as before.
  assert.equal((await track(c, { program_id: 'codegeist-2026', status: 'applied', submitted_by: 'builder' })).show_to_builder, 'Sent Codegeist 2026.');
});

test('final fix (v6.1.12, Task 2 I1): a result on an id held as sent is that id, before any matching', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'ff-held', title: 'Held Grant' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'ff-held-studio', title: 'Held Grant Studio' }), 'file', NOW);
  await track(c, { program_id: 'ff-held', status: 'applied', submitted_by: 'builder' });
  // The sent program leaves the catalog; its id still starts the other one's.
  await sql()`DELETE FROM programs WHERE id = 'ff-held'`;
  const won = await track(c, { program_id: 'ff-held', status: 'won', amount_usd: 1000 });
  assert.equal(won.show_to_builder, 'Tracked: $1,000 from Held Grant.');
  const rows = await sql()`SELECT program_id, status FROM applications WHERE installation_id = ${c.installationId} ORDER BY program_id`;
  assert.deepEqual(rows.map((r) => [r.program_id, r.status]), [['ff-held', 'won']]);
});

test('B6 (v6.1.13, Review Focus 5): a send with 300 field keys is recorded, keeping the first 200; the tool list still says a list of text', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'b6-many', title: 'Many Grant' }), 'file', NOW);
  const keys = Array.from({ length: 300 }, (_, n) => (n === 0 ? 'project_name' : `k${n}`));
  const r = await track(c, { program_id: 'b6-many', status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: [...keys.slice(0, 299), 'x'.repeat(90)] });
  assert.equal(r.show_to_builder, 'Sent Many Grant.');
  const [row] = await sql()`SELECT status, fields_used FROM applications WHERE program_id = 'b6-many' AND installation_id = ${c.installationId}`;
  assert.equal(row.status, 'applied');
  assert.deepEqual(row.fields_used, keys.slice(0, 200));
  // A key over 60 characters is cut, never refused.
  const { TrackInput } = await import('./track');
  assert.deepEqual(TrackInput.parse({ program_id: 'p', status: 'applied', fields_used: ['y'.repeat(90)] }).fields_used, ['y'.repeat(60)]);
  const { z } = await import('zod');
  const { lenient } = await import('./tool-input');
  const schema = z.toJSONSchema(lenient(TrackInput), { io: 'input' }) as { properties: Record<string, { type?: string; items?: { type?: string } }> };
  assert.equal(schema.properties.fields_used.type, 'array');
  assert.equal(schema.properties.fields_used.items?.type, 'string');
});

test('B3 (v6.1.13), re-pinned by L23-3 (v6.1.16): applied over another agent\'s live claim is recorded, the claim cleared, the agent warned', async () => {
  const { a, c, owner } = await twoAgents();
  await upsertProgram(programFixture({ id: 'b3-claim', title: 'Claim Grant' }), 'file', NOW);
  assert.equal((await track(a, { program_id: 'b3-claim', status: 'started', project: { name: 'Xproj' } })).show_to_builder, '');
  const history = async () => (await sql()`SELECT count(*)::int AS n FROM application_history WHERE owner = ${owner} AND program_id = 'b3-claim'`)[0].n;
  const before = await history();
  const other = await track({ ...c, now: new Date(NOW.getTime() + 3_600_000) }, { program_id: 'b3-claim', status: 'applied', submitted_by: 'agent', project: { name: 'Yproj' }, fields_used: ['project_name'] });
  assert.equal(other.show_to_builder, 'Sent Claim Grant.');
  assert.equal(other.agent_note, 'Recorded. Another agent had started this one too; tell the builder so it is not sent twice.');
  assert.equal(other.ledger.applied, 1);
  assert.equal(await history(), before + 1);
  const [sent] = await sql()`SELECT status, installation_id, claimed_by, project_id FROM applications WHERE owner = ${owner} AND program_id = 'b3-claim'`;
  assert.deepEqual([sent.status, sent.installation_id, sent.claimed_by, sent.project_id], ['applied', c.installationId, null, 'name:yproj']);
  // The holder's send after it hears it was already sent; nothing changes.
  const mine = await track({ ...a, now: new Date(NOW.getTime() + 2 * 3_600_000) }, { program_id: 'b3-claim', status: 'applied', submitted_by: 'agent', project: { name: 'Xproj' }, fields_used: ['project_name'] });
  assert.match(mine.show_to_builder, /^Already sent here on Nov 4 by .+; nothing recorded\.$/);
  assert.equal(await history(), before + 1);
  // A claim past its 24 hours holds nothing: another agent's send is recorded.
  await upsertProgram(programFixture({ id: 'b3-stale', title: 'Stale Grant' }), 'file', NOW);
  await track(a, { program_id: 'b3-stale', status: 'started' });
  const late = await track({ ...c, now: new Date(NOW.getTime() + 25 * 3_600_000) }, { program_id: 'b3-stale', status: 'applied', submitted_by: 'agent', project: { name: 'Yproj' } });
  assert.equal(late.show_to_builder, 'Sent Stale Grant.');
});

test('B2 (v6.1.13, Review Focus 2): a send whose verdict for the project is not ready is never under standing approval', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const { itemKey, ruleItem } = await import('./eligibility');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_413, login: 'b2', name: 'B', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true, max_per_night: 20, categories: ['grant'] } }, 'builder', NOW).record, NOW);
  const linked = { ...c, builderId: b.id };
  const p = (id: string, over: Record<string, unknown> = {}) => upsertProgram(programFixture({ id, title: id, category: 'grant', ...over }), 'file', NOW);
  const send = (id: string, project: Record<string, unknown> = { name: 'App' }) =>
    track(linked, { program_id: id, status: 'applied', submitted_by: 'agent', project, fields_used: ['project_name'] });
  const auto = async (id: string) => (await sql()`SELECT status, auto_applied FROM applications WHERE owner = ${'b:' + b.id} AND program_id = ${id}`)[0];
  const AWAY = 'Sent, but outside your standing approval: it was still a step away.';
  const video = [{ kind: 'demo_video' }];
  await p('b2-video', { eligibility: video });
  await p('b2-video-done', { eligibility: video });
  await p('b2-rule', { eligibility: [{ kind: 'rule', note: RULE }] });
  await p('b2-rule-ok', { eligibility: [{ kind: 'rule', note: RULE }] });
  await p('b2-bar', { min_tier: 'used' });
  await p('b2-ready');
  // One step away (a demo video), every field named: recorded as sent, not under standing approval.
  const away = await send('b2-video');
  assert.equal(away.show_to_builder, AWAY);
  assert.match(away.agent_note, /^Recorded as applied, not under standing approval\./);
  assert.deepEqual({ ...(await auto('b2-video')) }, { status: 'applied', auto_applied: false });
  // The same step marked done on this project first: ready, so approved.
  await track(linked, { program_id: 'b2-video-done', status: 'gap_done', item: itemKey({ kind: 'demo_video' } as never), project: { name: 'App' } });
  assert.equal((await send('b2-video-done')).show_to_builder, 'Sent b2-video-done.');
  assert.equal((await auto('b2-video-done')).auto_applied, true);
  // A rule not confirmed is a step away; confirmed on this project it is ready. Confirmed on another project it is not.
  await track(linked, { program_id: 'b2-rule', status: 'gap_done', item: ruleItem(RULE), project: { name: 'Other' } });
  // L29-8 (v6.1.16 Task 15): a rule confirmed on another project is no confirmation here: the send is refused first.
  assert.equal((await send('b2-rule')).show_to_builder, `Confirm the rule first: ${RULE}. Say yes if that is you.`);
  assert.equal((await sql()`SELECT 1 FROM applications WHERE owner = ${'b:' + b.id} AND program_id = 'b2-rule'`).length, 0);
  await track(linked, { program_id: 'b2-rule-ok', status: 'gap_done', item: ruleItem(RULE), project: { name: 'App' } });
  assert.equal((await send('b2-rule-ok')).show_to_builder, 'Sent b2-rule-ok.');
  assert.equal((await auto('b2-rule-ok')).auto_applied, true);
  // An onchain project below the program's bar (nothing read, no tier) does not fit: never under standing approval.
  assert.equal((await send('b2-bar', { name: 'App', chains: ['base'] })).show_to_builder, AWAY);
  assert.equal((await auto('b2-bar')).auto_applied, false);
  // A program with nothing left is approved as before.
  assert.equal((await send('b2-ready')).show_to_builder, 'Sent b2-ready.');
  assert.equal((await auto('b2-ready')).auto_applied, true);
});

test('Task 1 review I1 and I2 (v6.1.13): the send is judged on the find\'s report merged as find merges it, never on less', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const { find } = await import('./find');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_414, login: 'b2r', name: 'B', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true, max_per_night: 20, categories: ['grant'] } }, 'builder', NOW).record, NOW);
  const linked = { ...c, builderId: b.id };
  const p = (id: string, over: Record<string, unknown> = {}) => upsertProgram(programFixture({ id, title: id, category: 'grant', ...over }), 'file', NOW);
  const send = (id: string, project: Record<string, unknown>) =>
    track(linked, { program_id: id, status: 'applied', submitted_by: 'agent', project, fields_used: ['project_name'] });
  const auto = async (id: string) => (await sql()`SELECT auto_applied FROM applications WHERE owner = ${'b:' + b.id} AND program_id = ${id}`)[0].auto_applied;
  // L29-32 (v6.1.16 Task 15): the send by name.
  const SENT = (id: string) => `Sent ${id}.`;
  await p('i2-contract', { eligibility: [{ kind: 'contract_on', value: 'base' }] });
  await p('i2-codes', { eligibility: [{ kind: 'builder_codes' }] });
  await p('i1-bar', { min_tier: 'live' });
  // I2: a reported contract with no repo is the report find reads, so the send is approved.
  const address = '0x' + '11'.repeat(20);
  assert.equal((await send('i2-contract', { name: 'Vault', description: 'A vault.', chains: [{ chain: 'base', mainnet: true, contract: address }] })).show_to_builder, SENT('i2-contract'));
  assert.equal(await auto('i2-contract'), true);
  // Builder Codes reported with no repo: approved.
  assert.equal((await send('i2-codes', { name: 'Vault', description: 'A vault.', builder_codes: true })).show_to_builder, SENT('i2-codes'));
  assert.equal(await auto('i2-codes'), true);
  // I1: find gated the bar program for the onchain project; a name-only send of it is a step away, auto false.
  const P = { name: 'Chain App', description: 'An app on Base.', chains: [{ chain: 'base', mainnet: true }] };
  const r = (await find(linked, { project: P, filter: { all: true } })) as unknown as { ready: { program_id: string }[] };
  assert.ok(!r.ready.some((x) => x.program_id === 'i1-bar'));
  assert.equal((await send('i1-bar', { name: 'Chain App' })).show_to_builder, 'Sent, but outside your standing approval: it was still a step away.');
  assert.equal(await auto('i1-bar'), false);
  // Fix round 1 (I1), P1: a find with the repo, then a name-only send. P2: a name-only find, then a send with the repo.
  await p('i1-bar-p1', { min_tier: 'live' });
  await p('i1-bar-p2', { min_tier: 'live' });
  const P1 = { name: 'Chain Repo App', description: 'An app on Base.', repo_url: 'https://github.com/ada/chain-repo-app', private: true, chains: [{ chain: 'base', mainnet: true }] };
  const f1 = (await find(linked, { project: P1, filter: { all: true } })) as unknown as { ready: { program_id: string }[] };
  assert.ok(!f1.ready.some((x) => x.program_id === 'i1-bar-p1'));
  assert.equal((await send('i1-bar-p1', { name: 'Chain Repo App' })).show_to_builder, 'Sent, but outside your standing approval: it was still a step away.');
  assert.equal(await auto('i1-bar-p1'), false);
  const P2 = { name: 'Chain Name App', description: 'An app on Base.', chains: [{ chain: 'base', mainnet: true }] };
  const f2 = (await find(linked, { project: P2, filter: { all: true } })) as unknown as { ready: { program_id: string }[] };
  assert.ok(!f2.ready.some((x) => x.program_id === 'i1-bar-p2'));
  assert.equal((await send('i1-bar-p2', { name: 'Chain Name App', repo_url: 'https://github.com/ada/chain-name-app', private: true })).show_to_builder, 'Sent, but outside your standing approval: it was still a step away.');
  assert.equal(await auto('i1-bar-p2'), false);
});

test('Low 17 (v6.1.13): a skip over a program already sent says so and records nothing', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'l17-a', title: 'Sent Grant' }), 'file', NOW);
  await track(c, { program_id: 'l17-a', status: 'applied' });
  const history = async () => (await sql()`SELECT count(*)::int AS n FROM application_history WHERE owner = ${'i:' + c.installationId}`)[0].n;
  const before = await history();
  const r = await track(c, { program_id: 'l17-a', status: 'skipped' });
  assert.equal(r.show_to_builder, 'That one was already sent; nothing to skip.');
  assert.equal(r.agent_note, 'Nothing was recorded.');
  assert.equal(await history(), before);
  assert.equal((await sql()`SELECT status FROM applications WHERE owner = ${'i:' + c.installationId} AND program_id = 'l17-a'`)[0].status, 'applied');
});


test('W1 and W2 (v6.1.13 final round): a project known by its repo, named alone at send or at find, keeps its steps and verdict', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const { ruleItem } = await import('./eligibility');
  const { find } = await import('./find');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_415, login: 'w1', name: 'W', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true, max_per_night: 20, categories: ['grant'] } }, 'builder', NOW).record, NOW);
  const linked = { ...c, builderId: b.id };
  const W_RULE = 'a project that keeps one key';
  await upsertProgram(programFixture({ id: 'w1-rule', title: 'Key Grant', category: 'grant', eligibility: [{ kind: 'rule', note: W_RULE }] }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'w2-rule', title: 'Key Grant Two', category: 'grant', eligibility: [{ kind: 'rule', note: W_RULE }] }), 'file', NOW);
  const P = { name: 'One Key App', description: 'An app.', repo_url: 'https://github.com/ada/one-key-app', private: true };
  const readyIds = async (project: Record<string, unknown>) =>
    ((await find(linked, { project, filter: { all: true } })) as unknown as { ready: { program_id: string }[] }).ready.map((x) => x.program_id);
  assert.ok(!(await readyIds(P)).includes('w1-rule'));
  for (const id of ['w1-rule', 'w2-rule']) await track(linked, { program_id: id, status: 'gap_done', item: ruleItem(W_RULE), project: P });
  assert.ok((await readyIds(P)).includes('w1-rule'));
  // W1: a name-only send of a program find listed as ready is under standing approval.
  const sent = await track(linked, { program_id: 'w1-rule', status: 'applied', submitted_by: 'agent', fields_used: ['project_name'], project: { name: 'One Key App' } });
  assert.equal(sent.show_to_builder, 'Sent Key Grant.');
  assert.equal((await sql()`SELECT auto_applied FROM applications WHERE owner = ${'b:' + b.id} AND program_id = 'w1-rule'`)[0].auto_applied, true);
  // W2: a name-only find does not ask the yes again.
  const byName = await readyIds({ name: 'One Key App', description: 'An app.' });
  assert.ok(byName.includes('w2-rule'), byName.join(','));
  // And the next find with the repo still sees it.
  assert.ok((await readyIds(P)).includes('w2-rule'));
});

test('L13-3 (v6.1.14): a send with a note over 280 characters is tracked, its note cut to 280', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'l13-note', title: 'Note Grant' }), 'file', NOW);
  const r = await track(c, { program_id: 'l13-note', status: 'applied', note: 'n'.repeat(352) });
  assert.equal(r.show_to_builder, 'Sent Note Grant.');
  const [row] = await sql()`SELECT status, note FROM applications WHERE owner = ${'i:' + c.installationId} AND program_id = 'l13-note'`;
  assert.deepEqual([row.status, row.note], ['applied', 'n'.repeat(280)]);
});

test('L13-1 (v6.1.14): a recorded send answers its own application id, kept on the row; a refused send has none', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'l13-id', title: 'Id Grant' }), 'file', NOW);
  const r = await track(c, { program_id: 'l13-id', status: 'applied' });
  assert.match(r.application_id ?? '', /^ek-[A-Za-z0-9_-]{12}$/);
  const [row] = await sql()`SELECT application_id FROM applications WHERE owner = ${'i:' + c.installationId} AND program_id = 'l13-id'`;
  assert.equal(row.application_id, r.application_id);
  const again = await track(c, { program_id: 'l13-id', status: 'applied' });
  assert.equal('application_id' in again, false);
  assert.equal('application_id' in (await track(c, { program_id: 'l13-id', status: 'won', amount_usd: 10 })), false);
});

test('L13-2 (v6.1.14, Review Focus 8): an unlink on /me releases that agent\'s claims; its later send is under no builder', async () => {
  const { unlinkInstallation } = await import('../v6/builders');
  const { a, c, owner } = await twoAgents();
  await upsertProgram(programFixture({ id: 'l13-unl', title: 'Race 4' }), 'file', NOW);
  assert.equal((await track(a, { program_id: 'l13-unl', status: 'started' })).show_to_builder, '');
  assert.equal(await unlinkInstallation(a.installationId, c.builderId!, NOW), true);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${owner} AND program_id = 'l13-unl'`)[0].n, 0);
  // The builder's other agent sends at once, with no other agent line.
  const later = { ...c, now: new Date(NOW.getTime() + 3_600_000) };
  const sent = await track(later, { program_id: 'l13-unl', status: 'applied', submitted_by: 'agent' });
  assert.equal(sent.show_to_builder, 'Sent Race 4.');
  assert.doesNotMatch(JSON.stringify(sent), /other agent/i);
  // The unlinked agent's own send lands in its own ledger, never the builder's.
  const own = await track({ ...a, builderId: null, now: later.now }, { program_id: 'l13-unl', status: 'applied', submitted_by: 'agent' });
  assert.equal(own.show_to_builder, 'Sent Race 4.');
  assert.equal(own.ledger.applied, 1);
  const [b] = await sql()`SELECT status, installation_id FROM applications WHERE owner = ${owner} AND program_id = 'l13-unl'`;
  assert.deepEqual([b.status, b.installation_id], ['applied', c.installationId]);
  const [i] = await sql()`SELECT status FROM applications WHERE owner = ${'i:' + a.installationId} AND program_id = 'l13-unl'`;
  assert.equal(i.status, 'applied');
});

test('L13-6 (v6.1.14): a send under standing approval to a program that has not opened is recorded outside it: it has not opened yet', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_614, login: 'l136', name: 'B', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true, max_per_night: 20, categories: ['grant'] } }, 'builder', NOW).record, NOW);
  await upsertProgram(programFixture({ id: 'l136-soon', title: 'Soon Grant', category: 'grant', status: 'upcoming', opens_note: 'Opens Nov 11' }), 'file', NOW);
  const r = await track({ ...c, builderId: b.id }, { program_id: 'l136-soon', status: 'applied', submitted_by: 'agent', project: { name: 'App' }, fields_used: ['project_name'] });
  assert.equal(r.show_to_builder, 'Sent, but outside your standing approval: it has not opened yet.');
  assert.match(r.agent_note, /^Recorded as applied, not under standing approval\./);
  const [row] = await sql()`SELECT status, auto_applied FROM applications WHERE owner = ${'b:' + b.id} AND program_id = 'l136-soon'`;
  assert.deepEqual({ ...row }, { status: 'applied', auto_applied: false });
});

test('L13-7 (v6.1.14): an agent send after the builder turned standing approval off since the find says it was off; with it never on, the plain line', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const { markFindAuto } = await import('./installations');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_617, login: 'l137', name: 'B', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: false } }, 'builder', NOW).record, NOW);
  await upsertProgram(programFixture({ id: 'l137-a', title: 'Off Grant A', category: 'grant' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'l137-b', title: 'Off Grant B', category: 'grant' }), 'file', NOW);
  const linked = { ...c, builderId: b.id };
  const send = (id: string, by = 'agent') => track(linked, { program_id: id, status: 'applied', submitted_by: by, project: { name: 'App' }, fields_used: ['project_name'] });
  // The last find saw standing approval on; it is off now.
  await markFindAuto(c.installationId, true);
  const off = await send('l137-a');
  assert.equal(off.show_to_builder, 'Sent, but outside your standing approval: it was off.');
  assert.match(off.agent_note, /^Recorded as applied, not under standing approval\./);
  // The builder's own submit, or a find that saw it off: the plain line.
  assert.equal((await send('l137-b', 'builder')).show_to_builder, 'Sent Off Grant B.');
  await sql()`DELETE FROM applications WHERE program_id = 'l137-b'`;
  await markFindAuto(c.installationId, false);
  assert.equal((await send('l137-b')).show_to_builder, 'Sent Off Grant B.');
});

test('T5-F1 (v6.1.14): started answers the application id with the note to put it in the form; applied keeps that id', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'f1-start', title: 'Start Grant' }), 'file', NOW);
  const s = await track(c, { program_id: 'f1-start', status: 'started' });
  assert.match(s.application_id ?? '', /^ek-[A-Za-z0-9_-]{12}$/);
  assert.equal(s.agent_note, "Started Start Grant. Fill the form from the fields, submit, then call track with applied, submitted_by and fields_used. If the form has a reference field, put application_id in it, so the program's result reaches these applications.");
  assert.doesNotMatch(s.show_to_builder, /application|ek-/);
  // A renewed claim keeps it; the send answers the same id.
  assert.equal((await track(c, { program_id: 'f1-start', status: 'started' })).application_id, s.application_id);
  const a = await track(c, { program_id: 'f1-start', status: 'applied' });
  assert.equal(a.application_id, s.application_id);
  // A claim refused (already sent) carries none.
  assert.equal('application_id' in (await track(c, { program_id: 'f1-start', status: 'started' })), false);
});

test('T5-F4 (v6.1.14): a send or claim in flight from an agent unlinked meanwhile never lands in the builder\'s ledger', async () => {
  const { unlinkInstallation } = await import('../v6/builders');
  const { a, c, owner } = await twoAgents();
  await upsertProgram(programFixture({ id: 'f4-send', title: 'Send Grant' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'f4-claim', title: 'Claim Grant' }), 'file', NOW);
  await track(a, { program_id: 'f4-send', status: 'started' });
  assert.equal(await unlinkInstallation(a.installationId, c.builderId!, NOW), true);
  // `a` still carries the builder id it was read with before the unlink.
  const sent = await track(a, { program_id: 'f4-send', status: 'applied', submitted_by: 'agent' });
  // L17-9 (v6.1.16): the form went out; the agent tells the builder to keep their own note.
  assert.deepEqual([sent.show_to_builder, sent.agent_note], ['This agent was just unlinked from your account; nothing recorded.',
    'This agent was unlinked before the send was saved; the form went out but EarnKit holds no record of it. Tell the builder to keep their own note.']);
  const claimed = await track(a, { program_id: 'f4-claim', status: 'started' });
  assert.equal(claimed.show_to_builder, 'This agent was just unlinked from your account; nothing recorded.');
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${owner}`)[0].n, 0);
});

test('FR-2 (v6.1.14 final fix): track reads an SSH repo link as find does and keys its step by the https repo', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'fr2-a', title: 'SSH Grant', eligibility: [{ kind: 'users' }] }), 'file', NOW);
  for (const repo_url of ['git@github.com:Acme/App.git', 'ssh://git@gitlab.com/o/r.git']) {
    const r = await track(c, { program_id: 'fr2-a', status: 'gap_done', item: 'users', project: { name: 'App', repo_url } });
    assert.equal(r.show_to_builder, 'Tracked.');
    assert.doesNotMatch(r.agent_note, /not a web link/);
  }
  const rows = await sql()`SELECT project_key FROM gaps_done WHERE owner = ${'i:' + c.installationId} AND program_id = 'fr2-a' ORDER BY project_key`;
  assert.deepEqual(rows.map((r) => r.project_key), ['https://github.com/acme/app', 'https://gitlab.com/o/r']);
});

test('FR-6 (v6.1.14 final fix): with standing approval turned off since the find, a send the builder confirmed (submitted_by builder) has the plain line, never the outside-approval clause', async () => {
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, mergeRecord } = await import('../v6/record');
  const { markFindAuto } = await import('./installations');
  const c = await ctx();
  const b = await upsertBuilder({ github_id: 930_618, login: 'fr6', name: 'B', avatar_url: null }, NOW);
  await linkInstallation(c.installationId, b.id, NOW);
  await saveRecord(b.id, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: false } }, 'builder', NOW).record, NOW);
  await upsertProgram(programFixture({ id: 'fr6-a', title: 'Confirmed Grant', category: 'grant' }), 'file', NOW);
  await markFindAuto(c.installationId, true);
  const r = await track({ ...c, builderId: b.id }, { program_id: 'fr6-a', status: 'applied', submitted_by: 'builder', project: { name: 'App' }, fields_used: ['project_name'] });
  assert.equal(r.show_to_builder, 'Sent Confirmed Grant.');
  assert.doesNotMatch(r.show_to_builder, /standing approval/);
  assert.doesNotMatch(r.agent_note, /not under standing approval/);
});

test('#8 (v6.1.15): namedFirst names the program after Tracked and Already tracked', () => {
  assert.equal(namedFirst('Tracked.', 'Alpha Grant'), 'Tracked: Alpha Grant.');
  assert.equal(namedFirst('Tracked. On to the next one.', 'Alpha Grant'), 'Tracked: Alpha Grant. On to the next one.');
  assert.equal(namedFirst('Already tracked.', 'Alpha Grant'), 'Already tracked: Alpha Grant.');
  assert.equal(namedFirst('Already skipped.', 'Alpha Grant'), 'Already skipped: Alpha Grant.');
  assert.equal(namedFirst('Started.', 'Alpha Grant'), 'Started: Alpha Grant.');
});

// L17-1 (v6.1.16, Review Focus 6): races. Parallel calls against the test database, as lane 17 ran them.
const histOf = async (owner: string, programId: string) =>
  (await sql()<{ status: string; installation_id: number; source: string | null }[]>`
    SELECT status, installation_id, source FROM application_history WHERE owner = ${owner} AND program_id = ${programId} ORDER BY id`).map((r) => ({ ...r }));

test("R6, R7 (L17-1): 30 skips by agent B over agent A's live claim record nothing and leave the claim; A then sends", async () => {
  const { a, c, owner } = await twoAgents();
  await upsertProgram(programFixture({ id: 'r6-held', title: 'Held Grant' }), 'file', NOW);
  await track(a, { program_id: 'r6-held', status: 'started' });
  const later = { ...c, now: new Date(NOW.getTime() + 3_600_000) };
  const out = await Promise.all(Array.from({ length: 30 }, () => track(later, { program_id: 'r6-held', status: 'skipped' })));
  assert.deepEqual([...new Set(out.map((r) => r.show_to_builder))], ['Your other agent is handling that one; nothing recorded.']);
  const [row] = await sql()`SELECT status, claimed_by FROM applications WHERE owner = ${owner} AND program_id = 'r6-held'`;
  assert.deepEqual({ ...row }, { status: 'started', claimed_by: a.installationId });
  const sent = await track({ ...a, now: new Date(NOW.getTime() + 2 * 3_600_000) }, { program_id: 'r6-held', status: 'applied', submitted_by: 'agent' });
  assert.equal(sent.show_to_builder, 'Sent Held Grant.');
  // A's claim and A's send only: B's skips wrote nothing.
  assert.deepEqual(await histOf(owner, 'r6-held'), [
    { status: 'started', installation_id: a.installationId, source: 'builder' },
    { status: 'applied', installation_id: a.installationId, source: 'builder' },
  ]);
});

test('R8 (L17-1): 30 parallel skips by one agent on a fresh program write one row and one Skipped reply', async () => {
  const { a, owner } = await twoAgents();
  await upsertProgram(programFixture({ id: 'r8-skip', title: 'Skip Race' }), 'file', NOW);
  const out = await Promise.all(Array.from({ length: 30 }, () => track(a, { program_id: 'r8-skip', status: 'skipped' })));
  const says = out.map((r) => r.show_to_builder);
  assert.equal(says.filter((s) => s === 'Skipped Skip Race for good. Say bring it back and I list it again.').length, 1);
  assert.equal(says.filter((s) => s === 'Already skipped.').length, 29);
  assert.deepEqual((await histOf(owner, 'r8-skip')).map((h) => h.status), ['skipped']);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${owner} AND program_id = 'r8-skip'`)[0].n, 1);
});

test('R9 (L17-1): 30 parallel skips after a send write no skip row, each answered as already sent', async () => {
  const { a, c, owner } = await twoAgents();
  await upsertProgram(programFixture({ id: 'r9-sent', title: 'Sent Race' }), 'file', NOW);
  await track(a, { program_id: 'r9-sent', status: 'applied', submitted_by: 'agent' });
  const out = await Promise.all(Array.from({ length: 30 }, (_, k) => track(k % 2 ? a : c, { program_id: 'r9-sent', status: 'skipped' })));
  assert.deepEqual([...new Set(out.map((r) => r.show_to_builder))], ['That one was already sent; nothing to skip.']);
  assert.deepEqual((await histOf(owner, 'r9-sent')).map((h) => h.status), ['applied']);
  const [row] = await sql()`SELECT status FROM applications WHERE owner = ${owner} AND program_id = 'r9-sent'`;
  assert.equal(row.status, 'applied');
});

test('R22 (L17-1): 20 parallel gap_done on one item write one history row', async () => {
  const { a, c, owner } = await twoAgents();
  await upsertProgram(programFixture({ id: 'r22-gap', title: 'Gap Race', eligibility: [{ kind: 'users' }] }), 'file', NOW);
  const out = await Promise.all(Array.from({ length: 20 }, (_, k) => track(k % 2 ? a : c, { program_id: 'r22-gap', status: 'gap_done', item: 'users' })));
  assert.equal(out.filter((r) => r.show_to_builder === 'Already tracked.').length, 19);
  assert.equal((await histOf(owner, 'r22-gap')).length, 1);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM gaps_done WHERE owner = ${owner} AND program_id = 'r22-gap'`)[0].n, 1);
});

test('R10 (L17-9): a send in flight when its agent is unlinked: the builder hears nothing recorded, the agent is told the form went out', async () => {
  const { unlinkInstallation } = await import('../v6/builders');
  const { a, c, owner } = await twoAgents();
  await upsertProgram(programFixture({ id: 'r10-unlink', title: 'Unlink Race' }), 'file', NOW);
  assert.equal(await unlinkInstallation(a.installationId, c.builderId!, NOW), true);
  const sent = await track(a, { program_id: 'r10-unlink', status: 'applied', submitted_by: 'agent' });
  assert.equal(sent.show_to_builder, 'This agent was just unlinked from your account; nothing recorded.');
  assert.equal(sent.agent_note, 'This agent was unlinked before the send was saved; the form went out but EarnKit holds no record of it. Tell the builder to keep their own note.');
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${owner} AND program_id = 'r10-unlink'`)[0].n, 0);
});

test('L25-24 (v6.1.16): track started keeps a note, cut to 280 characters, on the claim', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't25-note', title: 'Note Grant' }), 'file', NOW);
  const r = await track(c, { program_id: 't25-note', status: 'started', note: 'n'.repeat(300) });
  assert.equal(r.already_started, undefined);
  const [row] = await sql()`SELECT status, note FROM applications WHERE installation_id = ${c.installationId} AND program_id = 't25-note'`;
  assert.equal(row.status, 'started');
  assert.equal(row.note, 'n'.repeat(280));
  const [h] = await sql()`SELECT note FROM application_history WHERE installation_id = ${c.installationId} AND program_id = 't25-note' AND status = 'started'`;
  assert.equal(h.note, 'n'.repeat(280));
  // A renewed claim with no note keeps the one it has.
  await track(c, { program_id: 't25-note', status: 'started' });
  assert.equal((await sql()`SELECT note FROM applications WHERE installation_id = ${c.installationId} AND program_id = 't25-note'`)[0].note, 'n'.repeat(280));
});

test('L22-2, L22-3, L22-7, L25-13 (v6.1.16): track takes amount and currency; a win with no currency keeps the win\'s own; cents kept', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't22-eur', title: 'Euro Grant', max_award_usd: 100_000 }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't22-cents', title: 'Cents Grant', max_award_usd: 100_000 }), 'file', NOW);
  const say = async (input: Record<string, unknown>) => (await track(c, input)).show_to_builder;
  for (const id of ['t22-eur', 't22-cents']) await say({ program_id: id, status: 'applied' });
  assert.equal(await say({ program_id: 't22-eur', status: 'won', amount: 2000, currency: 'EUR' }), 'Tracked: EUR 2,000 from Euro Grant.');
  assert.equal(await say({ program_id: 't22-eur', status: 'rejected' }), 'Tracked. On to the next one.');
  assert.equal(await say({ program_id: 't22-eur', status: 'won', amount: '€2,000' }), 'Tracked: EUR 2,000 from Euro Grant.');
  assert.equal(await say({ program_id: 't22-eur', status: 'no_result' }), 'That one already has a result here: won EUR 2,000.');
  // No currency named over a win held in EUR: EUR is assumed, a correction and a further payment alike.
  assert.equal(await say({ program_id: 't22-eur', status: 'won', amount: 2500 }), 'Tracked: EUR 2,500 from Euro Grant. Replaced the earlier amount.');
  assert.equal(await say({ program_id: 't22-eur', status: 'won', amount: 500, payment: { key: 'p2' } }), 'Tracked: EUR 500 more from Euro Grant, EUR 3,000 in total.');
  // Named dollars keep both currencies, never replacing (L22-3).
  assert.equal(await say({ program_id: 't22-eur', status: 'won', amount_usd: 1000, payment: { key: 'p3' } }), 'Tracked: $1,000 more from Euro Grant, $1,000 and EUR 3,000 in total.');
  const r = await track(c, { program_id: 't22-cents', status: 'won', amount_usd: 1234.56 });
  assert.equal(r.show_to_builder, 'Tracked: $1,234.56 from Cents Grant.');
  assert.deepEqual([r.ledger.won_usd, r.ledger.won_other], [2234.56, [{ currency: 'EUR', amount: 3000 }]]);
  const [row] = await sql()`SELECT amount_usd, amounts FROM applications WHERE installation_id = ${c.installationId} AND program_id = 't22-cents'`;
  assert.deepEqual([Number(row.amount_usd), row.amounts], [1234.56, { USD: 1234.56 }]);
  const h = await sql()`SELECT amount, currency FROM application_history WHERE installation_id = ${c.installationId} AND program_id = 't22-eur' AND status = 'won' ORDER BY at, amount`;
  assert.deepEqual(h.map((x) => `${Number(x.amount)} ${x.currency}`).sort(), ['1000 USD', '2000 EUR', '2000 EUR', '2500 EUR', '500 EUR']);
  // L22-6: a dot-thousands amount has its own line; an unreadable one the unread line.
  assert.equal(await say({ program_id: 't22-cents', status: 'won', amount: '5.000' }), 'Amount not read: use a dot only for cents, no thousands separator.');
  assert.equal(await say({ program_id: 't22-cents', status: 'won', amount: 'lots' }), 'Tell me the amount as a number, like 5000 for $5,000.');
});

test('L25-13 (v6.1.16): the track description says amount_usd may carry cents', async () => {
  const { TRACK_DESCRIPTION } = await import('./tool-text');
  assert.match(TRACK_DESCRIPTION, /amount_usd may carry cents/);
});

test('L31-4 (v6.1.16 Task 17): a fullwidth program id is read as the real one, named in the reply and the problems line', async () => {
  const c = await ctx();
  const title = (await sql()<{ t: string }[]>`SELECT file->>'title' AS t FROM programs WHERE id = 'base-builder-grants'`)[0].t;
  const r = await track(c, { program_id: 'ｂａｓｅ-ｂｕｉｌｄｅｒ-ｇｒａｎｔｓ', status: 'skipped' });
  assert.ok(r.show_to_builder.includes(title), r.show_to_builder);
  assert.match(r.agent_note, /Some arguments were not read: program id read as base-builder-grants\./);
  // An ASCII id gets no problems line.
  const plain = await track(await ctx(), { program_id: 'base-builder-grants', status: 'skipped' });
  assert.doesNotMatch(plain.agent_note, /program id read as/);
});

test('L31-5 (v6.1.16 Task 17, ruling 43): one bad-amount line on track; the dot-thousands form keeps its own', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 't17-amt', title: 'Amount Grant', max_award_usd: 9000 }), 'file', NOW);
  await track(c, { program_id: 't17-amt', status: 'applied' });
  const UNREAD = 'Tell me the amount as a number, like 5000 for $5,000.';
  for (const [args, line] of [
    [{ amount: 'abc' }, UNREAD], [{ amount: '2,500.50.1' }, UNREAD], [{ amount_usd: -500 }, UNREAD], [{ amount_usd: '5,000' }, UNREAD],
    [{ amount: '5.000' }, 'Amount not read: use a dot only for cents, no thousands separator.'],
  ] as [Record<string, unknown>, string][]) {
    const r = await track(c, { program_id: 't17-amt', status: 'won', ...args });
    assert.equal(r.show_to_builder, line, JSON.stringify(args));
  }
  // Anything else unread keeps the general line.
  assert.equal((await track(c, { program_id: 't17-amt', status: 'won!' })).show_to_builder, '');
});

// v6.1.16 Task 11 (lane 24).

test('L24-3: next, build, start and first name no program on any status; nothing is written', async () => {
  const c = await ctx();
  for (const word of ['next', 'build', 'start', 'first'])
    for (const status of ['applied', 'won', 'rejected', 'started']) {
      const r = await track(c, { program_id: word, status, ...(status === 'won' ? { amount_usd: 100 } : {}), project: { name: 'Neutral Tool' } });
      assert.equal(r.show_to_builder, 'Which program do you mean?', `${word} ${status}`);
    }
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE installation_id = ${c.installationId}`)[0].n, 0);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM application_history WHERE installation_id = ${c.installationId}`)[0].n, 0);
});

test('L24-3: PayPal, the id and an exact title still resolve', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'l24t-second', title: 'Second Grant' }), 'file', NOW);
  assert.match((await track(c, { program_id: 'PayPal', status: 'skipped' })).show_to_builder, /^Skipped PayPal AI Hackathon/);
  assert.equal((await track(c, { program_id: 'paypal-ai-hackathon', status: 'unskip' })).show_to_builder.startsWith('Unskipped PayPal'), true);
  assert.equal((await track(c, { program_id: 'Second Grant', status: 'started' })).show_to_builder, '');
});

test('L24-27: the started line names the program; the 24 hours are in the agent note only, linked', async () => {
  const { a } = await twoAgents();
  await upsertProgram(programFixture({ id: 'l24t-start', title: 'Start Line Grant' }), 'file', NOW);
  const r = await track(a, { program_id: 'l24t-start', status: 'started' });
  assert.equal(r.show_to_builder, '');
  assert.ok(r.agent_note.includes('Other agents of this builder leave it alone for 24 hours.'));
  assert.doesNotMatch(r.show_to_builder, /24 hours/);
});

test('L24-4: held keeps the claim, started lifts it, and a send on a held program is recorded with the note', async () => {
  const { a, c, owner } = await twoAgents();
  await upsertProgram(programFixture({ id: 'l24t-hold', title: 'Hold Grant' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'l24t-hold2', title: 'Hold Two' }), 'file', NOW);
  await track(a, { program_id: 'l24t-hold', status: 'started' });
  const held = await track(c, { program_id: 'l24t-hold', status: 'held' });
  assert.equal(held.show_to_builder, 'Held Hold Grant. Say go when you want it sent.');
  assert.equal(held.agent_note, 'Held: do not send it. When the builder says go, call track started and then send.');
  const row = async (id: string) => (await sql()`SELECT status, held_at, claimed_by FROM applications WHERE owner = ${owner} AND program_id = ${id}`)[0];
  assert.equal((await row('l24t-hold')).status, 'started');
  assert.ok((await row('l24t-hold')).held_at);
  // A started from any installation lifts it and takes the claim.
  const go = await track(c, { program_id: 'l24t-hold', status: 'started' });
  assert.equal(go.show_to_builder, '');
  assert.equal((await row('l24t-hold')).held_at, null);
  assert.equal((await row('l24t-hold')).claimed_by, c.installationId);
  // Held with no claim yet: a held claim; the send on it is recorded (L23-3), the agent told.
  await track(a, { program_id: 'l24t-hold2', status: 'held' });
  const sent = await track(a, { program_id: 'l24t-hold2', status: 'applied', submitted_by: 'agent' });
  assert.equal(sent.agent_note, 'The builder held this one; tell them it went out.');
  assert.equal((await row('l24t-hold2')).status, 'applied');
  assert.equal((await row('l24t-hold2')).held_at, null);
  // A held claim is never released as stale.
  await upsertProgram(programFixture({ id: 'l24t-hold3', title: 'Hold Three' }), 'file', NOW);
  await track(a, { program_id: 'l24t-hold3', status: 'held' });
  const { releaseStale } = await import('../v6/claims');
  await releaseStale(owner, new Date(NOW.getTime() + 3 * 86_400_000));
  assert.equal((await row('l24t-hold3')).status, 'started');
  // Nothing to hold once sent.
  assert.equal((await track(a, { program_id: 'l24t-hold2', status: 'held' })).show_to_builder, 'That one was already sent; nothing to hold.');
});

test('L24-17: gap_done with no item on a rule program asks which rule; the note names the rule item', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'l24t-rule', title: 'Rule Only Grant', eligibility: [{ kind: 'rule', note: 'a first-time founder' }] }), 'file', NOW);
  const r = await track(c, { program_id: 'l24t-rule', status: 'gap_done' });
  assert.equal(r.show_to_builder, 'Which rule fits you? Say the program.');
  assert.match(r.agent_note, /^The rule item is rule:[0-9a-f]{8}\./);
  await upsertProgram(programFixture({ id: 'l24t-change', title: 'Change Grant', eligibility: [{ kind: 'live_product' }] }), 'file', NOW);
  assert.equal((await track(c, { program_id: 'l24t-change', status: 'gap_done' })).show_to_builder, 'Which change did you finish? Say the program and the change.');
});

test('L24-1: another agent named in a track line goes through quoteName', async () => {
  const { a, c } = await twoAgents('Evil\u202e Name "quoted" and a very long tail of words');
  await upsertProgram(programFixture({ id: 'l24t-q', title: 'Quote Grant' }), 'file', NOW);
  await track(a, { program_id: 'l24t-q', status: 'started' });
  const r = await track(c, { program_id: 'l24t-q', status: 'started' });
  assert.equal(r.show_to_builder, `Quote Grant is already being handled since 12:00 UTC by "Evil Name 'quoted' and a very long tail".`);
});

// v6.1.16 Task 15 (lane 29).

test('L29-3: a win on a program with no application records the builder\'s own send and the win in one call', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'l293-pp', title: 'PayPal Like Hackathon', max_award_usd: 10000 }), 'file', NOW);
  const r = await track(c, { program_id: 'l293-pp', status: 'won', amount: '5k' });
  assert.equal(r.show_to_builder, 'Recorded: PayPal Like Hackathon won, $5,000. Noted as sent by you outside EarnKit.');
  assert.equal(r.refused, undefined);
  const [row] = await sql()`SELECT status, amount_usd, submitted_by, sent_at FROM applications WHERE installation_id = ${c.installationId} AND program_id = 'l293-pp'`;
  assert.deepEqual([row.status, Number(row.amount_usd), row.submitted_by], ['won', 5000, 'builder']);
  assert.ok(row.sent_at);
  const hist = await sql()`SELECT status FROM application_history WHERE installation_id = ${c.installationId} AND program_id = 'l293-pp' ORDER BY id`;
  assert.deepEqual(hist.map((h) => h.status), ['applied', 'won']);
  assert.equal(r.ledger.won, 1);
  // A rejection with no application is still refused (only a win is noted as the builder's own).
  await upsertProgram(programFixture({ id: 'l293-no', title: 'No App Grant' }), 'file', NOW);
  const no = await track(c, { program_id: 'l293-no', status: 'rejected' });
  assert.equal(no.refused, true);
  assert.equal(no.show_to_builder, "You haven't applied to that one here.");
  // The amount schema reads dollars as a number.
  const { TrackInput } = await import('./track');
  assert.equal(TrackInput.shape.amount_usd.description, 'dollars as a number (5000 or 1234.56)');
});

test('L29-15, L29-21, L29-23, L29-32: a list number, any case, agent by default; applied names the send', async () => {
  const c = await ctx();
  await upsertProgram(programFixture({ id: 'l2915-a', title: 'Number One Grant' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'l2915-b', title: 'Number Two Grant' }), 'file', NOW);
  const { markList, lastListIds } = await import('./installations');
  await markList(c.installationId, 'h', NOW, ['l2915-a', 'l2915-b']);
  assert.deepEqual(await lastListIds(c.installationId), ['l2915-a', 'l2915-b']);
  const r = await track(c, { program_id: '2', status: 'Applied' });
  assert.equal(r.show_to_builder, 'Sent Number Two Grant.');
  assert.match(r.agent_note, /^Matched list number 2 to l2915-b\. /);
  assert.match(r.agent_note, /Pass fields_used next time; nothing was checked against your record\./);
  const [row] = await sql()`SELECT submitted_by FROM applications WHERE installation_id = ${c.installationId} AND program_id = 'l2915-b'`;
  assert.equal(row.submitted_by, 'agent');
  // A number past the list asks which; started has no builder text, its note names it.
  const far = await track(c, { program_id: '9', status: 'started' });
  assert.equal(far.show_to_builder, 'Which program do you mean?');
  const s = await track(c, { program_id: '1', status: 'STARTED', submitted_by: 'Agent' });
  assert.equal(s.show_to_builder, '');
  assert.match(s.agent_note, /^Matched list number 1 to l2915-a\. Started Number One Grant\. /);
});
