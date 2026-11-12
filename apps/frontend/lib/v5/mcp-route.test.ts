import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { saveInstallation } from './installations';
import { POST } from '../../app/mcp/route';
import { OLD_TOOL_TEXT } from './old-tools';

after(() => sql().end());

const TEXT =
  "EarnKit's tools changed. Refresh this server's tool list, or remove and re-add the EarnKit connector. The tools are now find (what this repo can earn), track (what the builder did), record (the builder's facts, kept once) and screen (for a program's reviewer).";
const token = 'ek_oldtools_' + Math.random().toString(36).slice(2);
const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` };
const post = (body: unknown) => POST(new Request('https://earnkit.test/mcp', { method: 'POST', headers, body: JSON.stringify(body) }));
const call = (id: number, name: string, args: unknown = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
type Msg = { id: number; result: { isError?: boolean; content: { text: string }[] } };

test('old tool names get the refresh message as an error result', async () => {
  await saveInstallation(token, null);
  assert.equal(OLD_TOOL_TEXT, TEXT);
  for (const name of ['score', 'tell', 'prepare', 'confirm', 'list_programs', 'get_program', 'prepare_submission', 'confirm_entry', 'record_submission', 'launch_token', 'tell_earnkit']) {
    const r = await post(call(7, name, { x: 1 }));
    assert.equal(r.status, 200);
    const m = (await r.json()) as Msg;
    assert.equal(m.id, 7);
    assert.equal(m.result.isError, true);
    assert.equal(m.result.content[0].text, TEXT);
  }
});

test('find still works, and in a batch only the old call is answered directly', async () => {
  await saveInstallation(token, null);
  const init = { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } };
  assert.equal((await post(init)).status, 200);
  const f = (await (await post(call(2, 'find', { project: { name: 'X', description: 'An app.' } }))).json()) as Msg;
  assert.notEqual(f.result.isError, true);
  assert.notEqual(f.result.content[0].text, TEXT);
  const batch = (await (await post([call(3, 'score'), call(4, 'find', { project: { name: 'X', description: 'An app.' } })])).json()) as Msg[];
  assert.equal(batch.length, 2);
  const byId = new Map(batch.map((m) => [m.id, m]));
  assert.equal(byId.get(3)!.result.content[0].text, TEXT);
  assert.equal(byId.get(3)!.result.isError, true);
  assert.notEqual(byId.get(4)!.result.content[0].text, TEXT);
});

const raw = (body: string) => POST(new Request('https://earnkit.test/mcp', { method: 'POST', headers, body }));
/** A tools/call whose arguments nest `n` levels deep, written by hand (JSON.stringify overflows first). */
const deepCall = (id: number, name: string, n: number) =>
  `{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"${name}","arguments":{"set":${'{"a":'.repeat(n)}"x"${'}'.repeat(n)}}}}`;
const plain = (m: Msg) => JSON.parse(m.result.content[0].text) as { show_to_builder: string; agent_note: string };

test('B4 (Review Focus 3): a call nested 10,000 levels deep answers the plain line, never a 500', async () => {
  await saveInstallation(token, null);
  for (const name of ['record', 'track', 'find', 'screen']) {
    const r = await raw(deepCall(9, name, 10_000));
    assert.equal(r.status, 200);
    const m = (await r.json()) as Msg;
    assert.equal(m.id, 9);
    // L29-9, L29-10 (v6.1.16 Task 15): an input error: isError true, no builder text, the fix in the note.
    assert.equal(m.result.isError, true);
    assert.deepEqual(plain(m), { show_to_builder: '', agent_note: 'The arguments were nested too deep; fix it and call again.', refused: true });
  }
  // In a batch with a secret elsewhere: the deep call is answered, the other still runs (scrubbed).
  const key = 'sk_live_' + 'a1'.repeat(12);
  const other = JSON.stringify(call(11, 'find', { project: { name: 'X', description: `my key ${key}` } }));
  const b = await raw(`[${deepCall(10, 'record', 10_000)},${other}]`);
  assert.equal(b.status, 200);
  const text = await b.text();
  assert.ok(!text.includes(key));
  const byId = new Map((JSON.parse(text) as Msg[]).map((m) => [m.id, m]));
  assert.equal(plain(byId.get(10)!).show_to_builder, '');
  assert.match(byId.get(11)!.result.content[0].text, /That looked like a secret key/);
  // A deep message that is not a tool call: one plain JSON-RPC error.
  const p = await raw(`{"jsonrpc":"2.0","id":12,"method":"ping","params":${'['.repeat(100_000)}${']'.repeat(100_000)}}`);
  assert.notEqual(p.status, 500);
  assert.equal(((await p.json()) as { error: { message: string } }).error.message, 'I could not read that request.');
});

test('C35: arguments that are not an object answer the plain line', async () => {
  await saveInstallation(token, null);
  for (const args of [[1, 2], 'text', 5]) {
    const m = (await (await post(call(13, 'track', args))).json()) as Msg;
    assert.equal(m.result.isError, true);
    assert.equal(plain(m).show_to_builder, '');
    assert.equal(plain(m).agent_note, 'Send the arguments as an object; fix it and call again.');
  }
});

test('C35: a request the MCP library rejects is one plain line in error.message; no validation dump', async () => {
  await saveInstallation(token, null);
  const bad = [
    { jsonrpc: '2.0', id: 14, method: 'tools/call' },
    { jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 42, arguments: {} } },
    { jsonrpc: '2.0', id: 16, method: 'tools/call', params: { name: 'find', arguments: null } },
    { id: 17, params: {} },
  ];
  for (const body of bad) {
    const r = await post(body);
    assert.notEqual(r.status, 500);
    const text = await r.text();
    assert.doesNotMatch(text, /invalid_type|expected|Parse error|Internal error|"path"/);
    const m = JSON.parse(text) as { error?: { message: string }; result?: { content: { text: string }[] } };
    if (m.error) assert.equal(m.error.message, 'I could not read that request.');
    else assert.equal(JSON.parse(m.result!.content[0].text).show_to_builder, '');
  }
});

test('B6: GET /mcp is 405 with Allow: POST, DELETE, OPTIONS (v6.1.16 L19-1) and the usual CORS headers; no stream is opened', async () => {
  const { GET } = await import('../../app/mcp/route');
  for (const auth of [{ authorization: `Bearer ${token}` }, {} as Record<string, string>]) {
    const r = await GET(new Request('https://earnkit.test/mcp', { headers: { accept: 'text/event-stream', ...auth } }));
    assert.equal(r.status, 405);
    assert.equal(r.headers.get('allow'), 'POST, DELETE, OPTIONS');
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.match(r.headers.get('content-type') ?? '', /application\/json/);
    const body = (await r.json()) as { error: string; error_description: string };
    assert.equal(body.error, 'method_not_allowed');
    assert.equal(typeof body.error_description, 'string');
  }
});

test('B6: DELETE /mcp is unchanged: the same handler as POST; no token is the 401, a token the plain 200', async () => {
  const route = await import('../../app/mcp/route');
  assert.equal(route.DELETE, route.POST);
  const was = process.env.EARNKIT_URL;
  process.env.EARNKIT_URL = 'https://earnkit.test';
  const r = await route.DELETE(new Request('https://earnkit.test/mcp', { method: 'DELETE' }));
  assert.equal(r.status, 401);
  // L25-17 (v6.1.16): the 401 says what to do.
  assert.deepEqual(await r.json(), { error: 'invalid_token', error_description: 'Sign in to EarnKit from your agent to use it.' });
  if (was === undefined) delete process.env.EARNKIT_URL;
  else process.env.EARNKIT_URL = was;
  assert.match(r.headers.get('www-authenticate') ?? '', /^Bearer resource_metadata="https:\/\/earnkit\.test\/\.well-known\/oauth-protected-resource\/mcp"$/);
  await saveInstallation(token, null);
  const signed = await route.DELETE(new Request('https://earnkit.test/mcp', { method: 'DELETE', headers }));
  // With a token the stateless transport ends nothing and answers 200 with the usual CORS headers.
  assert.equal(signed.status, 200);
  assert.equal(signed.headers.get('access-control-allow-origin'), '*');
  assert.equal(await signed.text(), '');
});

// v6.1.16 Task 5 (lane 19): MCP edges.
const ALLOW = 'POST, DELETE, OPTIONS';

test('L19-1: PATCH and PUT on /mcp are 405 with Allow: POST, DELETE, OPTIONS; the proxy never matches /mcp (fix round 1, I1)', async () => {
  const route = await import('../../app/mcp/route');
  for (const r of [route.PATCH(), route.PUT()]) {
    assert.equal(r.status, 405);
    assert.equal(r.headers.get('allow'), ALLOW);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await r.json(), { error: 'method_not_allowed' });
  }
  // A matched path has its whole body buffered by Next before the route runs (no 5 s timeout, no early 413), so the
  // body-carrying endpoints stay out of the proxy; their unusual methods are an edge rule.
  const { config } = await import('../../proxy');
  // L25-20 (v6.1.16): a fourth entry for capitalised page paths, which never matches /mcp or /oauth (proxy.test.ts
  // checks it through Next's own matcher parser).
  assert.deepEqual(config.matcher.slice(0, 3), ['/me', '/oauth/authorize', '/.well-known/:path*']);
  // L27-3, L27-4 (v6.1.16): a guide path and a /link page (one segment, no dot) for the 404 rewrite and the 405.
  assert.deepEqual(config.matcher.slice(3, 5), ['/programs/:id([^/.]+)', '/link/:code([^/.]+)']);
  // L31-1 (v6.1.16 Task 17): a page entry for every page's 405, which never matches /mcp, /oauth/, /api/, /me/ or /link/.
  assert.equal(config.matcher.length, 7);
  for (const m of config.matcher.slice(5)) assert.ok(m.includes('[Mm][Cc][Pp]') && m.includes('[Oo][Aa][Uu][Tt][Hh]/'), m);
});

const accepting = (accept: string | null) => {
  const h: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  if (accept !== null) h.accept = accept;
  return POST(new Request('https://earnkit.test/mcp', { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }) }));
};

test('L19-3: Accept */*, none or application/json alone are served JSON; text/plain is 406', async () => {
  await saveInstallation(token, null);
  for (const accept of ['*/*', null, 'application/json', 'text/event-stream', 'application/json;q=0.9, text/html']) {
    const r = await accepting(accept);
    assert.equal(r.status, 200, String(accept));
    assert.match(r.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(((await r.json()) as { id: number }).id, 3);
  }
  const r = await accepting('text/plain');
  assert.equal(r.status, 406);
  assert.deepEqual(await r.json(), { error: 'not_acceptable', error_description: 'Accept application/json.' });
});

test('L19-7: an object, 1.5 or 1e30 id is -32600 invalid request; "a" and 7 get their reply; a batch answers per member', async () => {
  await saveInstallation(token, null);
  const INVALID = { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'I could not read that request.' } };
  for (const id of ['{"x":1}', '[1]', '1.5', '1e30']) {
    const r = await raw(`{"jsonrpc":"2.0","id":${id},"method":"tools/list"}`);
    assert.equal(r.status, 400, id);
    assert.deepEqual(await r.json(), INVALID);
  }
  for (const id of ['"a"', '7']) {
    const r = await raw(`{"jsonrpc":"2.0","id":${id},"method":"tools/list"}`);
    assert.equal(r.status, 200, id);
    const m = (await r.json()) as { id: unknown; result: { tools: unknown[] } };
    assert.equal(m.id, JSON.parse(id));
    assert.ok(m.result.tools.length > 0);
  }
  const b = await raw('[{"jsonrpc":"2.0","id":1.5,"method":"tools/list"},{"jsonrpc":"2.0","id":8,"method":"tools/list"}]');
  assert.equal(b.status, 200);
  const all = (await b.json()) as { id: unknown; error?: unknown; result?: unknown }[];
  assert.equal(all.length, 2);
  assert.deepEqual(all.find((m) => m.id === null), INVALID);
  assert.ok(all.find((m) => m.id === 8)?.result);
  // A batch of bad ids alone: each answered.
  const only = await raw('[{"jsonrpc":"2.0","id":{},"method":"tools/list"}]');
  assert.deepEqual(await only.json(), [INVALID]);
});

test('L19-10: a /mcp body that sends one byte and stalls answers 408 within 6 s, with one log line', async () => {
  await saveInstallation(token, null);
  const body = new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(new Uint8Array([123])) });
  const logs: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void logs.push(a.join(' '));
  const t0 = Date.now();
  let r: Response;
  try {
    r = await POST(new Request('https://earnkit.test/mcp', { method: 'POST', headers, body, duplex: 'half' } as RequestInit));
  } finally {
    console.warn = warn;
  }
  assert.ok(Date.now() - t0 < 6_000);
  assert.equal(r.status, 408);
  assert.deepEqual(await r.json(), { error: 'request_timeout', error_description: 'The request body came too slowly.' });
  assert.deepEqual(logs, ['[http] body read timed out']);
});
