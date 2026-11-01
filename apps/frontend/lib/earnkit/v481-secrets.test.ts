import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { KEY_REMOVED, SCRUB_LINE, scrubSecrets, scrubToolCalls, withScrubNote, withScrubNotes } from './secrets';

// v4.8.1 Task 4 (R6). Every key here is built by concatenation, so no committed string looks like a live key.
const A = 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ';
const KEYS: Record<string, string> = {
  stripeSecret: 'sk_' + 'live_' + A.slice(0, 24),
  stripeRestricted: 'rk_' + 'live_' + 'x'.repeat(24),
  stripeTest: 'sk_' + 'test_' + A.slice(0, 10),
  stripePublishable: 'pk_' + 'live_' + A.slice(0, 12),
  webhook: 'wh' + 'sec_' + A.slice(0, 20),
  githubOauth: 'gh' + 'o_' + A.slice(0, 32),
  githubPat: 'gh' + 'p_' + A.slice(0, 36),
  githubFine: 'github_' + 'pat_' + A + '_' + A,
  anthropic: 'sk-' + 'ant-' + 'api03-' + A,
  openai: 'sk-' + (A + A).slice(0, 48),
  openaiProject: 'sk-' + 'proj-' + A + '_' + A.slice(0, 10) + '-T3BlbkFJ',
  aws: 'AK' + 'IA' + 'ABCDEFGHIJ234567',
  pem: '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK' + A + '\n-----END RSA PRIVATE KEY-----',
};

for (const [name, key] of Object.entries(KEYS)) {
  test(`T4.1 ${name} is caught inside a sentence`, () => {
    const r = scrubSecrets(`here is my key ${key} thanks`);
    assert.equal(r.removed, 1);
    assert.equal(r.value, `here is my key ${KEY_REMOVED} thanks`);
  });
}

test('T4.2 a tx hash, a wallet and a GitHub link are untouched', () => {
  const tx = '0x' + 'ab12'.repeat(16);
  const hex64 = 'cd34'.repeat(16);
  const text = `tx ${tx} raw ${hex64} wallet 0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3 repo https://github.com/lee/TipJar and github.com/ghost_user/gho-repo`;
  const r = scrubSecrets(text);
  assert.equal(r.removed, 0);
  assert.equal(r.value, text);
});

test('T4.2b a repo or word starting sk- is untouched; real OpenAI shapes are still caught', () => {
  for (const text of ['https://github.com/lee/sk-learn-tutorial-for-beginners', 'github.com/lee/sk-learn-tutorial-for-beginners', 'sk-learn', 'I use sk-learn daily']) {
    assert.deepEqual(scrubSecrets(text), { value: text, removed: 0 });
  }
  assert.equal(KEYS.openai.length, 51);
  assert.equal(scrubSecrets(`legacy ${KEYS.openai}`).removed, 1);
  assert.equal(scrubSecrets(`project ${KEYS.openaiProject}`).removed, 1);
  assert.equal(scrubSecrets(KEYS.anthropic).removed, 1);
});

test('T4.3 nested arrays and objects are scrubbed, and removed counts every match', () => {
  const input = {
    a: 'plain',
    b: [`one ${KEYS.stripeRestricted}`, { c: `${KEYS.githubPat} and ${KEYS.aws}` }],
    d: { e: { f: [KEYS.openai, 42, null, true] } },
  };
  const r = scrubSecrets(input);
  assert.equal(r.removed, 4);
  assert.deepEqual(r.value, {
    a: 'plain',
    b: [`one ${KEY_REMOVED}`, { c: `${KEY_REMOVED} and ${KEY_REMOVED}` }],
    d: { e: { f: [KEY_REMOVED, 42, null, true] } },
  });
  assert.ok(!JSON.stringify(r.value).includes('live_'));
});

test('T4.4 an Anthropic key counts once (the OpenAI pattern never sees it again)', () => {
  assert.equal(scrubSecrets(KEYS.anthropic).removed, 1);
});

test('T4.5 only tools/call arguments are scrubbed, in single and batch bodies; ids are kept', () => {
  const call = { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'tell', arguments: { note: KEYS.stripeSecret } } };
  const other = { jsonrpc: '2.0', id: 8, method: 'ping', params: { x: KEYS.stripeSecret } };
  const clean = { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'find', arguments: { q: 'hi' } } };
  const single = scrubToolCalls(call);
  assert.equal(single.removed, 1);
  assert.deepEqual([...single.ids], [7]);
  assert.equal((single.body as typeof call).params.arguments.note, KEY_REMOVED);
  const batch = scrubToolCalls([call, other, clean]);
  assert.equal(batch.removed, 1);
  assert.deepEqual([...batch.ids], [7]);
  const out = batch.body as unknown[];
  assert.equal(out[1], other);
  assert.equal(out[2], clean);
  const none = scrubToolCalls([other, clean]);
  assert.equal(none.removed, 0);
  assert.equal(none.ids.size, 0);
});

test('T4.6 the reply note: JSON text gets scrub_note first; other text is prefixed with a blank line', () => {
  const ok = withScrubNote({ id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ show_to_builder: 'Hi' }) }] } }) as {
    result: { content: { text: string }[] };
  };
  const parsed = JSON.parse(ok.result.content[0].text);
  assert.equal(Object.keys(parsed)[0], 'scrub_note');
  assert.equal(parsed.scrub_note, SCRUB_LINE);
  assert.equal(parsed.show_to_builder, 'Hi');
  const err = withScrubNote({ id: 1, result: { content: [{ type: 'text', text: 'Invalid input: x' }], isError: true } }) as {
    result: { content: { text: string }[]; isError: boolean };
  };
  assert.equal(err.result.content[0].text, `${SCRUB_LINE}\n\nInvalid input: x`);
  assert.equal(err.result.isError, true);
  const rpcError = { id: 1, error: { code: -32602, message: 'bad' } };
  assert.equal(withScrubNote(rpcError), rpcError);
});

test('T4.7 pipeline as the route runs it: rk_live in a nested argument reaches the tool scrubbed, the reply carries SCRUB_LINE, the log never has the key', async () => {
  const key = KEYS.stripeRestricted;
  let seen: unknown;
  const server = new McpServer({ name: 't', version: '1' });
  server.registerTool('echo', { inputSchema: { answers: z.object({ notes: z.array(z.string()) }) } }, async (args) => {
    seen = args;
    return { content: [{ type: 'text', text: JSON.stringify({ show_to_builder: 'Saved.' }) }] };
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);

  const logs: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  const capture = (...a: unknown[]) => logs.push(a.map(String).join(' '));
  console.log = capture;
  console.error = capture;
  console.warn = capture;
  try {
    const body = [
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { answers: { notes: ['ok', `my stripe key is ${key}`] } } } },
    ];
    // As route.ts withAliases: one parse, scrub first, log only the count.
    const scrub = scrubToolCalls(JSON.parse(JSON.stringify(body)));
    if (scrub.removed > 0) console.log(`[mcp] scrubbed ${scrub.removed}`);
    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(scrub.body),
    });
    const response = await withScrubNotes(await transport.handleRequest(request), scrub.ids);
    const text = await response.text();
    assert.deepEqual(seen, { answers: { notes: ['ok', `my stripe key is ${KEY_REMOVED}`] } });
    const replies = JSON.parse(text) as { id: number; result: { content: { text: string }[] } }[];
    const reply = replies.find((r) => r.id === 2)!;
    assert.equal(JSON.parse(reply.result.content[0].text).scrub_note, SCRUB_LINE);
    assert.deepEqual(replies.find((r) => r.id === 1)!.result, {}, 'the ping reply is untouched');
    assert.ok(!text.includes(key));
  } finally {
    Object.assign(console, orig);
  }
  assert.deepEqual(logs, ['[mcp] scrubbed 1']);
  assert.ok(!logs.join('\n').includes(key));
});

test('T4.8 route.ts scrubs in withAliases before the alias step and marks replies', () => {
  const src = readFileSync(join(__dirname, '../../app/mcp/route.ts'), 'utf8');
  const fn = src.slice(src.indexOf('async function withAliases'), src.indexOf('async function forOldNames'));
  assert.ok(fn.indexOf('scrubToolCalls(parsed)') > 0);
  assert.ok(fn.indexOf('scrubToolCalls(parsed)') < fn.indexOf('aliasedIds('));
  assert.match(fn, /console\.log\(`\[mcp\] scrubbed \$\{scrub\.removed\}`\)/);
  assert.match(src, /withScrubNotes\(await forOldNames\(/);
});
