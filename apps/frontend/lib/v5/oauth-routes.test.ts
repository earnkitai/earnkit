/** CIMD sign-in (v6.1.15 Task 14, Review Focus 18): an https client_id is a client ID metadata document. No test touches the network. */
import { after, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sql } from './db';
import { RateLimitError } from './rate-limit';
import { CIMD_FETCH_KEY, CIMD_HOST_KEY, cimdClient, clearCimdCache, clearCimdStore, registerClient, registrationLimitKey, type ClientDeps } from './oauth';
import { authorizeGet, tokenPost } from './oauth-routes';
import { connectInstallation } from './installations';
import { type CimdResponse, cimdFixture } from './fixtures/cimd';

process.env.EARNKIT_AUTH_SECRET = 'test-secret';
process.env.EARNKIT_URL = 'https://earnkit.test';
after(() => sql().end());
/** L35-5 (v6.1.16.1 Task 2): a new process with no stored documents either: the cache in memory and in the database. */
const clearAll = async () => {
  clearCimdCache();
  await clearCimdStore();
};
beforeEach(async () => {
  await clearAll();
  await sql()`DELETE FROM rate_windows WHERE key LIKE 'cimdFetch%'`;
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
    await clearAll();
    const f = cimdFixture(response);
    await assertFailed(await authorize(DOC_URL, f), what);
    assert.equal(f.requests.length, 1, `${what}: one request, never a second`);
  }
  // The body really was 10,241 bytes.
  assert.equal(Buffer.byteLength(cases[1][1].body as string), 10_241);
});

test('a document on a private or loopback address is refused before any request (Review Focus 18)', async () => {
  for (const address of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '::1']) {
    await clearAll();
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
    // The fetch cap's and the document store's database calls are left out: its driver's timers would be mocked too.
    const f = { ...cimdFixture({ stall: true }), fetchLimit: noLimit, store: false as const };
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

  await clearAll();
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
  // L35-5 (v6.1.16.1 Task 2): the oldest left memory; its stored good copy serves it with no fetch.
  await authorize(urls[0], f);
  assert.equal(f.requests.length, 1_001, 'the oldest is read from the store');
  await clearAll();
  await authorize(urls[0], f);
  assert.equal(f.requests.length, 1_002, 'with no stored copy, it is fetched');
});

test('a signed (registered) client_id still authorizes and exchanges unchanged, with no fetch', async () => {
  const f = cimdFixture({ body: doc() });
  const loopback = 'http://127.0.0.1:33418/callback';
  const { client_id } = await registerClient({ redirect_uris: [loopback], client_name: 'Cursor' });
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
  // L35-5 (v6.1.16.1 Task 2): counted per host and the caller's address block ('unknown' here: the request has no address).
  const [row] = await sql()`SELECT count FROM rate_windows WHERE key = ${CIMD_FETCH_KEY('client.example', 'unknown')}`;
  assert.equal(row.count, 31);
  // Cache-busting URLs that spent the cap never stop a cached document being refetched (fix round 2).
  const at = Date.now() + 2 * 60 * 60 * 1000;
  const later = { ...f, now: () => at };
  assert.equal((await authorize(`${DOC_URL}?n=1`, later)).status, 302);
  assert.equal(f.requests.length, 32, 'a cached URL past its hour is refetched over the cap');
  await assertFailed(await authorize(`${DOC_URL}?n=31`, later), 'a new URL is still capped');
  assert.equal(f.requests.length, 32);
  // A refusal by the cap is not cached as the document's failure: once the window allows, it is fetched.
  await sql()`DELETE FROM rate_windows WHERE key LIKE 'cimdFetch%'`;
  assert.equal((await authorize(`${DOC_URL}?n=30`, f)).status, 302);
  assert.equal(f.requests.length, 33);
});

test('fix round 2: the last good document is kept up to 6 hours on transport errors only; a definitive answer withdraws it', async () => {
  const base = 2_000_000_000_000;
  let at = base;
  const now = () => at;
  let answer: CimdResponse = { body: doc() };
  const f = { ...cimdFixture(() => answer), now };
  assert.equal((await authorize(DOC_URL, f)).status, 302);
  // An hour on, the document's host answers 503 (an outage): the last good copy still signs builders in.
  answer = { status: 503, body: {} };
  at += 60 * 60 * 1000 + 1;
  assert.equal((await authorize(DOC_URL, f)).status, 302);
  assert.equal(f.requests.length, 2);
  // Within 5 minutes of that failure, no refetch.
  at += 5 * 60 * 1000 - 1;
  assert.equal((await authorize(DOC_URL, f)).status, 302);
  assert.equal(f.requests.length, 2);
  // Then it tries again; a reset connection and a timeout are outages too.
  answer = { reset: true };
  at += 2;
  assert.equal((await authorize(DOC_URL, f)).status, 302);
  assert.equal(f.requests.length, 3);
  // A refetch of a URL with a good copy never counts on the per-host cap: with the cap spent it still goes through.
  const capped = { ...f, fetchLimit: async () => { throw new RateLimitError('cap', 60); } };
  answer = { body: doc() };
  at += 5 * 60 * 1000;
  assert.equal((await authorize(DOC_URL, capped)).status, 302);
  assert.equal(f.requests.length, 4);
  const lastGood = at;
  // A URL with only a failed entry counts again once its 5 minute wait is over: with the cap spent, no request.
  answer = { status: 404, body: {} };
  const badUrl = `${DOC_URL}?bad=1`;
  await assertFailed(await authorize(badUrl, f), 'first failed read');
  const before = f.requests.length;
  at += 5 * 60 * 1000 + 1;
  await assertFailed(await authorize(badUrl, capped), 'failed entry refetch under a spent cap');
  assert.equal(f.requests.length, before, 'no request for a failed entry under a spent cap');
  answer = { body: doc() };
  // 6 hours after the last good read, an outage no longer keeps the copy.
  answer = { status: 500, body: {} };
  at = lastGood + 6 * 60 * 60 * 1000 - 1;
  assert.equal((await authorize(DOC_URL, f)).status, 302, 'just inside 6 hours');
  at = lastGood + 6 * 60 * 60 * 1000;
  await assertFailed(await authorize(DOC_URL, f), 'stale past 6 hours');

  // Definitive answers drop the good copy at once and cache the failure.
  const withdrawals: [string, CimdResponse][] = [
    ['404', { status: 404, body: {} }],
    ['410', { status: 410, body: {} }],
    ['403', { status: 403, body: {} }],
    ['a redirect', { status: 302, location: 'https://public.example/x.json' }],
    ['text/html', { body: doc(), contentType: 'text/html' }],
    ['invalid JSON', { body: '{"client_id":' }],
    ['a failed check (another client_id)', { body: doc({ client_id: 'https://other.example/cimd.json' }) }],
    ['a failed check (EarnKit as the name)', { body: doc({ client_name: 'EarnKit' }) }],
  ];
  for (const [what, response] of withdrawals) {
    await clearAll();
    answer = { body: doc() };
    assert.equal((await authorize(DOC_URL, f)).status, 302, what);
    answer = response;
    at += 60 * 60 * 1000 + 1;
    await assertFailed(await authorize(DOC_URL, f), what);
    // The failure is cached: even a good document is not read again within 5 minutes.
    const before: number = f.requests.length;
    answer = { body: doc() };
    at += 5 * 60 * 1000 - 1;
    await assertFailed(await authorize(DOC_URL, f), `${what}: cached`);
    assert.equal(f.requests.length, before, what);
    // After the backoff it is read again; with no good copy left it counts on the cap (refused under a spent cap).
    at += 2;
    await assertFailed(await authorize(DOC_URL, capped), `${what}: refetch under a spent cap`);
    assert.equal(f.requests.length, before, `${what}: no request under a spent cap`);
    assert.equal((await authorize(DOC_URL, f)).status, 302, `${what}: refetched`);
  }
  // A valid document with a new redirect list replaces the old one: the dropped callback is refused at once.
  await clearAll();
  answer = { body: doc() };
  assert.equal((await authorize(DOC_URL, f)).status, 302);
  answer = { body: doc({ redirect_uris: ['https://elsewhere.example/cb'] }) };
  at += 60 * 60 * 1000 + 1;
  await assertFailed(await authorize(DOC_URL, f), 'callback withdrawn');
  assert.equal((await authorize(DOC_URL, f, 'https://elsewhere.example/cb')).status, 302);
});

test('L35-5 (v6.1.16.1 Task 2, Review Focus 9): 31 cache-busting reads from one block never stop the vendor\'s document for another block; a fresh process serves a stored good document with no fetch', async () => {
  const VENDOR = 'https://l35-vendor.test/client.json';
  const f = cimdFixture((u) => ({ body: doc({}, u.href) }));
  const from = (block: string): ClientDeps => ({ ...f, block });
  for (let n = 0; n <= 30; n++) {
    try {
      await cimdClient(`${VENDOR}?bust=${n}`, from('10.35.0.0/16'));
    } catch {
      // The 31st is over block A's cap.
    }
  }
  assert.equal(f.requests.length, 30);
  const [a] = await sql()`SELECT count FROM rate_windows WHERE key = ${CIMD_FETCH_KEY('l35-vendor.test', '10.35.0.0/16')}`;
  assert.equal(a.count, 31);
  // The vendor's real document, read from another block, goes through.
  assert.deepEqual((await cimdClient(VENDOR, from('10.36.0.0/16'))).r, [CALLBACK]);
  assert.equal(f.requests.length, 31);
  // Through the authorize page too, the caller's block is the key.
  const viaPage = await authorizeGet(new Request(`https://earnkit.test/oauth/authorize?${new URLSearchParams({
    response_type: 'code', client_id: `${VENDOR}?bust=page`, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256',
  })}`, { headers: { 'x-forwarded-for': '10.37.1.2' } }), { limit: noLimit, client: f });
  assert.equal(viaPage.status, 302);
  assert.equal((await sql()`SELECT count FROM rate_windows WHERE key = ${CIMD_FETCH_KEY('l35-vendor.test', '10.37.0.0/16')}`)[0].count, 1);
  // A fresh process (no cache in memory) serves the stored good copy with no fetch and no count, from block A too.
  clearCimdCache();
  const before = f.requests.length;
  assert.deepEqual((await cimdClient(VENDOR, from('10.35.0.0/16'))).r, [CALLBACK]);
  assert.equal(f.requests.length, before);
  assert.equal((await sql()`SELECT count FROM rate_windows WHERE key = ${CIMD_FETCH_KEY('l35-vendor.test', '10.35.0.0/16')}`)[0].count, 31);
});

test('L35-5 controller ruling (v6.1.16.1 Task 2): a total of 300 uncached fetches an hour per host across every block; many blocks never multiply them', async () => {
  const f = cimdFixture((u) => ({ body: doc({}, u.href) }));
  const URL0 = 'https://l35-total.test/client.json';
  for (let b = 0; b < 10; b++)
    for (let n = 0; n < 30; n++) await cimdClient(`${URL0}?b=${b}&n=${n}`, { ...f, block: `10.${100 + b}.0.0/16` });
  assert.equal(f.requests.length, 300);
  await assert.rejects(cimdClient(`${URL0}?b=10`, { ...f, block: '10.120.0.0/16' }));
  assert.equal(f.requests.length, 300, 'no fetch over the host total');
  assert.equal((await sql()`SELECT count FROM rate_windows WHERE key = ${CIMD_HOST_KEY('l35-total.test')}`)[0].count, 301);
  // A document already good still serves.
  assert.deepEqual((await cimdClient(`${URL0}?b=0&n=0`, { ...f, block: '10.120.0.0/16' })).r, [CALLBACK]);
});
