/** People (v6.1.20): the test flag, a person per install, link and delete, the owner_people view, the install sign-in. */
import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sql } from '../v5/db';
import { saveInstallation } from '../v5/installations';
import { authorizeGet, tokenPost } from '../v5/oauth-routes';
import { registerClient } from '../v5/oauth';
import { deleteBuilder, linkInstallation, unlinkInstallation, upsertBuilder } from './builders';
import { githubOAuthFetch } from './fixtures/github-oauth';
import { signInstallState, signState, verifyInstallState, verifyState } from './github-auth';
import { callbackGet } from './link-routes';
import { testReasonFor } from './people';

after(() => sql().end());

const SECRET = 'people-test-secret-0123456789abcdef01';
const NOW = new Date('2026-11-13T12:00:00Z');
const ENV = { GITHUB_OAUTH_CLIENT_ID: 'Iv1.client', GITHUB_OAUTH_CLIENT_SECRET: 'shh', EARNKIT_AUTH_SECRET: SECRET, EARNKIT_URL: 'https://earnkit.test' };
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries([...Object.keys(ENV), 'EARNKIT_INSTALL_SIGNIN'].map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENV);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
});

let n = 0;
const install = (name: string | null = null) => saveInstallation(`people-tok-${Date.now()}-${++n}-${Math.random()}`, name);
const personOf = async (id: number) => (await sql()`SELECT p.* FROM installations i JOIN people p ON p.id = i.person_id WHERE i.id = ${id}`)[0];
const user = (id: number, login: string) => ({ github_id: id, login, name: null, avatar_url: null });

test('testReasonFor: env lists, the repro tag and name words; unset flags nothing', () => {
  const env = { EARNKIT_TEST_INSTALLATIONS: '5, 6', EARNKIT_OWNER_LOGINS: '@Jenil,jenil_x', EARNKIT_DOGFOOD_LOGINS: 'ctobot' };
  assert.equal(testReasonFor({ installationId: 6 }, env)?.reason, 'test');
  assert.equal(testReasonFor({ githubLogin: 'JENIL' }, env)?.reason, 'owner');
  assert.equal(testReasonFor({ xHandle: 'jenil_x' }, env)?.reason, 'owner');
  assert.equal(testReasonFor({ githubLogin: 'CTOBot' }, env)?.reason, 'dogfood');
  assert.equal(testReasonFor({ clientName: 'l33-ab12-claude' }, {})?.reason, 'repro');
  assert.equal(testReasonFor({ clientName: 'L1k-x' }, {})?.reason, 'repro');
  assert.equal(testReasonFor({ clientName: 'Dogfood agent' }, {})?.reason, 'dogfood');
  assert.equal(testReasonFor({ clientName: 'journey runner' }, {})?.reason, 'persona');
  assert.equal(testReasonFor({ clientName: 'My Persona' }, {})?.reason, 'persona');
  assert.equal(testReasonFor({ clientName: 'Claude Code', githubLogin: 'jenil', installationId: 5 }, {}), null);
  assert.equal(testReasonFor({ clientName: 'lovely-agent' }, {}), null);
});

test('every installation gets a person, flagged by its name; a repeat save keeps it', async () => {
  const id = await install('Claude Code');
  const p = await personOf(id);
  assert.equal(p.test_reason, null);
  assert.equal(p.builder_id, null);
  const repro = await install('l33-abc-agent');
  assert.equal((await personOf(repro)).test_reason, 'repro');
  await saveInstallation('people-same-token', 'A');
  await saveInstallation('people-same-token', 'A');
  const [c] = await sql()`SELECT count(*)::int AS c FROM installations WHERE token_hash = ${createHash('sha256').update('people-same-token').digest('hex')}`;
  assert.equal(c.c, 1);
});

test('linking sets the builder on the person; a builder with a person takes the installation and carries a reason; unlink and delete keep rows', async () => {
  const b = await upsertBuilder(user(9001, 'someone'), NOW);
  const a = await install('Claude Code');
  const pa = (await personOf(a)).id;
  await linkInstallation(a, b.id, NOW);
  assert.equal((await personOf(a)).builder_id, b.id);
  assert.equal((await personOf(a)).id, pa);
  // A second installation, flagged: joins the builder's person and gives it the reason.
  const r = await install('l7-xyz-agent');
  const pr = (await personOf(r)).id;
  await linkInstallation(r, b.id, NOW);
  const joined = await personOf(r);
  assert.equal(joined.id, pa);
  assert.equal(joined.test_reason, 'repro');
  assert.equal((await sql()`SELECT count(*)::int AS c FROM people WHERE id = ${pr}`)[0].c, 1);
  // Unlink leaves the person.
  assert.equal(await unlinkInstallation(a, b.id, NOW), true);
  assert.equal((await personOf(a)).id, pa);
  await deleteBuilder(b.id, NOW);
  assert.equal((await sql()`SELECT builder_id FROM people WHERE id = ${pa}`)[0].builder_id, null);
  assert.equal((await personOf(a)).id, pa);
});

test('an owner login flags the person at link', async () => {
  process.env.EARNKIT_OWNER_LOGINS = 'theowner';
  try {
    const b = await upsertBuilder(user(9002, 'TheOwner'), NOW);
    const a = await install('Claude Code');
    await linkInstallation(a, b.id, NOW);
    assert.equal((await personOf(a)).test_reason, 'owner');
  } finally {
    delete process.env.EARNKIT_OWNER_LOGINS;
  }
});

test('owner_people has the tracker columns and one row per installation', async () => {
  const b = await upsertBuilder(user(9003, 'viewer'), NOW);
  const a1 = await install('Claude Code');
  const a2 = await install('Cursor');
  await linkInstallation(a1, b.id, NOW);
  await sql()`UPDATE installations SET last_project_key = 'https://github.com/acme/widget' WHERE id = ${a2}`;
  const rows = await sql()<{ installation_ids: number[]; slug: string; person_key: string; identity_source: string | null; identity_proven: boolean; main_repo: string | null; x_proven: boolean }[]>`SELECT * FROM owner_people`;
  const cols = Object.keys(rows[0]);
  for (const c of ['builder_id', 'slug', 'hidden', 'installation_ids', 'x_handle', 'x_proven', 'x_created_at', 'x_followers', 'github_login', 'gh_created_at', 'wallet', 'wallet_recipient', 'wallet_proven_at', 'wallet_first_tx_at', 'wallet_funder', 'funded_by_slug', 'points_total', 'points_weeks', 'last_points_week', 'joined_at', 'last_seen_at', 'referred_installs', 'x_name', 'x_avatar_url', 'main_project_key', 'project_name', 'main_repo', 'repo_private', 'site_url', 'shipping_score', 'shipping_rank', 'rank_total', 'streak_weeks', 'commit_weeks_12', 'last_commit_week', 'last_approved_week', 'last_activity_at', 'coin_symbol', 'coin_url', 'coin_address', 'coin_backers', 'creator_fees_eth', 'programs_applied', 'programs_accepted', 'programs_won', 'checkin_on', 'email_opted_in', 'person_key', 'earnkit_builder_id', 'identity_source', 'identity_proven', 'is_test', 'test_reason'])
    assert.ok(cols.includes(c), c);
  // Each installation is in exactly one row.
  const ids = rows.flatMap((r) => r.installation_ids);
  const [{ c }] = await sql()<{ c: number }[]>`SELECT count(*)::int AS c FROM installations WHERE person_id IS NOT NULL`;
  assert.equal(ids.length, c);
  assert.equal(new Set(ids).size, ids.length);
  const linked = rows.find((r) => r.installation_ids.includes(a1))!;
  assert.equal(linked.slug, 'viewer');
  assert.equal(linked.person_key, `b:${b.id}`);
  assert.equal(linked.identity_source, 'github_signin');
  assert.equal(linked.identity_proven, true);
  const anon = rows.find((r) => r.installation_ids.includes(a2))!;
  assert.equal(anon.slug, `i-${a2}`);
  assert.equal(anon.person_key, `i:${a2}`);
  assert.equal(anon.identity_source, null);
  assert.equal(anon.main_repo, 'acme/widget');
  assert.equal(anon.x_proven, false);
});

test('an install state is never a link state, and the reverse', () => {
  const req = { client_id: 'c', redirect_uri: 'https://x.test/cb', state: 's', code_challenge: 'ch' };
  const install = signInstallState({ req, nonce: 'n', exp: NOW.getTime() + 60_000 }, SECRET);
  assert.equal(verifyState(install, SECRET, NOW), null);
  assert.deepEqual(verifyInstallState(install, SECRET, NOW), { req, nonce: 'n' });
  assert.equal(verifyInstallState(install, SECRET, new Date(NOW.getTime() + 120_000)), null);
  const link = signState({ code: 'abc', nonce: 'n', exp: NOW.getTime() + 60_000 }, SECRET);
  assert.equal(verifyInstallState(link, SECRET, NOW), null);
  // Re-signing a link payload as an install one (same MAC label) is not accepted either.
  const [body] = install.split('.');
  assert.equal(verifyInstallState(`${body}.${link.split('.')[1]}`, SECRET, NOW), null);
});

const CB = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'a-long-random-verifier-string-for-pkce-0123456789';
const challenge = createHash('sha256').update(verifier).digest('base64url');
let ipn = 0;
const ip = () => `203.0.113.${(++ipn % 250) + 1}`;
const authorize = (clientId: string) =>
  authorizeGet(
    new Request(`https://earnkit.test/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CB, code_challenge: challenge, code_challenge_method: 'S256', state: 's1' })}`),
    { limit: async () => {} },
  );
const exchange = (clientId: string, code: string) =>
  tokenPost(new Request('https://earnkit.test/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip() },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: CB, code_verifier: verifier }).toString(),
  }));
const callback = (state: string, cookie: string | null, gh: typeof fetch) =>
  callbackGet(new Request(`https://earnkit.test/auth/github/callback?code=ghc&state=${encodeURIComponent(state)}`, { headers: { 'x-real-ip': ip(), ...(cookie ? { cookie } : {}) } }), { now: new Date(), gh });

test('install sign-in off: authorize redirects straight to the client, anonymous', async () => {
  const { client_id } = await registerClient({ redirect_uris: [CB], client_name: 'Anon Agent' });
  const r = await authorize(client_id);
  assert.equal(new URL(r.headers.get('location')!).origin + new URL(r.headers.get('location')!).pathname, CB);
});

test('install sign-in github: GitHub first, then a code that links the installation to the builder', async () => {
  process.env.EARNKIT_INSTALL_SIGNIN = 'github';
  const { client_id } = await registerClient({ redirect_uris: [CB], client_name: 'Signed Agent' });
  const r = await authorize(client_id);
  assert.equal(r.status, 302);
  const to = new URL(r.headers.get('location')!);
  assert.equal(to.origin, 'https://github.com');
  const state = to.searchParams.get('state')!;
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  assert.match(cookie, /^(__Host-)?ek_install=/);
  // No cookie, or a stranger's: the failed page, no code.
  assert.equal((await callback(state, null, githubOAuthFetch({ id: 4242, login: 'newbie', name: null, avatar_url: null }).fetch)).headers.get('location'), '/link/failed');
  assert.equal((await callback(state, `${cookie.split('=')[0]}=other`, githubOAuthFetch({ id: 4242, login: 'newbie', name: null, avatar_url: null }).fetch)).headers.get('location'), '/link/failed');
  // GitHub fails: the failed page.
  assert.equal((await callback(state, cookie, githubOAuthFetch({ id: 4242, login: 'newbie', name: null, avatar_url: null }, { fail: 'token' }).fetch)).headers.get('location'), '/link/failed');
  const ok = await callback(state, cookie, githubOAuthFetch({ id: 4242, login: 'newbie', name: null, avatar_url: null }).fetch);
  assert.equal(ok.status, 302);
  const back = new URL(ok.headers.get('location')!);
  assert.equal(back.origin + back.pathname, CB);
  assert.equal(back.searchParams.get('state'), 's1');
  const t = await exchange(client_id, back.searchParams.get('code')!);
  assert.equal(t.status, 200);
  const [row] = await sql()<{ id: number; builder_id: number | null; login: string }[]>`
    SELECT i.id, i.builder_id, b.login FROM installations i JOIN builders b ON b.id = i.builder_id WHERE i.client_name = 'Signed Agent'`;
  assert.equal(row.login, 'newbie');
  assert.equal((await personOf(row.id)).builder_id, row.builder_id);
});

test('a link-code state is not accepted at the install callback', async () => {
  const state = signState({ code: 'abc', nonce: 'n', exp: Date.now() + 60_000 }, SECRET);
  const r = await callback(state, 'ek_link=n', githubOAuthFetch({ id: 1, login: 'x', name: null, avatar_url: null }).fetch);
  assert.equal(r.headers.get('location'), '/link/failed');
});

test('sign-in github without a configured OAuth app falls back to the anonymous approval', async () => {
  process.env.EARNKIT_INSTALL_SIGNIN = 'github';
  delete process.env.GITHUB_OAUTH_CLIENT_ID;
  const { client_id } = await registerClient({ redirect_uris: [CB], client_name: 'Anon2' });
  const r = await authorize(client_id);
  assert.equal(new URL(r.headers.get('location')!).origin, 'https://claude.ai');
});
