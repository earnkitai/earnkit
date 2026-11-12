/**
 * L29-9, L29-10 (v6.1.16 Task 15, Review Focus 21): every refusal, driven through POST /mcp, is a tool result with
 * isError true and its usual text; HTTP stays 200. Input errors carry no builder text and say what to fix.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { saveInstallation } from './installations';
import { upsertProgram } from './programs';
import { programFixture } from './fixtures/program';
import { LIMITS, windowStart } from './rate-limit';
import { ruleItem } from './eligibility';
import { POST } from '../../app/mcp/route';
import { linkInstallation, saveRecord, upsertBuilder } from '../v6/builders';
import { EMPTY_RECORD, mergeRecord } from '../v6/record';
import { addReviewer } from '../v6/reviewers';
import { createJob } from '../v6/screen-jobs';

after(() => sql().end());

const NOW = new Date();
type Msg = { result: { isError?: boolean; content: { text: string }[] } };
type Reply = { show_to_builder: string; agent_note: string; refused?: true };

/** A fresh installation and a call through the route: the HTTP status, isError, and the reply (null when not JSON). */
async function agent() {
  const token = 'ek_refusal_' + Math.random().toString(36).slice(2);
  const id = await saveInstallation(token, 'Refusal Agent');
  let n = 0;
  const call = async (name: string, args: unknown) => {
    const r = await POST(new Request('https://earnkit.test/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }),
    }));
    const m = (await r.json()) as Msg;
    const text = m.result.content[0].text;
    let reply: Reply | null = null;
    try {
      reply = JSON.parse(text) as Reply;
    } catch {
      reply = null;
    }
    return { status: r.status, isError: m.result.isError === true, text, reply };
  };
  return { id, call };
}

let gh = 990_500;
async function linked() {
  const a = await agent();
  const b = await upsertBuilder({ github_id: ++gh, login: 'refuse' + gh, name: 'Refuse', avatar_url: null }, NOW);
  await linkInstallation(a.id, b.id, NOW);
  return { ...a, builderId: b.id, login: b.login };
}

/** The refusal: HTTP 200, isError true, its usual builder text (`show`, a string or a pattern), refused in the JSON. */
function refused(r: Awaited<ReturnType<Awaited<ReturnType<typeof agent>>['call']>>, show: string | RegExp) {
  assert.equal(r.status, 200, r.text);
  assert.equal(r.isError, true, r.text);
  assert.ok(r.reply, r.text);
  if (typeof show === 'string') assert.equal(r.reply.show_to_builder, show);
  else assert.match(r.reply.show_to_builder, show);
  assert.equal(r.reply.refused, true);
}

const p = (id: string, over: Record<string, unknown> = {}) => upsertProgram(programFixture({ id, title: id, ...over }), 'file', NOW);

test('track and find: an unknown program and a common word ask which; nothing is written', async () => {
  const a = await agent();
  refused(await a.call('track', { program_id: 'zz-no-such-thing', status: 'applied' }), 'Which program do you mean?');
  refused(await a.call('track', { program_id: 'next', status: 'started' }), 'Which program do you mean?');
  const r = await a.call('track', { program_id: 'zz-no-such-thing', status: 'applied' });
  assert.equal(r.reply!.agent_note, 'Nothing was recorded. program_id takes the id or the name; a list number maps to the id in the JSON.');
  refused(await a.call('find', { program_id: 'zz-no-such-thing' }), 'Which program do you mean?');
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE installation_id = ${a.id}`)[0].n, 0);
});

test('track: already sent, both forms; the in-person send; the unconfirmed rule; held over a send', async () => {
  const a = await agent();
  await p('rf-sent');
  const sent = await a.call('track', { program_id: 'rf-sent', status: 'applied', submitted_by: 'builder' });
  assert.equal(sent.isError, false, sent.text);
  assert.equal(sent.reply!.show_to_builder, 'Sent rf-sent.');
  refused(await a.call('track', { program_id: 'rf-sent', status: 'started' }), 'rf-sent was already sent.');
  refused(await a.call('track', { program_id: 'rf-sent', status: 'applied', submitted_by: 'builder' }), /^Already sent on [^.]+\.$/);
  refused(await a.call('track', { program_id: 'rf-sent', status: 'held' }), 'That one was already sent; nothing to hold.');
  // L29-7: an agent's send on an in-person program.
  await p('rf-room', { in_person: true, title: 'Room Summit' });
  refused(await a.call('track', { program_id: 'rf-room', status: 'applied' }), 'Room Summit is applied for in person; nothing to send.');
  // L29-8: a rule not confirmed for the last find's project, with no project passed.
  await p('rf-rule', { eligibility: [{ kind: 'rule', note: 'a team of two or more' }] });
  await a.call('find', { project: { name: 'Rule App', description: 'An app.' } });
  refused(await a.call('track', { program_id: 'rf-rule', status: 'started' }), 'Confirm the rule first: a team of two or more. Say yes if that is you.');
  refused(await a.call('track', { program_id: 'rf-rule', status: 'applied', fields_used: ['project_name'] }), 'Confirm the rule first: a team of two or more. Say yes if that is you.');
  const rows = await sql()`SELECT program_id FROM applications WHERE installation_id = ${a.id} AND program_id IN ('rf-room', 'rf-rule')`;
  assert.equal(rows.length, 0);
  // Confirmed, the same send goes through.
  const done = await a.call('track', { program_id: 'rf-rule', status: 'gap_done', item: ruleItem('a team of two or more') });
  assert.equal(done.isError, false, done.text);
  const ok = await a.call('track', { program_id: 'rf-rule', status: 'applied', fields_used: ['project_name'] });
  assert.equal(ok.isError, false, ok.text);
  assert.equal(ok.reply!.show_to_builder, 'Sent rf-rule.');
});

test('track: a send outside the standing approval is recorded and answered isError, its text unchanged', async () => {
  const a = await linked();
  await saveRecord(a.builderId, mergeRecord(EMPTY_RECORD, { policy: { auto_apply: true, max_per_night: 5, categories: ['grant'] } }, 'builder', NOW).record, NOW);
  await p('rf-bounty', { category: 'bounty' });
  const r = await a.call('track', { program_id: 'rf-bounty', status: 'applied', submitted_by: 'agent', fields_used: ['project_name'] });
  refused(r, 'Sent, but outside your standing approval: bounties are not in your categories.');
  assert.match(r.reply!.agent_note, /^Recorded as applied, not under standing approval\./);
});

test('record: a policy set, linked and unlinked; an unlinked set; input errors with no builder text', async () => {
  const l = await linked();
  refused(await l.call('record', { set: { policy: { auto_apply: false } } }), 'Standing approval is yours to turn off at earnkit.com/me. Until then say stop for a program and I hold it.');
  const u = await agent();
  refused(await u.call('record', { set: { policy: { auto_apply: false } } }), 'There is no standing approval on this agent.');
  refused(await u.call('record', { set: { person: { name: 'Ada' } } }), "I can't save that yet, so I keep it for this chat.");
  const bad = await l.call('record', { approve: 'answers.problem' });
  refused(bad, '');
  assert.match(bad.reply!.agent_note, /; fix it and call again\.$/);
  // An unlinked get is no refusal: it says what signing in does.
  const get = await u.call('record', { get: true });
  assert.equal(get.isError, false, get.text);
  assert.equal(get.reply!.show_to_builder, 'Sign in once and I remember you.');
});

test('unreadable input on every tool: isError, no builder text, the fix in the note', async () => {
  const a = await agent();
  for (const [tool, args] of [['track', { program_id: 'x', status: 'Submitted!' }], ['track', {}], ['screen', { applicants: 'x' }], ['track', [1, 2]]] as const) {
    const r = await a.call(tool, args);
    refused(r, '');
    assert.match(r.reply!.agent_note, /; fix it and call again\.$/, `${tool} ${JSON.stringify(args)}`);
  }
  // L29-21: any case reads; L29-23: submitted_by defaults to agent and a missing fields_used is said.
  await p('rf-case');
  const ok = await a.call('track', { program_id: 'rf-case', status: 'APPLIED' });
  assert.equal(ok.isError, false, ok.text);
  assert.match(ok.reply!.agent_note, /Pass fields_used next time; nothing was checked against your record\./);
  const [row] = await sql()`SELECT submitted_by FROM applications WHERE installation_id = ${a.id} AND program_id = 'rf-case'`;
  assert.equal(row.submitted_by, 'agent');
});

test('the limit: over the installation\'s hour, every tool answers isError', async () => {
  const a = await agent();
  await sql()`INSERT INTO rate_windows (key, window_start, count) VALUES (${`mcp:${a.id}`}, ${windowStart(new Date(), LIMITS.mcp.windowSeconds * 1000)}, ${LIMITS.mcp.limit})`;
  const r = await a.call('find', {});
  assert.equal(r.status, 200);
  assert.equal(r.isError, true, r.text);
});

test('screen: unlinked, a builder who reviews nothing, a program not theirs, no such screen, and an expired one', async () => {
  const u = await agent();
  refused(await u.call('screen', { applicants: [{ ref: 'a1' }] }), 'Screening is for program reviewers.');
  const l = await linked();
  refused(await l.call('screen', { applicants: [{ ref: 'a1' }] }), 'You review no program yet. Ask for reviewer access through the X link on earnkit.com/docs.');
  await p('rf-screen');
  await p('rf-other');
  await addReviewer('rf-screen', l.login, null);
  refused(await l.call('screen', { program_id: 'rf-other', applicants: [{ ref: 'a1' }] }), 'Screening is for program reviewers, and you do not review that program. Ask for reviewer access through the X link on earnkit.com/docs.');
  refused(await l.call('screen', { job_id: 'no-such-job' }), "I don't have that screen.");
  const job = await createJob({ programId: 'rf-screen', builderId: l.builderId, installationId: l.id, applicants: [{ ref: 'a1', name: 'A' }] as never, now: NOW });
  await sql()`UPDATE screen_jobs SET expires_at = ${new Date(Date.now() - 86_400_000)} WHERE id = ${job.id}`;
  refused(await l.call('screen', { job_id: job.id }), 'That screen has expired; queue the list again.');
});

test('a reply that is no refusal stays isError false', async () => {
  const a = await agent();
  const f = await a.call('find', { project: { name: 'Plain App', description: 'An app.' } });
  assert.equal(f.isError, false, f.text);
  assert.equal(f.reply!.refused, undefined);
});
