import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';
import { authorize, registerClient } from './oauth';
import {
  authorizeGet as authorizeRoute,
  tokenPost as tokenRoute,
} from './oauth-routes';

process.env.EARNKIT_AUTH_SECRET ??= 'test-secret';

// The T6 review probe minted 1000 installations from one client registration. Through the real
// routes, one IP now gets 10 new installations an hour; replays of a code stay free.
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const redirect = 'https://agent.example/cb';
/** A fresh code for `client_id` (authorize's logic, no HTTP), with its verifier. */
function freshCode(client_id: string) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const back = authorize(
    new URLSearchParams({
      client_id,
      redirect_uri: redirect,
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
  'one client registration can no longer mint unlimited installations',
  db,
  async () => {
    const ip = `198.18.${process.pid % 250}.${Date.now() % 250}`;
    const { client_id } = registerClient({ redirect_uris: [redirect] });
    const statuses: number[] = [];
    let first: { code: string; verifier: string } | null = null;
    const tokens: string[] = [];
    for (let i = 0; i < 1000 && !statuses.includes(429); i++) {
      const c = freshCode(client_id);
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
      10,
      'the 11th new installation in an hour is refused',
    );
    assert.equal(statuses.at(-1), 429);
    // Replaying an existing code maps to the same installation: not counted, still answered.
    const replay = await exchange(ip, first!);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).access_token, tokens[0]);
    // Another address is unaffected.
    const other = await exchange(
      ip.replace(/^198\.18\./, '198.20.'),
      freshCode(client_id),
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
