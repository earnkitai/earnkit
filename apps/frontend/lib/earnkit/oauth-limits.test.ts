import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';
import { authorize, registerClient } from './oauth';
import {
  authorizeGet as authorizeRoute,
  registerPost as registerRoute,
  tokenPost as tokenRoute,
} from './oauth-routes';
import { windowStart } from './rate-limit';

process.env.EARNKIT_AUTH_SECRET ??= 'test-secret';

// The T6 review probe minted 1000 installations from one client registration. Through the real
// routes, one IP now gets 50 new installations an hour (v2.8.1 §E17: the abuse floor); replays of a
// code stay free. Since v2.4 one
// registration is one installation (re-authorizing it is free), so the probe registers each time.
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const redirect = 'https://agent.example/cb';
/** A fresh code for `client_id` (authorize's logic, no HTTP), with its verifier. */
function freshCode(client_id: string, redirectUri = redirect) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const back = authorize(
    new URLSearchParams({
      client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }),
  );
  return { code: new URL(back).searchParams.get('code')!, verifier };
}
const exchange = (ip: string, c: { code: string; verifier: string }) =>
  tokenRoute(
    new Request('http://localhost/oauth/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-real-ip': ip,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: c.code,
        code_verifier: c.verifier,
      }).toString(),
    }),
  );

test(
  'one address can no longer mint unlimited installations',
  db,
  async () => {
    const ip = `198.18.${process.pid % 250}.${Date.now() % 250}`;
    const statuses: number[] = [];
    let first: { code: string; verifier: string } | null = null;
    const tokens: string[] = [];
    for (let i = 0; i < 1000 && !statuses.includes(429); i++) {
      // A redirect host per registration, so only the IP floor applies.
      const uri = `https://agent-${i}-${Date.now()}.example/cb`;
      const { client_id } = registerClient({ redirect_uris: [uri] });
      const c = freshCode(client_id, uri);
      first ??= c;
      const res = await exchange(ip, c);
      statuses.push(res.status);
      if (res.status === 200) tokens.push((await res.json()).access_token);
      else {
        assert.equal(res.status, 429);
        assert.ok(Number(res.headers.get('retry-after')) > 0);
        assert.match(
          (await res.json()).error_description,
          /Too many new EarnKit connections from this address\. Try again in/,
        );
      }
    }
    assert.equal(
      tokens.length,
      50,
      'the 51st new installation in an hour from one address is refused',
    );
    assert.equal(statuses.at(-1), 429);
    // Replaying an existing code maps to the same installation: not counted, still answered.
    const replay = await exchange(ip, first!);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).access_token, tokens[0]);
    // Another address is unaffected.
    const other = await exchange(
      ip.replace(/^198\.18\./, '198.20.'),
      freshCode(registerClient({ redirect_uris: [redirect] }).client_id),
    );
    assert.equal(other.status, 200);
    await sql()`DELETE FROM rate_windows WHERE key LIKE ${'install%:' + ip + '%'} OR key LIKE 'installClient:host:agent-%'`;
  },
);

test('authorize: 60 an hour per IP, then a readable 429', db, async () => {
  const ip = `198.19.${process.pid % 250}.${Date.now() % 250}`;
  const { client_id } = registerClient({ redirect_uris: [redirect] });
  const url = `http://localhost/oauth/authorize?${new URLSearchParams({
    client_id,
    redirect_uri: redirect,
    response_type: 'code',
    code_challenge: 'x'.repeat(43),
    code_challenge_method: 'S256',
  })}`;
  const req = () => new Request(url, { headers: { 'x-real-ip': ip } });
  for (let i = 0; i < 60; i++)
    assert.equal((await authorizeRoute(req())).status, 302);
  const res = await authorizeRoute(req());
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) > 0);
  assert.match(await res.text(), /Too many EarnKit sign-ins from this address/);
  await sql()`DELETE FROM rate_windows WHERE key = ${'oauthAuthorize:' + ip}`;
});

test('v2.4: re-authorizing a client is free and keeps its one installation', db, async () => {
  const ip = `198.21.${process.pid % 250}.${Date.now() % 250}`;
  const { client_id } = registerClient({ redirect_uris: [redirect] });
  const tokens: string[] = [];
  for (let i = 0; i < 12; i++) {
    const res = await exchange(ip, freshCode(client_id));
    assert.equal(res.status, 200, 'a known client is never rate limited');
    tokens.push((await res.json()).access_token);
  }
  assert.equal(new Set(tokens).size, 12, 'every authorization gets a new token');
  const key = createHash('sha256').update(client_id).digest('hex').slice(0, 32);
  const rows = await sql()<{ token_hash: string }[]>`
    SELECT token_hash FROM installations WHERE client_key = ${key}`;
  assert.equal(rows.length, 1, 'one installation per client');
  assert.equal(
    rows[0].token_hash,
    createHash('sha256').update(tokens.at(-1)!).digest('hex'),
    'the latest token is the one that works',
  );
  await sql()`DELETE FROM rate_windows WHERE key LIKE ${'install%:' + ip + '%'}`;
});

// ---- v2.8.1 §E17: limits keyed by agent client, not IP.

/** Puts `key`'s current window at `count` (so a test needn't make 500 requests). */
async function preload(name: string, key: string, count: number, windowSeconds: number) {
  const start = windowStart(new Date(), windowSeconds * 1000);
  await sql()`
    INSERT INTO rate_windows (key, window_start, count) VALUES (${`${name}:${key}`}, ${start}, ${count})
    ON CONFLICT (key, window_start) DO UPDATE SET count = ${count}`;
}

test("v2.8.1 §E17: a hosted agent's users are no longer capped by its servers' IP; 500 new installs per client a day", db, async () => {
  const host = `grok-${process.pid}-${Date.now()}.grok.com`;
  const uri = `https://${host}/oauth/callback`;
  const ip = `198.22.${process.pid % 250}.${Date.now() % 250}`;
  // 40 users of the hosted agent sign in through its one server IP within the hour: all succeed
  // (before v2.8.1 the 11th failed).
  for (let i = 0; i < 40; i++) {
    const { client_id } = registerClient({ redirect_uris: [uri], client_name: 'Grok' });
    const res = await exchange(ip, freshCode(client_id, uri));
    assert.equal(res.status, 200, `user ${i + 1}`);
  }
  // The installation is flagged shared_client.
  const [row] = await sql()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM installations WHERE shared_client AND last_seen_at > now() - interval '1 minute'`;
  assert.ok(row.n >= 40);
  // The client's day: the 501st is refused from any address, with a readable 429.
  await preload('installClient', `host:${host}`, 500, 86_400);
  const { client_id } = registerClient({ redirect_uris: [uri], client_name: 'Grok' });
  const res = await exchange(ip.replace(/^198\.22\./, '198.23.'), freshCode(client_id, uri));
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) > 0);
  assert.match((await res.json()).error_description, /Too many new EarnKit connections from this agent today\. Try again in/);
  // Another agent client is unaffected.
  const other = `https://other-${process.pid}-${Date.now()}.example/cb`;
  const ok = await exchange(ip, freshCode(registerClient({ redirect_uris: [other] }).client_id, other));
  assert.equal(ok.status, 200);
  await sql()`DELETE FROM rate_windows WHERE key LIKE ${'install%' + host + '%'} OR key LIKE ${'install%:' + ip + '%'} OR key LIKE 'installClient:host:other-%'`;
});

test('v2.8.1 §E17: registration is keyed the same way: 50 an hour per IP, 500 a day per agent client', db, async () => {
  const ip = `198.24.${process.pid % 250}.${Date.now() % 250}`;
  const host = `muse-${process.pid}-${Date.now()}.meta.ai`;
  const register = (from: string, uris: string[], client_name?: string) =>
    registerRoute(
      new Request('http://localhost/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-real-ip': from },
        body: JSON.stringify({ redirect_uris: uris, ...(client_name && { client_name }) }),
      }),
    );
  for (let i = 0; i < 50; i++) assert.equal((await register(ip, [`https://${host}/cb`], 'Muse')).status, 201, `registration ${i + 1}`);
  const floor = await register(ip, ['http://127.0.0.1:3334/callback']);
  assert.equal(floor.status, 429, 'the 51st from one address in an hour');
  assert.match((await floor.json()).error_description, /Too many client registrations from this address/);
  // The client's day, from fresh addresses.
  await preload('oauthRegisterClient', `host:${host}`, 500, 86_400);
  const day = await register(ip.replace(/^198\.24\./, '198.25.'), [`https://${host}/cb`], 'Muse');
  assert.equal(day.status, 429);
  assert.match((await day.json()).error_description, /Too many client registrations from this agent today/);
  // A desktop agent (loopback redirect) has only the IP floor.
  assert.equal((await register(ip.replace(/^198\.24\./, '198.26.'), ['http://127.0.0.1:3334/callback'])).status, 201);
  await sql()`DELETE FROM rate_windows WHERE key LIKE ${'oauthRegister%' + host + '%'} OR key LIKE ${'oauthRegister:' + ip.replace(/\.\d+\.\d+$/, '') + '%'}`;
});
