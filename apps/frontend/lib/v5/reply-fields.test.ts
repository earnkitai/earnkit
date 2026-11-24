/**
 * v3.8 E13 (plan 23.6, 23.7): with `reply_fields` on, every tool reply has `status` and `state`, and errors that were
 * one plain line are the same JSON shape; off, every reply is what it was on main, byte for byte.
 */
import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall, type McpResult } from './fixtures/mcp-call';
import { BUSY, BUSY_NOTE, LIMIT_NOTE } from './mcp';
import { REPLY_STATES, REPLY_STATUSES, replyFieldsOf } from './reply-fields';
import { windowStart } from './rate-limit';
import { answerParams, answerUnreadable } from './tool-input';
import { answerOldTools, OLD_TOOL_TEXT } from './old-tools';

after(() => sql().end());
afterEach(() => {
  delete process.env.EARNKIT_FLAGS;
});

const NOW = new Date('2026-11-04T12:00:00Z');
const P = { name: 'X', description: 'An app.' };
async function ctx() {
  const [r] = await sql()`INSERT INTO installations (token_hash) VALUES (${'rf-' + Math.random()}) RETURNING id`;
  return { installationId: r.id as number, builderId: null, now: NOW, gh: (async () => new Response('', { status: 404 })) as typeof fetch, linkUrl: async () => 'https://earnkit.com/link/x' };
}

/** One call of each kind a host can make: every tool, its refusals, input errors and an unknown program. */
const CALLS: [string, Record<string, unknown>][] = [
  ['find', { project: P }],
  ['find', {}],
  ['find', { program_id: 'base-builder-grants', project: P }],
  ['find', { program_id: 'no-such-program-at-all' }],
  ['find', { project: P, filter: { all: 'true' } }],
  ['track', { program_id: 'no-such', status: 'skipped' }],
  ['track', {}],
  ['track', { program_id: 5, status: 'maybe', amount_usd: 'lots' }],
  ['track', { program_id: 'base-builder-grants', status: 'started', project: P }],
  ['track', { program_id: 'base-builder-grants', status: 'skipped', project: P }],
  ['track', { program_id: 'base-builder-grants', status: 'skipped', project: P }],
  ['record', { get: true }],
  ['record', { set: { person: { name: 'A' } } }],
  ['record', {}],
  ['screen', {}],
  ['screen', { program_id: 'base-builder-grants', applicants: [{ ref: 'a' }] }],
  ['screen', { job_id: 'nope' }],
];

async function runAll(): Promise<McpResult[]> {
  const c = await ctx();
  const out: McpResult[] = [];
  for (const [name, args] of CALLS) out.push(await mcpCall(c, name, args));
  return out;
}

const hasFields = (r: McpResult) => {
  assert.ok(r.reply, `not JSON: ${r.text}`);
  assert.ok((REPLY_STATUSES as readonly string[]).includes(r.reply.status as string), r.text);
  assert.ok((REPLY_STATES as readonly string[]).includes(r.reply.state as string), r.text);
  assert.equal(typeof r.reply.show_to_builder, 'string', r.text);
  assert.equal(typeof r.reply.agent_note, 'string', r.text);
};

test('reply_fields on: every tool reply has status and state; a refusal is refused and unchanged', async () => {
  process.env.EARNKIT_FLAGS = 'reply_fields';
  const rs = await runAll();
  rs.forEach(hasFields);
  for (const r of rs) if (r.isError) assert.ok(['refused', 'error'].includes(r.reply!.status as string), r.text);
  // track {}: an input error.
  assert.deepEqual([rs[6].reply!.status, rs[6].reply!.state], ['refused', 'unchanged']);
});

test('reply_fields off: replies are the same as on, less the two keys, and neither key appears', async () => {
  const off = await runAll();
  for (const r of off) assert.ok(!r.reply || (!('status' in r.reply) && !('state' in r.reply)), r.text);
  process.env.EARNKIT_FLAGS = 'reply_fields';
  const on = await runAll();
  // Same calls on a fresh installation: each reply is the flag-off reply plus status and state, last in key order.
  // The started call's application_id is new on each run, and find's ids, so compare with those taken out.
  const strip = (v: Record<string, unknown> | null) => JSON.parse(JSON.stringify(v ?? {}).replace(/"application_id":"[^"]*"/g, '"application_id":""'));
  on.forEach((r, i) => {
    const { status, state, ...rest } = r.reply!;
    assert.ok(status && state);
    assert.deepEqual(Object.keys(r.reply!).slice(-2), ['status', 'state'], r.text);
    if (off[i].reply) assert.deepEqual(strip(rest), strip(off[i].reply), CALLS[i][0]);
    assert.equal(r.isError, off[i].isError);
  });
});

test('reply_fields on: busy is JSON, status error, the busy line and a retry note; off it is the one line', async () => {
  const c = { installationId: 2 ** 40, builderId: null, now: NOW };
  const off = await mcpCall(c, 'find', { project: P });
  assert.equal(off.text, BUSY);
  process.env.EARNKIT_FLAGS = 'reply_fields';
  const on = await mcpCall(c, 'find', { project: P });
  assert.equal(on.isError, true);
  assert.deepEqual(on.reply, { show_to_builder: BUSY, agent_note: BUSY_NOTE, status: 'error', state: 'unchanged' });
});

test('reply_fields on: the rate limit is JSON with retry_after_seconds, status refused', async () => {
  process.env.EARNKIT_FLAGS = 'reply_fields';
  const c = await ctx();
  await sql()`INSERT INTO rate_windows (key, window_start, count) VALUES (${`mcp:${c.installationId}`}, ${windowStart(NOW, 3_600_000)}, ${120})`;
  const r = await mcpCall(c, 'track', { program_id: 'no-such', status: 'skipped' });
  assert.equal(r.isError, true);
  assert.deepEqual(r.reply, {
    show_to_builder: "Your agent has used this hour's limit. Try again in about 60 minutes.", agent_note: LIMIT_NOTE,
    retry_after_seconds: 3_600, status: 'refused', state: 'unchanged',
  });
  assert.deepEqual(r.structured, { retry_after_seconds: 3_600 });
});

test('reply_fields on: the route-level answers (too deep, not an object, unknown tool, old tool) are JSON with the fields', () => {
  const deep: Record<string, unknown> = {};
  let cur = deep;
  for (let i = 0; i < 40; i++) cur = (cur.a = {}) as Record<string, unknown>;
  const body = [
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'find', arguments: deep } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'find', arguments: 7 } },
  ];
  const text = (a: unknown) => (a as { result: { content: { text: string }[] } }).result.content[0].text;
  const offTexts = answerUnreadable(body, 20).answers.map(text);
  const offTool = text(answerParams({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope' } }).answers[0]);
  assert.equal(text(answerOldTools({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'score' } }).answers[0]), OLD_TOOL_TEXT);
  process.env.EARNKIT_FLAGS = 'reply_fields';
  const onTexts = answerUnreadable(body, 20).answers.map(text);
  onTexts.forEach((t, i) => {
    const { status, state, ...rest } = JSON.parse(t);
    assert.deepEqual([status, state], ['refused', 'unchanged']);
    assert.deepEqual(rest, JSON.parse(offTexts[i]));
  });
  const tool = JSON.parse(text(answerParams({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope' } }).answers[0]));
  assert.deepEqual([tool.show_to_builder, tool.agent_note], ['', offTool]);
  assert.deepEqual([tool.status, tool.state], ['refused', 'unchanged']);
  const old = JSON.parse(text(answerOldTools({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'score' } }).answers[0]));
  assert.deepEqual(old, { show_to_builder: '', agent_note: OLD_TOOL_TEXT, status: 'refused', state: 'unchanged' });
});

test('replyFieldsOf: track states follow the status sent, and a next program is a question for the builder', () => {
  const t = (status: string, reply: Record<string, unknown> = {}) => replyFieldsOf('track', { show_to_builder: 'x', agent_note: '', ...reply }, { status });
  assert.deepEqual(t('applied'), { status: 'ok', state: 'sent' });
  assert.deepEqual(t('applied', { next: { program_id: 'a' } }), { status: 'needs_builder', state: 'sent' });
  assert.deepEqual(t('won'), { status: 'ok', state: 'won' });
  assert.deepEqual(t('held'), { status: 'ok', state: 'on_hold' });
  assert.deepEqual(t('no_result'), { status: 'ok', state: 'waiting' });
  assert.deepEqual(t('won', { refused: true }), { status: 'refused', state: 'unchanged' });
  assert.deepEqual(replyFieldsOf('track', {}, { action: 'list' }), { status: 'ok', state: 'listed' });
  assert.deepEqual(replyFieldsOf('find', { linked: false, sign_in: 'https://x', ready: [], gaps: [] }, {}), { status: 'needs_builder', state: 'not_signed_in' });
  assert.deepEqual(replyFieldsOf('find', { linked: true, ready: [{}], gaps: [] }, {}), { status: 'needs_builder', state: 'ready' });
  assert.deepEqual(replyFieldsOf('find', { linked: true, ready: [], gaps: [], ask_outcome: [] }, {}), { status: 'ok', state: 'nothing_ready' });
  assert.deepEqual(replyFieldsOf('screen', { job_id: 'j' }, {}), { status: 'ok', state: 'screening' });
});
