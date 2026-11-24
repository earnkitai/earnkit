/** v3.8 E4: the install sign-in with its consent page (C1 closed), and the plain pages it can end on. */
import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sql } from '../v5/db';
import { authorizeGet, tokenPost } from '../v5/oauth-routes';
import { registerClient } from '../v5/oauth';
import { githubOAuthFetch } from './fixtures/github-oauth';
import { signInstallState } from './github-auth';
import { INSTALL_PAGES, consentCopy, consentGet, consentPost, csrfOf, installSignInOn, signConsent, verifyConsent } from './install-consent';
import { callbackGet } from './link-routes';

after(() => sql().end());

const SECRET = 'consent-test-secret-0123456789abcdef0';
const ENV = { GITHUB_OAUTH_CLIENT_ID: 'Iv1.client', GITHUB_OAUTH_CLIENT_SECRET: 'shh', EARNKIT_AUTH_SECRET: SECRET, EARNKIT_URL: 'https://earnkit.test', EARNKIT_FLAGS: 'install_signin' };
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENV);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
});

const CB = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'a-long-random-verifier-string-for-pkce-0123456789';
const challenge = createHash('sha256').update(verifier).digest('base64url');
let ipn = 0;
const ip = () => `198.51.100.${(++ipn % 250) + 1}`;
const ORIGIN = 'https://earnkit.test';
let gid = 77_000;
const ghUser = (login: string, id = ++gid) => ({ id, login, name: null, avatar_url: null, created_at: '2020-01-02T03:04:05Z' });

/** authorize → GitHub: the install state and the nonce cookie ("name=value"). */
async function start(clientName: string) {
  const { client_id } = await registerClient({ redirect_uris: [CB], client_name: clientName });
  const r = await authorizeGet(
    new Request(`${ORIGIN}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CB, code_challenge: challenge, code_challenge_method: 'S256', state: 's1' })}`),
    { limit: async () => {} },
  );
  assert.equal(r.status, 302);
  return { client_id, state: new URL(r.headers.get('location')!).searchParams.get('state')!, cookie: r.headers.get('set-cookie')!.split(';')[0] };
}
const callback = (query: string, cookie: string | null, gh: typeof fetch, now = new Date()) =>
  callbackGet(new Request(`${ORIGIN}/auth/github/callback?${query}`, { headers: { 'x-real-ip': ip(), ...(cookie ? { cookie } : {}) } }), { now, gh });
const get = (s: string, cookie: string | null) => consentGet(new Request(`${ORIGIN}/install/consent?s=${encodeURIComponent(s)}`, { headers: cookie ? { cookie } : {} }));
const post = (form: Record<string, string>, cookie: string | null, o: { origin?: string | null; now?: Date } = {}) =>
  consentPost(
    new Request(`${ORIGIN}/install/consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(o.origin !== null && { origin: o.origin ?? ORIGIN }), ...(cookie ? { cookie } : {}) },
      body: new URLSearchParams(form).toString(),
    }),
    { now: o.now },
  );
const exchange = (clientId: string, code: string) =>
  tokenPost(new Request(`${ORIGIN}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip() },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: CB, code_verifier: verifier }).toString(),
  }));
const builders = async (login: string) => (await sql()`SELECT count(*)::int AS c FROM builders WHERE login = ${login}`)[0].c as number;

/** authorize → GitHub → callback: the consent state and the cookie, nothing written yet. */
async function toConsentPage(clientName: string, user: ReturnType<typeof ghUser>) {
  const s = await start(clientName);
  const gh = githubOAuthFetch(user);
  const cb = await callback(`code=ghc&state=${encodeURIComponent(s.state)}`, s.cookie, gh.fetch);
  assert.equal(cb.status, 303);
  const to = new URL(cb.headers.get('location')!, ORIGIN);
  assert.equal(to.pathname, '/install/consent');
  // Only the token exchange and the profile read: no repo, email or write call, and the token is not kept.
  assert.deepEqual(gh.calls, ['POST https://github.com/login/oauth/access_token', 'GET https://api.github.com/user']);
  return { ...s, consent: to.searchParams.get('s')!, nonce: s.cookie.split('=')[1] };
}
const connect = async (clientName: string, user: ReturnType<typeof ghUser>) => {
  const c = await toConsentPage(clientName, user);
  const r = await post({ s: c.consent, csrf: csrfOf(c.nonce, SECRET), answer: 'yes' }, c.cookie);
  assert.equal(r.status, 303);
  const back = new URL(r.headers.get('location')!);
  assert.equal(back.origin + back.pathname, CB);
  assert.equal((await exchange(c.client_id, back.searchParams.get('code')!)).status, 200);
  return (await sql()<{ id: number; builder_id: number; person_id: number }[]>`SELECT id, builder_id, person_id FROM installations WHERE client_name = ${clientName}`)[0];
};

test('C1 closed: the callback lands on the consent page, never on the client, and writes nothing until Connect', async () => {
  const user = ghUser('e4-victim');
  const c = await toConsentPage('E4 Attacker Agent', user);
  assert.equal(await builders('e4-victim'), 0);
  const page = await get(c.consent, c.cookie);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type')!, /text\/html/);
  const html = await page.text();
  const copy = consentCopy('E4 Attacker Agent', 'claude.ai', { by: 'github', user: { github_id: user.id, login: 'e4-victim', name: null, avatar_url: null, created_at: null } });
  assert.ok(html.includes(copy.title.replace(/"/g, '&quot;')), html);
  assert.ok(html.includes('@e4-victim') && html.includes('claude.ai'));
  assert.ok(html.includes(`name="csrf" value="${csrfOf(c.nonce, SECRET)}"`));
  assert.match(html, /<form method="post" action="\/install\/consent">/);
  // The page itself writes nothing either.
  assert.equal(await builders('e4-victim'), 0);
});

test('Connect: a code for the client that links the installation; the person is verified by GitHub at the callback time', async () => {
  const before = Date.now();
  const row = await connect('E4 Real Agent', ghUser('e4-real'));
  const [p] = await sql()<{ verified_by: string; verified_at: Date; account_created_at: Date; builder_id: number }[]>`SELECT * FROM people WHERE id = ${row.person_id}`;
  assert.equal(p.builder_id, row.builder_id);
  assert.equal(p.verified_by, 'github');
  assert.ok(p.verified_at.getTime() >= before - 1000 && p.verified_at.getTime() <= Date.now());
  assert.equal(p.account_created_at.toISOString(), '2020-01-02T03:04:05.000Z');
  // No GitHub token is stored anywhere on the builder.
  assert.equal((await sql()`SELECT count(*)::int AS c FROM builders WHERE row_to_json(builders)::text LIKE '%gho_%'`)[0].c, 0);
});

test('the same GitHub account on two installs is one builder and one person', async () => {
  const user = ghUser('e4-twice');
  const a = await connect('E4 Twice One', user);
  const b = await connect('E4 Twice Two', user);
  assert.notEqual(a.id, b.id);
  assert.equal(a.builder_id, b.builder_id);
  assert.equal(a.person_id, b.person_id);
  assert.equal((await sql()`SELECT count(*)::int AS c FROM people WHERE builder_id = ${a.builder_id}`)[0].c, 1);
});

test('a forged post fails: no CSRF value, a wrong one, another browser, another site, no cookie', async () => {
  const c = await toConsentPage('E4 Forged Agent', ghUser('e4-forged'));
  const csrf = csrfOf(c.nonce, SECRET);
  const failed = async (r: Response) => {
    assert.equal(r.status, 400);
    assert.equal(await r.text(), INSTALL_PAGES.failed.text);
  };
  await failed(await post({ s: c.consent, answer: 'yes' }, c.cookie));
  await failed(await post({ s: c.consent, csrf: csrfOf('other-nonce', SECRET), answer: 'yes' }, c.cookie));
  await failed(await post({ s: c.consent, csrf, answer: 'yes' }, 'ek_install=other-nonce'));
  await failed(await post({ s: c.consent, csrf, answer: 'yes' }, c.cookie, { origin: 'https://evil.test' }));
  await failed(await post({ s: c.consent, csrf, answer: 'yes' }, c.cookie, { origin: null }));
  await failed(await post({ s: c.consent, csrf, answer: 'yes' }, null));
  await failed(await get(c.consent, null));
  await failed(await get(`${c.consent}x`, c.cookie));
  assert.equal(await builders('e4-forged'), 0);
});

test('Not now: the cancelled page with one next step, the cookie cleared, nothing written', async () => {
  const c = await toConsentPage('E4 Cancel Agent', ghUser('e4-cancel'));
  const r = await post({ s: c.consent, csrf: csrfOf(c.nonce, SECRET), answer: 'no' }, c.cookie);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), INSTALL_PAGES.cancelled.text);
  assert.match(r.headers.get('set-cookie')!, /Max-Age=0/);
  assert.equal(await builders('e4-cancel'), 0);
});

test('GitHub Cancel (error=access_denied): the denied page; no GitHub call', async () => {
  const s = await start('E4 Denied Agent');
  const gh = githubOAuthFetch(ghUser('e4-denied'));
  const r = await callback(`error=access_denied&state=${encodeURIComponent(s.state)}`, s.cookie, gh.fetch);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), INSTALL_PAGES.denied.text);
  assert.deepEqual(gh.calls, []);
});

test('expired: an install state past 15 minutes at the callback, and a consent past its time at the post', async () => {
  const req = { client_id: 'c', redirect_uri: CB, state: 's', code_challenge: challenge };
  const old = signInstallState({ req, nonce: 'n1', exp: Date.now() - 1 }, SECRET);
  const r = await callback(`code=ghc&state=${encodeURIComponent(old)}`, 'ek_install=n1', githubOAuthFetch(ghUser('e4-late')).fetch);
  assert.equal(r.status, 400);
  assert.equal(await r.text(), INSTALL_PAGES.expired.text);
  const c = await toConsentPage('E4 Late Agent', ghUser('e4-late2'));
  const late = await post({ s: c.consent, csrf: csrfOf(c.nonce, SECRET), answer: 'yes' }, c.cookie, { now: new Date(Date.now() + 16 * 60_000) });
  assert.equal(await late.text(), INSTALL_PAGES.expired.text);
  assert.equal(await builders('e4-late2'), 0);
});

test('the switch is the install_signin flag alone: the old EARNKIT_INSTALL_SIGNIN does nothing, and the OAuth app is needed', () => {
  const app = { GITHUB_OAUTH_CLIENT_ID: 'Iv1.client', GITHUB_OAUTH_CLIENT_SECRET: 'shh' };
  assert.equal(installSignInOn({ ...app, EARNKIT_FLAGS: 'install_signin' }), true);
  assert.equal(installSignInOn({ ...app, EARNKIT_INSTALL_SIGNIN: 'github' }), false);
  assert.equal(installSignInOn({ ...app, EARNKIT_FLAGS: 'x_signin' }), false);
  assert.equal(installSignInOn({ EARNKIT_FLAGS: 'install_signin' }), false);
});

test('rollback: with install_signin off a consent already shown cannot be finished', async () => {
  const c = await toConsentPage('E4 Rollback Agent', ghUser('e4-rollback'));
  delete process.env.EARNKIT_FLAGS;
  const r = await post({ s: c.consent, csrf: csrfOf(c.nonce, SECRET), answer: 'yes' }, c.cookie);
  assert.equal(await r.text(), INSTALL_PAGES.failed.text);
  assert.equal(await builders('e4-rollback'), 0);
});

test('consent state: its own label, round trip, forged and expired; the copy follows 23.3', () => {
  const user = { github_id: 1, login: 'a', name: null, avatar_url: null, created_at: new Date('2021-01-01T00:00:00Z') };
  const c = { req: { client_id: 'c', redirect_uri: CB, state: null, code_challenge: 'x' }, who: { by: 'github' as const, user }, nonce: 'n', at: 5, exp: 10_000 };
  const s = signConsent(c, SECRET);
  assert.deepEqual(verifyConsent(s, SECRET, new Date(0)), c);
  assert.equal(verifyConsent(s, SECRET, new Date(10_000)), 'expired');
  assert.equal(verifyConsent(s, 'another-secret', new Date(0)), null);
  // An install state never verifies as a consent.
  assert.equal(verifyConsent(signInstallState({ req: c.req, nonce: 'n', exp: 10_000 }, SECRET), SECRET, new Date(0)), null);
  const copy = consentCopy(null, 'claude.ai', c.who);
  // E5 must not change E4's GitHub page: these are E4's lines, word for word.
  assert.deepEqual(copy.lines, [
    "You're signed in to GitHub as @a. The agent at claude.ai gets your EarnKit profile.",
    "EarnKit reads only your public GitHub profile. It can't see your private repos or post for you.",
  ]);
  const xCopy = consentCopy(null, 'claude.ai', { by: 'x', user: { x_user_id: '1', handle: 'b', name: null, avatar_url: null, created_at: null } });
  for (const line of [copy.title, ...copy.lines, ...xCopy.lines, ...Object.values(INSTALL_PAGES).map((p) => p.text)]) {
    assert.doesNotMatch(line, /[;!–—]|token|please|successfully/i, line);
  }
});
