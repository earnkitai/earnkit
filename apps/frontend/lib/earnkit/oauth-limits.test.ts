import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';
import { authorize, registerClient, registrationLimitKey } from './oauth';
import {
  authorizeGet as authorizeRoute,
  registerPost as registerRoute,
  tokenPost as tokenRoute,
} from './oauth-routes';
import { LIMITS, REGISTER_HOST_WARN, windowStart } from './rate-limit';

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
    await sql()`DELETE FROM rate_windows WHERE key LIKE ${'install%:' + ip + '%'}`;
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

test("v2.8.1 §E17, Ruling F11: a hosted agent's users are capped neither by its servers' IP nor by its host; installs count per registration", db, async () => {
  const host = `grok-${process.pid}-${Date.now()}.grok.com`;
  const uri = `https://${host}/oauth/callback`;
  const base = `198.22.${process.pid % 250}`;
  const ipFor = (i: number) => `${base}.${Math.floor(i / 50) % 250}`;
  // 501 users of the hosted agent, each with their own registration under the same host, within the
  // hour (50 per server IP, the floor): none is refused by the client limit (before Ruling F11 the
  // 501st was, and before v2.8.1 the 11th from one IP).
  for (let i = 0; i < 501; i++) {
    const { client_id } = registerClient({ redirect_uris: [uri], client_name: 'Grok' });
    const res = await exchange(ipFor(i), freshCode(client_id, uri));
    assert.equal(res.status, 200, `user ${i + 1}: ${res.status === 200 ? '' : (await res.json()).error_description}`);
  }
  // The installations are flagged shared_client.
  const [row] = await sql()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM installations WHERE shared_client AND last_seen_at > now() - interval '5 minutes'`;
  assert.ok(row.n >= 501);
  // Nothing is counted against the host.
  const [hostRow] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM rate_windows WHERE key LIKE ${'installClient:host:' + host}`;
  assert.equal(hostRow.n, 0);
  // The per-registration key still refuses past its day, from any address, with a readable 429.
  const { client_id } = registerClient({ redirect_uris: [uri], client_name: 'Grok' });
  await preload('installClient', registrationLimitKey(client_id), 500, 86_400);
  const warn = console.warn;
  console.warn = () => {};
  const res = await exchange('198.23.1.1', freshCode(client_id, uri)).finally(() => (console.warn = warn));
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) > 0);
  assert.match((await res.json()).error_description, /Too many new EarnKit connections from this agent today\. Try again in/);
  // Another registration under the same host is unaffected.
  const ok = await exchange('198.23.1.2', freshCode(registerClient({ redirect_uris: [uri], client_name: 'Grok' }).client_id, uri));
  assert.equal(ok.status, 200);
  await sql()`DELETE FROM rate_windows WHERE key LIKE ${'install%:' + base + '.%'} OR key LIKE 'install%:198.23.1.%' OR key = ${'installClient:' + registrationLimitKey(client_id)}`;
});

test('v2.8.1 §E17, Ruling F11: registration: 50 an hour per IP; a 10,000 a day ceiling per agent host, logged before it refuses', db, async () => {
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
  // 500 a day per host is no longer a limit (Ruling F11).
  await preload('oauthRegisterHost', `host:${host}`, 500, 86_400);
  assert.equal((await register(ip.replace(/^198\.24\./, '198.27.'), [`https://${host}/cb`], 'Muse')).status, 201);
  // The ceiling warns the owner in the log at 8,000, before it refuses.
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void warned.push(a.map(String).join(' '));
  try {
    await preload('oauthRegisterHost', `host:${host}`, REGISTER_HOST_WARN - 1, 86_400);
    assert.equal((await register(ip.replace(/^198\.24\./, '198.28.'), [`https://${host}/cb`], 'Muse')).status, 201);
    assert.ok(warned.some((w) => w.includes('near the daily ceiling') && w.includes(host)), warned.join(' | '));
    assert.equal((await register(ip.replace(/^198\.24\./, '198.28.'), [`https://${host}/cb`], 'Muse')).status, 201);
    assert.equal(warned.filter((w) => w.includes('near the daily ceiling')).length, 1, 'warned once');
    // The ceiling itself, from fresh addresses.
    await preload('oauthRegisterHost', `host:${host}`, LIMITS.oauthRegisterHost.limit, 86_400);
    const day = await register(ip.replace(/^198\.24\./, '198.25.'), [`https://${host}/cb`], 'Muse');
    assert.equal(day.status, 429);
    assert.match((await day.json()).error_description, /Too many client registrations from this agent today/);
    assert.ok(warned.some((w) => w.includes('refused by oauthRegisterHost') && w.includes(host)));
  } finally {
    console.warn = warn;
  }
  // A desktop agent (loopback redirect) has only the IP floor.
  assert.equal((await register(ip.replace(/^198\.24\./, '198.26.'), ['http://127.0.0.1:3334/callback'])).status, 201);
  await sql()`DELETE FROM rate_windows WHERE key LIKE ${'oauthRegister%' + host + '%'} OR key LIKE ${'oauthRegister:' + ip.replace(/\.\d+\.\d+$/, '') + '%'}`;
});

test('v2.9 T12 (G0): a known hosted agent\'s servers pass the per-IP floor (counted, logged once); the host ceiling and everyone else\'s floor stay', db, async () => {
  const ip = `198.29.${process.pid % 250}.${Date.now() % 250}`;
  const host = `c${process.pid}${Date.now()}.claude.ai`;
  const uri = `https://${host}/api/mcp/auth_callback`;
  const register = (uris: string[], client_name?: string) =>
    registerRoute(
      new Request('http://localhost/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-real-ip': ip },
        body: JSON.stringify({ redirect_uris: uris, ...(client_name && { client_name }) }),
      }),
    );
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void warned.push(a.map(String).join(' '));
  try {
    // 60 users of a hosted agent register and connect from one server IP within the hour.
    for (let i = 0; i < 60; i++) {
      const reg = await register([uri]);
      assert.equal(reg.status, 201, `registration ${i + 1}`);
      const { client_id } = (await reg.json()) as { client_id: string };
      const tok = await exchange(ip, freshCode(client_id, uri));
      assert.equal(tok.status, 200, `install ${i + 1}`);
    }
    // Logged once per route when the floor is passed, naming the host only.
    assert.equal(warned.filter((w) => w.includes('register passed the IP floor') && w.includes(host)).length, 1, warned.join(' | '));
    assert.equal(warned.filter((w) => w.includes('token passed the IP floor') && w.includes(host)).length, 1, warned.join(' | '));
    // The same address is still refused for anything else: a desktop agent, an unknown https host,
    // or a hosted client name with a redirect host that isn't a hosted service.
    assert.equal((await register(['http://127.0.0.1:3334/callback'])).status, 429);
    assert.equal((await register(['https://agent.example/cb'])).status, 429);
    assert.equal((await register(['https://agent.example/cb'], 'Grok')).status, 429);
    const other = registerClient({ redirect_uris: [redirect], client_name: 'Grok' });
    assert.equal((await exchange(ip, freshCode(other.client_id))).status, 429);
    // The host's daily ceiling still refuses.
    await preload('oauthRegisterHost', `host:${host}`, LIMITS.oauthRegisterHost.limit, 86_400);
    const day = await register([uri]);
    assert.equal(day.status, 429);
    assert.match((await day.json()).error_description, /Too many client registrations from this agent today/);
  } finally {
    console.warn = warn;
  }
  await sql()`DELETE FROM rate_windows WHERE key LIKE ${'%' + ip} OR key LIKE ${'%' + host + '%'}`;
});
