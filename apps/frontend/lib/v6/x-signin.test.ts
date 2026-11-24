/** v3.8 E5: X sign-in on the install path (flag x_signin): chooser, PKCE, callback, consent, X-only builders. */
import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sql } from '../v5/db';
import { authorizeGet, tokenPost } from '../v5/oauth-routes';
import { registerClient } from '../v5/oauth';
import { getBuilder, upsertBuilder } from './builders';
import { xOAuthFetch } from './fixtures/x-oauth';
import { signInstallState } from './github-auth';
import { INSTALL_PAGES, chooserCopy, consentPost, csrfOf } from './install-consent';
import { X_SCOPES, xVerifier } from './x-auth';
import { xCallbackGet, xStartGet } from './x-routes';

after(() => sql().end());

const SECRET = 'x-signin-test-secret-0123456789abcdef';
const ENV = {
  GITHUB_OAUTH_CLIENT_ID: 'Iv1.client', GITHUB_OAUTH_CLIENT_SECRET: 'shh', EARNKIT_AUTH_SECRET: SECRET, EARNKIT_URL: 'https://earnkit.test',
  EARNKIT_FLAGS: 'install_signin,x_signin', X_CLIENT_ID: 'x-client', X_CLIENT_SECRET: 'x-shh',
};
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENV);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
});

const ORIGIN = 'https://earnkit.test';
const CB = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'a-long-random-verifier-string-for-pkce-0123456789';
const challenge = createHash('sha256').update(verifier).digest('base64url');
let ipn = 0;
const ip = () => `192.0.2.${(++ipn % 250) + 1}`;
let xid = 1_800_000_000_000;
const account = (username: string, id = String(++xid)) => ({ id, username, name: 'X Person', created_at: '2019-05-06T07:08:09.000Z' });

const authorize = (client_id: string) =>
  authorizeGet(
    new Request(`${ORIGIN}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CB, code_challenge: challenge, code_challenge_method: 'S256', state: 's1' })}`),
    { limit: async () => {} },
  );
const exchange = (clientId: string, code: string) =>
  tokenPost(new Request(`${ORIGIN}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip() },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: CB, code_verifier: verifier }).toString(),
  }));
const start = (s: string, cookie: string | null) => xStartGet(new Request(`${ORIGIN}/auth/x?s=${encodeURIComponent(s)}`, { headers: cookie ? { cookie } : {} }));
const callback = (query: string, cookie: string | null, x: typeof fetch, now?: Date) =>
  xCallbackGet(new Request(`${ORIGIN}/x/callback?${query}`, { headers: { 'x-real-ip': ip(), ...(cookie ? { cookie } : {}) } }), { x, now });

/** authorize → the chooser: the install state (from the X link), the cookie and the page. */
async function chooser(name: string) {
  const { client_id } = await registerClient({ redirect_uris: [CB], client_name: name });
  const r = await authorize(client_id);
  assert.equal(r.status, 200);
  const html = await r.text();
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  const s = decodeURIComponent(/href="\/auth\/x\?s=([^"]+)"/.exec(html)![1]);
  return { client_id, html, cookie, nonce: cookie.split('=')[1], s };
}
/** chooser → X → callback → consent: the consent state. */
async function toConsent(name: string, acct: ReturnType<typeof account>) {
  const c = await chooser(name);
  const go = await start(c.s, c.cookie);
  assert.equal(go.status, 302);
  const x = xOAuthFetch(acct);
  const cb = await callback(`code=xc&state=${encodeURIComponent(c.s)}`, c.cookie, x.fetch);
  assert.equal(cb.status, 303);
  const to = new URL(cb.headers.get('location')!, ORIGIN);
  assert.equal(to.pathname, '/install/consent');
  return { ...c, go, x, consent: to.searchParams.get('s')! };
}
const connect = (c: { consent: string; nonce: string; cookie: string }, answer = 'yes') =>
  consentPost(new Request(`${ORIGIN}/install/consent`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN, cookie: c.cookie },
    body: new URLSearchParams({ s: c.consent, csrf: csrfOf(c.nonce, SECRET), answer }).toString(),
  }));
const xBuilders = async (id: string) => (await sql()`SELECT count(*)::int AS c FROM builders WHERE x_user_id = ${id}`)[0].c as number;

test('x_signin off: authorize goes straight to GitHub (E4) and /auth/x is the failed page', async () => {
  process.env.EARNKIT_FLAGS = 'install_signin';
  const { client_id } = await registerClient({ redirect_uris: [CB], client_name: 'X Off Agent' });
  const r = await authorize(client_id);
  assert.equal(r.status, 302);
  assert.equal(new URL(r.headers.get('location')!).origin, 'https://github.com');
  const s = new URL(r.headers.get('location')!).searchParams.get('state')!;
  const x = await start(s, r.headers.get('set-cookie')!.split(';')[0]);
  assert.equal(await x.text(), INSTALL_PAGES.failed.text);
  // Flag on, X app not set up: still GitHub only.
  process.env.EARNKIT_FLAGS = 'install_signin,x_signin';
  delete process.env.X_CLIENT_SECRET;
  assert.equal((await authorize(client_id)).status, 302);
});

test('flag on: the chooser offers GitHub and X; /auth/x goes to X with PKCE S256 and users.read tweet.read only', async () => {
  const c = await chooser('X Chooser Agent');
  const copy = chooserCopy('X Chooser Agent');
  assert.ok(c.html.includes(copy.github) && c.html.includes(copy.x));
  assert.ok(c.html.includes('href="https://github.com/login/oauth/authorize?'));
  const go = await start(c.s, c.cookie);
  const to = new URL(go.headers.get('location')!);
  assert.equal(to.origin + to.pathname, 'https://x.com/i/oauth2/authorize');
  assert.equal(to.searchParams.get('scope'), X_SCOPES);
  assert.equal(X_SCOPES, 'users.read tweet.read');
  assert.equal(to.searchParams.get('client_id'), 'x-client');
  // The exact URI the X app has registered since the pre-v5 X sign-in (`${siteUrl()}/x/callback`).
  assert.equal(to.searchParams.get('redirect_uri'), `${ORIGIN}/x/callback`);
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(to.searchParams.get('code_challenge'), createHash('sha256').update(xVerifier(c.nonce, SECRET)).digest('base64url'));
  // Another browser (no cookie, or another nonce) cannot start it.
  assert.equal(await (await start(c.s, null)).text(), INSTALL_PAGES.failed.text);
  assert.equal(await (await start(c.s, 'ek_install=other')).text(), INSTALL_PAGES.failed.text);
});

test('X callback → consent → Connect: an X-only builder, verified by X, linked to the installation; the token is not stored', async () => {
  const acct = account('e5_xonly');
  const c = await toConsent('X Only Agent', acct);
  // The verifier sent is the nonce's; one token call, one account read, nothing else.
  assert.equal(c.x.bodies[0].get('code_verifier'), xVerifier(c.nonce, SECRET));
  assert.equal(c.x.bodies[0].get('redirect_uri'), `${ORIGIN}/x/callback`);
  assert.deepEqual(c.x.calls, ['POST https://api.x.com/2/oauth2/token', 'GET https://api.x.com/2/users/me?user.fields=created_at,profile_image_url']);
  assert.equal(await xBuilders(acct.id), 0);
  const r = await connect(c);
  assert.equal(r.status, 303);
  const back = new URL(r.headers.get('location')!);
  assert.equal(back.origin + back.pathname, CB);
  assert.equal((await exchange(c.client_id, back.searchParams.get('code')!)).status, 200);
  const [row] = await sql()<{ builder_id: number; person_id: number }[]>`SELECT builder_id, person_id FROM installations WHERE client_name = 'X Only Agent'`;
  const b = (await getBuilder(row.builder_id))!;
  assert.deepEqual([b.github_id, b.login, b.x_user_id, b.x_handle], [null, null, acct.id, 'e5_xonly']);
  const [p] = await sql()<{ verified_by: string; account_created_at: Date }[]>`SELECT verified_by, account_created_at FROM people WHERE id = ${row.person_id}`;
  assert.equal(p.verified_by, 'x');
  assert.equal(p.account_created_at.toISOString(), acct.created_at);
  const [v] = await sql()<{ identity_source: string; x_handle: string; slug: string; github_login: string | null }[]>`
    SELECT identity_source, x_handle, slug, github_login FROM owner_people WHERE earnkit_builder_id = ${b.id}`;
  assert.deepEqual([v.identity_source, v.x_handle, v.slug, v.github_login], ['x_signin', 'e5_xonly', 'e5_xonly', null]);
  assert.equal((await sql()`SELECT count(*)::int AS c FROM builders WHERE row_to_json(builders)::text LIKE '%x_fake_access_token%'`)[0].c, 0);
});

test('the same X account on two installs is one builder and one person; a new handle updates it', async () => {
  const acct = account('e5_twice');
  for (const name of ['X Twice One', 'X Twice Two']) {
    const c = await toConsent(name, name.endsWith('Two') ? { ...acct, username: 'e5_twice_renamed' } : acct);
    const back = new URL((await connect(c)).headers.get('location')!);
    assert.equal((await exchange(c.client_id, back.searchParams.get('code')!)).status, 200);
  }
  const rows = await sql()<{ builder_id: number; person_id: number }[]>`SELECT builder_id, person_id FROM installations WHERE client_name IN ('X Twice One', 'X Twice Two')`;
  assert.equal(new Set(rows.map((r) => r.builder_id)).size, 1);
  assert.equal(new Set(rows.map((r) => r.person_id)).size, 1);
  assert.equal((await getBuilder(rows[0].builder_id))!.x_handle, 'e5_twice_renamed');
});

test('denied, cancelled, expired, failed and rollback land on the plain pages; nothing written', async () => {
  const acct = account('e5_pages');
  const c = await chooser('X Pages Agent');
  const x = xOAuthFetch(acct);
  const denied = await callback(`error=access_denied&state=${encodeURIComponent(c.s)}`, c.cookie, x.fetch);
  assert.equal(await denied.text(), INSTALL_PAGES.denied.text);
  assert.deepEqual(x.calls, []);
  assert.equal(await (await callback(`code=xc&state=${encodeURIComponent(c.s)}`, c.cookie, xOAuthFetch(acct, { fail: 'token' }).fetch)).text(), INSTALL_PAGES.failed.text);
  assert.equal(await (await callback(`code=xc&state=${encodeURIComponent(c.s)}`, c.cookie, xOAuthFetch(acct, { fail: 'user' }).fetch)).text(), INSTALL_PAGES.failed.text);
  assert.equal(await (await callback(`code=xc&state=${encodeURIComponent(c.s)}`, 'ek_install=other', x.fetch)).text(), INSTALL_PAGES.failed.text);
  const req = { client_id: c.client_id, redirect_uri: CB, state: 's1', code_challenge: challenge };
  const old = signInstallState({ req, nonce: c.nonce, exp: Date.now() - 1 }, SECRET);
  assert.equal(await (await callback(`code=xc&state=${encodeURIComponent(old)}`, c.cookie, x.fetch)).text(), INSTALL_PAGES.expired.text);
  assert.equal(await (await start(old, c.cookie)).text(), INSTALL_PAGES.expired.text);
  const t = await toConsent('X Cancel Agent', acct);
  assert.equal(await (await connect(t, 'no')).text(), INSTALL_PAGES.cancelled.text);
  // Rollback: x_signin off (install_signin still on) after the consent page was shown.
  const u = await toConsent('X Rollback Agent', acct);
  process.env.EARNKIT_FLAGS = 'install_signin';
  assert.equal(await (await connect(u)).text(), INSTALL_PAGES.failed.text);
  assert.equal(await xBuilders(acct.id), 0);
});

test('an X handle never reads as a GitHub login: an X-only builder has no login, and the schema keeps one account per row', async () => {
  // A GitHub builder is unchanged; an X builder named like an owner GitHub login gets no login.
  const g = await upsertBuilder({ github_id: 991_001, login: 'e5-gh', name: null, avatar_url: null }, new Date());
  assert.equal(g.x_user_id, null);
  await assert.rejects(sql()`INSERT INTO builders (name) VALUES ('nobody')`, /builders_one_account/);
  await assert.rejects(sql()`INSERT INTO builders (github_id) VALUES (991002)`, /builders_one_account/);
  await assert.rejects(sql()`INSERT INTO builders (x_user_id, x_handle) VALUES (${g.id}::text || '9', 'a'), (${g.id}::text || '9', 'b')`, /builders_x_user_id/);
});
