import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { BODY_TOO_LARGE, KEY_REMOVED, MAX_MCP_BODY_BYTES, PEM_MAX_BODY, SCRUB_LINE, readCapped, scrubPem, scrubSecrets, scrubToolCalls, withScrubNote, withScrubNotes } from './secrets';

// v4.8.1 Task 4 (R6). Every key here is built by concatenation, so no committed string looks like a live key.
const A = 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ';
const KEYS: Record<string, string> = {
  stripeSecret: 'sk_' + 'live_' + A.slice(0, 24),
  stripeRestricted: 'rk_' + 'live_' + 'x'.repeat(23) + '7',
  stripeTest: 'sk_' + 'test_' + A.slice(0, 16),
  webhook: 'wh' + 'sec_' + A.slice(0, 20),
  githubOauth: 'gh' + 'o_' + A.slice(0, 32),
  githubPat: 'gh' + 'p_' + A.slice(0, 36),
  githubFine: 'github_' + 'pat_' + A + '_' + A,
  anthropic: 'sk-' + 'ant-' + 'api03-' + A,
  openai: 'sk-' + (A + A).slice(0, 48),
  openaiProject: 'sk-' + 'proj-' + A + '_' + A.slice(0, 10) + '-T3BlbkFJ',
  openaiServiceAccount: 'sk-' + 'svcacct-' + A.slice(0, 20) + '_' + A.slice(0, 8),
  openaiAdmin: 'sk-' + 'admin-' + A.slice(0, 24),
  aws: 'AK' + 'IA' + 'ABCDEFGHIJ234567',
  awsTemporary: 'AS' + 'IA' + 'QRSTUVWXYZ234567',
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
  assert.equal(scrubSecrets(`service ${KEYS.openaiServiceAccount}`).removed, 1);
  assert.equal(scrubSecrets(`admin ${KEYS.openaiAdmin}`).removed, 1);
  assert.equal(scrubSecrets(KEYS.anthropic).removed, 1);
});

test('T4.9 fix 3 (F2): a 1 MB body of BEGIN markers scrubs in under 1,000 ms, with one END at the end and with none', () => {
  const marker = '-----BEGIN ' + 'PRIVATE KEY-----\n';
  const end = '-----END ' + 'PRIVATE KEY-----';
  const n = MAX_MCP_BODY_BYTES;
  const noEnd = marker.repeat(Math.ceil(n / marker.length)).slice(0, n);
  const trailingEnd = noEnd.slice(0, n - end.length) + end;
  for (const [name, text] of [['no END', noEnd], ['trailing END', trailingEnd]] as const) {
    const body = JSON.parse(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tell', arguments: { note: text } } }));
    const start = performance.now();
    const r = scrubToolCalls(body);
    const ms = performance.now() - start;
    assert.ok(ms < 1_000, `${name} took ${ms.toFixed(1)} ms`);
    // With the END: only the last BEGIN, within PEM_MAX_BODY of it, goes.
    assert.equal(r.removed, name === 'no END' ? 0 : 1, name);
  }
});

test('T4.10 fix 3 (F1): scrubPem agrees with the bounded regex it replaced', () => {
  const OLD = /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]{0,10000}?-----END [A-Z ]{0,40}PRIVATE KEY-----/g;
  const B = (label: string) => '-----BEGIN ' + label + 'PRIVATE KEY-----';
  const E = (label: string) => '-----END ' + label + 'PRIVATE KEY-----';
  const cases = [
    `a ${B('RSA ')}\nbody\n${E('RSA ')} b`,
    `${B('')}x${E('')} mid ${B('EC ')}y${E('EC ')}`,
    `${B('')}${B('')}x${E('')}`,
    `${B('')}${'z'.repeat(PEM_MAX_BODY)}${E('')}`,
    `${B('')}${'z'.repeat(PEM_MAX_BODY + 1)}${E('')}`,
    `${B('')}${'z'.repeat(PEM_MAX_BODY + 1)}${B('')}short${E('')}`,
    `${B('X'.repeat(41) + ' ')}x${E('')}`,
    `${B('')}x-----END lower PRIVATE KEY----- y${E('')}`,
    `${B('')}x${E('X'.repeat(41) + ' ')}`,
    '-----BEGIN PUBLIC KEY-----x-----END PUBLIC KEY-----',
    `${E('')} before ${B('')}`,
  ];
  for (const c of cases) {
    let count = 0;
    const expected = c.replace(OLD, () => {
      count += 1;
      return KEY_REMOVED;
    });
    assert.deepEqual(scrubPem(c), { value: expected, removed: count }, c.slice(0, 80));
  }
});

test('T4.11 fix 3 (F1): /mcp reads at most 1 MB; over that is a 413 JSON-RPC error', async () => {
  assert.equal(await readCapped(new Request('http://x/mcp', { method: 'POST', body: '{"a":1}' })), '{"a":1}');
  const big = 'a'.repeat(MAX_MCP_BODY_BYTES + 1);
  assert.equal(await readCapped(new Request('http://x/mcp', { method: 'POST', body: big })), null);
  // A chunked body (no Content-Length) stops being read at the cap.
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled += 1;
      if (pulled > 100) return c.close();
      c.enqueue(new Uint8Array(64 * 1024));
    },
  });
  const chunked = new Request('http://x/mcp', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
  assert.equal(await readCapped(chunked), null);
  assert.ok(pulled < 30, `read ${pulled} chunks`);
  // A Content-Length over the cap is refused before reading.
  const declared = new Request('http://x/mcp', { method: 'POST', body: 'x', headers: { 'content-length': String(MAX_MCP_BODY_BYTES + 1) } });
  assert.equal(await readCapped(declared), null);
  assert.deepEqual(BODY_TOO_LARGE.error.code, -32600);
  const src = readFileSync(join(__dirname, '../../app/mcp/route.ts'), 'utf8');
  assert.match(src, /const raw = await readCapped\(request\);\n\s+if \(raw === null\) return json\(BODY_TOO_LARGE, 413\);/);
  assert.ok(!/scrub skipped/.test(src));
});

test('T4.12 fix 3 (F4): a __proto__ argument key survives a scrub', () => {
  const input = JSON.parse(`{"__proto__":{"x":"hi"},"y":"${KEYS.stripeSecret}"}`);
  const r = scrubSecrets(input);
  assert.equal(r.removed, 1);
  assert.deepEqual(Object.keys(r.value as object), ['__proto__', 'y']);
  assert.equal(Object.getPrototypeOf(r.value), Object.prototype);
  assert.equal(JSON.stringify(r.value), `{"__proto__":{"x":"hi"},"y":"${KEY_REMOVED}"}`);
});

test('T4.13 fix 3 (F5): Stripe-shaped names and publishable keys are untouched', () => {
  // Final review 5: a digit-free body is a key from 24 characters, so 23 letters is still a name.
  for (const text of ['sk_' + 'test_fixtures', 'sk_' + 'live_settings', 'rk_' + 'live_' + 'x'.repeat(23), 'pk_' + 'live_' + A.slice(0, 24), 'sk_' + 'live_' + A.slice(0, 15)]) {
    assert.deepEqual(scrubSecrets(text), { value: text, removed: 0 }, text);
  }
});

test('v4.8.1 final fix (5): a Stripe key with no digit is caught from 24 characters; a digit still catches from 16', () => {
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ';
  for (const key of ['sk_' + 'live_' + letters.slice(0, 24), 'rk_' + 'live_' + 'x'.repeat(30), 'sk_' + 'test_' + letters]) {
    assert.deepEqual(scrubSecrets(`my key ${key} ok`), { value: `my key ${KEY_REMOVED} ok`, removed: 1 }, key);
  }
  assert.equal(scrubSecrets('sk_' + 'live_' + letters.slice(0, 23)).removed, 0, '23 letters, no digit');
  assert.equal(scrubSecrets('sk_' + 'live_' + letters.slice(0, 15) + '7').removed, 1, '16 with a digit');
  // The names stay names: the underscore ends the body at 8 characters.
  for (const name of ['sk_' + 'test_fixtures', 'sk_' + 'live_settings']) assert.deepEqual(scrubSecrets(name), { value: name, removed: 0 });
});

test('T4.14 fix 3 (F6): a key glued to an identifier with _ is caught; AWS ASIA keys too', () => {
  assert.deepEqual(scrubSecrets('token_' + KEYS.stripeSecret), { value: 'token_' + KEY_REMOVED, removed: 1 });
  assert.deepEqual(scrubSecrets('my_' + KEYS.githubPat + '_x'), { value: 'my_' + KEY_REMOVED + '_x', removed: 1 });
  assert.deepEqual(scrubSecrets('aws=' + KEYS.awsTemporary), { value: 'aws=' + KEY_REMOVED, removed: 1 });
  // Still not inside a longer word.
  assert.equal(scrubSecrets('x' + KEYS.stripeSecret).removed, 0);
  assert.equal(scrubSecrets('X' + KEYS.awsTemporary).removed, 0);
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

test('T4.6 the reply note: JSON text gets scrub_note first and SCRUB_LINE leads show_to_builder; other text is prefixed with a blank line', () => {
  const ok = withScrubNote({ id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ show_to_builder: 'Hi' }) }] } }) as {
    result: { content: { text: string }[] };
  };
  const parsed = JSON.parse(ok.result.content[0].text);
  assert.equal(Object.keys(parsed)[0], 'scrub_note');
  assert.equal(parsed.scrub_note, SCRUB_LINE);
  // Final review 7: the builder reads show_to_builder, so the line leads it, then a blank line; the easy reply stays last.
  assert.equal(parsed.show_to_builder, `${SCRUB_LINE}\n\nHi`);
  assert.ok(parsed.show_to_builder.startsWith(SCRUB_LINE));
  // No show_to_builder: scrub_note only, nothing added.
  const bare = JSON.parse((withScrubNote({ id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ agent_note: 'n' }) }] } }) as {
    result: { content: { text: string }[] };
  }).result.content[0].text);
  assert.deepEqual(bare, { scrub_note: SCRUB_LINE, agent_note: 'n' });
  // An empty show_to_builder is the line alone.
  const empty = JSON.parse((withScrubNote({ id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ show_to_builder: '' }) }] } }) as {
    result: { content: { text: string }[] };
  }).result.content[0].text);
  assert.equal(empty.show_to_builder, SCRUB_LINE);
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
    assert.equal(JSON.parse(reply.result.content[0].text).show_to_builder, `${SCRUB_LINE}\n\nSaved.`);
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
