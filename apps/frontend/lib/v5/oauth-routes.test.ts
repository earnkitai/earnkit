/** CIMD sign-in (v6.1.15 Task 14, Review Focus 18): an https client_id is a client ID metadata document. No test touches the network. */
import { after, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sql } from './db';
import { RateLimitError } from './rate-limit';
import { clearCimdCache, registerClient, registrationLimitKey, type ClientDeps } from './oauth';
import { authorizeGet, tokenPost } from './oauth-routes';
import { connectInstallation } from './installations';
import { type CimdResponse, cimdFixture } from './fixtures/cimd';

process.env.EARNKIT_AUTH_SECRET = 'test-secret';
process.env.EARNKIT_URL = 'https://earnkit.test';
after(() => sql().end());
beforeEach(async () => {
  clearCimdCache();
  await sql()`DELETE FROM rate_windows WHERE key LIKE 'cimdFetch:%'`;
});

const DOC_URL = 'https://client.example/cimd.json';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'a-long-random-verifier-string-for-pkce-0123456789';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const doc = (over: Record<string, unknown> = {}, url = DOC_URL) => ({ client_id: url, redirect_uris: [CALLBACK], client_name: 'Claude', ...over });
const ip = () => `10.61.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const noLimit = async () => {};

const authorize = (clientId: string, client: ClientDeps, redirectUri = CALLBACK) =>
  authorizeGet(
    new Request(`https://earnkit.test/oauth/authorize?${new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state: 's1',
    })}`),
    { limit: noLimit, client },
  );
const token = (clientId: string, code: string, client: ClientDeps, from = ip(), redirectUri = CALLBACK) =>
  tokenPost(
    new Request('https://earnkit.test/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': from },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier }).toString(),
    }),
    { client },
  );

/** The exact failure page: status 400, CIMD_FAILED as the whole body, nothing redirected. */
async function assertFailed(r: Response, what: string) {
  assert.equal(r.status, 400, what);
  assert.equal(r.headers.get('location'), null, what);
  assert.equal(await r.text(), "Connecting EarnKit failed. Your agent's client document could not be read.", what);
}

test('a client document authorizes and exchanges; the installation is named Claude', async () => {
  const f = cimdFixture({ body: doc() });
  const auth = await authorize(DOC_URL, f);
  assert.equal(auth.status, 302);
  const back = new URL(auth.headers.get('location')!);
  assert.equal(back.origin + back.pathname, CALLBACK);
  assert.equal(back.searchParams.get('state'), 's1');
  const code = back.searchParams.get('code')!;
  assert.ok(code);
  const tok = await token(DOC_URL, code, f);
  assert.equal(tok.status, 200);
  const { access_token } = (await tok.json()) as { access_token: string };
  const caller = await connectInstallation(access_token);
  assert.ok(caller);
  const [row] = await sql()`SELECT client_name FROM installations WHERE id = ${caller.id}`;
  assert.equal(row.client_name, 'Claude');
  // The exchange re-read the client through the cache: one fetch for both steps.
  assert.deepEqual(f.requests, [DOC_URL]);
});

test('every failed document check gives the one failure page and no code (Review Focus 18)', async () => {
  const cases: [string, CimdResponse, string?][] = [
    ['302 to a public URL', { status: 302, location: 'https://public.example/doc.json' }],
    ['10,241 bytes', { body: JSON.stringify({ ...doc(), pad: 'x'.repeat(10_241 - JSON.stringify({ ...doc(), pad: '' }).length) }) }],
    ['text/html', { body: doc(), contentType: 'text/html' }],
    ['client_id differs from the URL', { body: doc({ client_id: 'https://other.example/cimd.json' }) }],
    ['client_name EarnKit', { body: doc({ client_name: 'EarnKit' }) }],
    ['client_name EarnKit look-alike', { body: doc({ client_name: 'Еarn Кit' }) }],
    ['no redirect_uris', { body: doc({ redirect_uris: [] }) }],
    ['eleven redirect_uris', { body: doc({ redirect_uris: Array.from({ length: 11 }, (_, i) => (i ? `https://claude.ai/cb${i}` : CALLBACK)) }) }],
    ['a blocked redirect scheme', { body: doc({ redirect_uris: [CALLBACK, 'javascript:alert(1)'] }) }],
    ['not an object', { body: '[1]' }],
    ['invalid JSON', { body: '{"client_id":' }],
    ['a 404', { status: 404, body: doc() }],
  ];
  for (const [what, response] of cases) {
    clearCimdCache();
    const f = cimdFixture(response);
    await assertFailed(await authorize(DOC_URL, f), what);
    assert.equal(f.requests.length, 1, `${what}: one request, never a second`);
  }
  // The body really was 10,241 bytes.
  assert.equal(Buffer.byteLength(cases[1][1].body as string), 10_241);
});

test('a document on a private or loopback address is refused before any request (Review Focus 18)', async () => {
  for (const address of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '::1']) {
    clearCimdCache();
    const f = cimdFixture({ body: doc() }, address);
    await assertFailed(await authorize(DOC_URL, f), address);
    assert.equal(f.requests.length, 0, address);
  }
});

test('an http client_id is refused with no fetch', async () => {
  const url = 'http://client.example/cimd.json';
  const f = cimdFixture({ body: doc({}, url) });
  await assertFailed(await authorize(url, f), 'http');
  assert.equal(f.requests.length + f.resolves.length, 0);
});

test('an unlisted redirect_uri is refused on our page, never redirected', async () => {
  const f = cimdFixture({ body: doc() });
  await assertFailed(await authorize(DOC_URL, f, 'https://evil.example/cb'), 'unlisted');
});

test('a 5,001 ms stall is refused with the failure page', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    // The fetch cap's database call is left out: its driver's timers would be mocked too.
    const f = { ...cimdFixture({ stall: true }), fetchLimit: noLimit };
    const p = authorize(DOC_URL, f);
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    mock.timers.tick(5_001);
    await assertFailed(await p, 'stall');
  } finally {
    mock.timers.reset();
  }
});

test('cache: a failure is kept 5 minutes, a good document 1 hour', async () => {
  let at = 1_000_000_000_000;
  const now = () => at;
  const bad = cimdFixture({ body: doc(), contentType: 'text/html' });
  await assertFailed(await authorize(DOC_URL, { ...bad, now }), 'first');
  at += 5 * 60 * 1000 - 1;
  await assertFailed(await authorize(DOC_URL, { ...bad, now }), 'cached failure');
  assert.equal(bad.requests.length, 1);
  at += 2;
  await assertFailed(await authorize(DOC_URL, { ...bad, now }), 'after 5 minutes');
  assert.equal(bad.requests.length, 2);

  clearCimdCache();
  const good = cimdFixture({ body: doc() });
  assert.equal((await authorize(DOC_URL, { ...good, now })).status, 302);
  at += 60 * 60 * 1000 - 1;
  assert.equal((await authorize(DOC_URL, { ...good, now })).status, 302);
  assert.equal(good.requests.length, 1);
  at += 2;
  assert.equal((await authorize(DOC_URL, { ...good, now })).status, 302);
  assert.equal(good.requests.length, 2);
});

test('cache: at most 1,000 documents, oldest dropped first', async () => {
  const f = { ...cimdFixture((u) => ({ body: doc({}, u.href) })), fetchLimit: noLimit };
  const urls = Array.from({ length: 1_001 }, (_, i) => `https://many.example/c${i}.json`);
  for (const u of urls) assert.equal((await authorize(u, f)).status, 302);
  assert.equal(f.requests.length, 1_001);
  await authorize(urls[1_000], f);
  assert.equal(f.requests.length, 1_001, 'the newest is kept');
  await authorize(urls[0], f);
  assert.equal(f.requests.length, 1_002, 'the oldest was dropped');
});

test('a signed (registered) client_id still authorizes and exchanges unchanged, with no fetch', async () => {
  const f = cimdFixture({ body: doc() });
  const loopback = 'http://127.0.0.1:33418/callback';
  const { client_id } = registerClient({ redirect_uris: [loopback], client_name: 'Cursor' });
  const auth = await authorize(client_id, f, loopback);
  assert.equal(auth.status, 302);
  const code = new URL(auth.headers.get('location')!).searchParams.get('code')!;
  const tok = await token(client_id, code, f, ip(), loopback);
  assert.equal(tok.status, 200);
  assert.equal(f.requests.length + f.resolves.length, 0);
  // An unknown registered id keeps its own message.
  const r = await authorize('nope.nope', f);
  assert.equal(r.status, 400);
  assert.equal(await r.text(), 'Connecting EarnKit failed. Unknown client_id. Register first.');
  assert.equal(f.requests.length, 0);
});

test('limits: two client documents on one host count against one client key per address block; another block has its own', async () => {
  const host = `shared${Math.floor(Math.random() * 1e9)}.example`;
  const a = `https://${host}/a.json`;
  const b = `https://${host}/b.json`;
  assert.equal(registrationLimitKey(a), `client:host:${host}`);
  assert.equal(registrationLimitKey(b), `client:host:${host}`);
  const f = cimdFixture((u) => ({ body: doc({}, u.href) }));
  for (const id of [a, b]) {
    const code = new URL((await authorize(id, f)).headers.get('location')!).searchParams.get('code')!;
    assert.equal((await token(id, code, f, `10.62.1.${Math.floor(Math.random() * 250)}`)).status, 200);
  }
  const code = new URL((await authorize(a, f)).headers.get('location')!).searchParams.get('code')!;
  assert.equal((await token(a, code, f, '10.63.1.1')).status, 200);
  // The claude.ai callback is a hosted service's, so the hosted ceiling applies, keyed by document host and block;
  // the per-address and per-block floors counted first.
  const rows = await sql()<{ key: string; count: number }[]>`SELECT key, count FROM rate_windows WHERE key LIKE ${'%client:host:' + host + '%'} ORDER BY key`;
  assert.deepEqual(rows.map((r) => [r.key, r.count]), [
    [`installClientHosted:client:host:${host}:10.62.0.0/16`, 2],
    [`installClientHosted:client:host:${host}:10.63.0.0/16`, 1],
  ]);
  assert.equal((await sql()`SELECT 1 FROM rate_windows WHERE key = 'installHour:10.63.1.1'`).length, 1);
  assert.equal((await sql()`SELECT 1 FROM rate_windows WHERE key = 'installBlock:10.63.0.0/16'`).length, 1);
});

test('fix round 1, M1: at most 30 uncached document fetches per host an hour; over it, the failure page and no request', async () => {
  const f = cimdFixture((u) => ({ body: doc({}, u.href) }));
  for (let i = 0; i < 30; i++) assert.equal((await authorize(`${DOC_URL}?n=${i}`, f)).status, 302, `fetch ${i}`);
  assert.equal(f.requests.length, 30);
  await assertFailed(await authorize(`${DOC_URL}?n=30`, f), 'over the cap');
  assert.equal(f.requests.length, 30, 'no request over the cap');
  // Cached documents still serve, and another host has its own cap.
  assert.equal((await authorize(`${DOC_URL}?n=0`, f)).status, 302);
  assert.equal((await authorize('https://other-host.example/cimd.json', f)).status, 302);
  assert.equal(f.requests.length, 31);
  const [row] = await sql()`SELECT count FROM rate_windows WHERE key = 'cimdFetch:client.example'`;
  assert.equal(row.count, 31);
  // A refusal by the cap is not cached as the document's failure: once the window allows, it is fetched.
  await sql()`DELETE FROM rate_windows WHERE key LIKE 'cimdFetch:%'`;
  assert.equal((await authorize(`${DOC_URL}?n=30`, f)).status, 302);
  assert.equal(f.requests.length, 32);
});

test('fix round 1, M2: a failed refetch keeps the last good document for up to 24 hours; a failing check replaces it', async () => {
  let at = 2_000_000_000_000;
  const now = () => at;
  let answer: CimdResponse = { body: doc() };
  const f = { ...cimdFixture(() => answer), now };
  assert.equal((await authorize(DOC_URL, f)).status, 302);
  // An hour on, the document's host answers 503: the last good copy still signs builders in.
  answer = { status: 503, body: {} };
  at += 60 * 60 * 1000 + 1;
  assert.equal((await authorize(DOC_URL, f)).status, 302);
  assert.equal(f.requests.length, 2);
  // Within 5 minutes of that failure, no refetch.
  at += 5 * 60 * 1000 - 1;
  assert.equal((await authorize(DOC_URL, f)).status, 302);
  assert.equal(f.requests.length, 2);
  // Then it tries again, and a timeout-like failure (here a redirect) still serves the good copy.
  answer = { status: 302, location: 'https://public.example/x.json' };
  at += 2;
  assert.equal((await authorize(DOC_URL, f)).status, 302);
  assert.equal(f.requests.length, 3);
  // Over the fetch cap, the good copy is served too, with no request.
  const capped = { ...f, fetchLimit: async () => { throw new RateLimitError('cap', 60); } };
  at += 5 * 60 * 1000;
  assert.equal((await authorize(DOC_URL, capped)).status, 302);
  assert.equal(f.requests.length, 3);
  // 24 hours after the last good read, the stale copy is gone: the failure page.
  at = 2_000_000_000_000 + 24 * 60 * 60 * 1000;
  await assertFailed(await authorize(DOC_URL, f), 'stale past 24 hours');
  assert.equal(f.requests.length, 4);

  // A document read but failing a check replaces the good copy at once.
  clearCimdCache();
  answer = { body: doc() };
  assert.equal((await authorize(DOC_URL, f)).status, 302);
  answer = { body: doc({ redirect_uris: ['https://elsewhere.example/cb'] }) };
  at += 60 * 60 * 1000 + 1;
  await assertFailed(await authorize(DOC_URL, f), 'changed document');
});
