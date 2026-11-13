/** People (v6.1.21): the test flag, a person per install, link and delete, the owner_people view, the install sign-in. */
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
import { INSTALL_FAILED, INSTALL_SIGNIN_ENABLED, callbackGet } from './link-routes';
import { clientNameReason, testReasonFor } from './people';

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
  // Owner over test: the stronger list wins.
  assert.equal(testReasonFor({ githubLogin: 'jenil', installationId: 6 }, env)?.reason, 'owner');
  assert.equal(testReasonFor({ clientName: 'l33-ab12-claude' }, {})?.reason, 'repro');
  assert.equal(testReasonFor({ clientName: 'Dogfood agent' }, {})?.reason, 'dogfood');
  assert.equal(testReasonFor({ clientName: 'journey runner' }, {})?.reason, 'persona');
  assert.equal(testReasonFor({ clientName: 'My Persona' }, {})?.reason, 'persona');
  assert.equal(testReasonFor({ clientName: 'Claude Code', githubLogin: 'jenil', installationId: 5 }, {}), null);
  assert.equal(testReasonFor({ clientName: 'lovely-agent' }, {}), null);
});

test('I2 (v6.1.21): client-name patterns are whole words with separators, or a lane prefix', () => {
  const r = (n: string) => clientNameReason(n)?.reason ?? null;
  // Not flagged: real product names.
  for (const n of ['Personal Assistant', 'my-personal-agent', 'Journey', 'JourneyAI MCP', 'Dogfooding Inc', 'pytest-runner', 'Testament', 'Claude Code', 'Repros', 'l33agent', 'lane-1'])
    assert.equal(r(n), null, n);
  // Flagged.
  assert.equal(r('l2-agent'), 'repro');
  assert.equal(r('L33-abc-claude'), 'repro');
  assert.equal(r('persona-3'), 'persona');
  assert.equal(r('my_persona'), 'persona');
  assert.equal(r('journey-runner'), 'persona');
  assert.equal(r('Journey Runner'), 'persona');
  assert.equal(r('dogfood-cto'), 'dogfood');
  assert.equal(r('ek repro'), 'repro');
  assert.equal(r('claude_test'), 'test');
  assert.equal(r('Test Agent'), 'test');
  // A bare word with no separator is a product name.
  for (const n of ['Persona', 'Dogfood', 'Test', 'Repro']) assert.equal(r(n), null, n);
});

test('v6.1.22: the live persona lanes and the first-run audit are personas; Lane alone or Lanely is not', () => {
  const r = (n: string) => clientNameReason(n)?.reason ?? null;
  for (const n of ['Lane 1h', 'Lane 1k', 'lane1k', 'lane 46 saas', 'firstrun-audit', 'ek firstrun-audit 2'])
    assert.equal(r(n), 'persona', n);
  // Final fix round (I4): a product named Lane or Audit stays real.
  for (const n of ['Lane', 'Lanely', 'Lanely Agent', 'lane-1', 'Auditor Pro', 'firstrunner-x', 'Audit', 'Firstrun', 'Lane AI', 'Lane Assistant', 'Code Audit Agent', 'Security-Audit Bot', 'ek audit'])
    assert.equal(r(n), null, n);
  assert.equal(testReasonFor({ clientName: 'Lane 1h' }, {})?.reason, 'persona');
  assert.equal(testReasonFor({ clientName: 'firstrun-audit' }, {})?.reason, 'persona');
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

test('linking sets the builder on the person; a builder with a person takes the installation; unlink and delete keep rows', async () => {
  const b = await upsertBuilder(user(9001, 'someone'), NOW);
  const a = await install('Claude Code');
  const pa = (await personOf(a)).id;
  await linkInstallation(a, b.id, NOW);
  assert.equal((await personOf(a)).builder_id, b.id);
  assert.equal((await personOf(a)).id, pa);
  // A second installation, flagged by its name: joins the builder's person, and the name's reason stays behind (I2).
  const r = await install('l7-xyz-agent');
  const pr = (await personOf(r)).id;
  await linkInstallation(r, b.id, NOW);
  const joined = await personOf(r);
  assert.equal(joined.id, pa);
  assert.equal(joined.test_reason, null);
  assert.equal((await sql()`SELECT test_reason FROM people WHERE id = ${pr}`)[0].test_reason, 'repro');
  // Unlink leaves the person.
  assert.equal(await unlinkInstallation(a, b.id, NOW), true);
  assert.equal((await personOf(a)).id, pa);
  await deleteBuilder(b.id, NOW);
  assert.equal((await sql()`SELECT builder_id FROM people WHERE id = ${pa}`)[0].builder_id, null);
  assert.equal((await personOf(a)).id, pa);
});

test('I2 (v6.1.21): a first link of a name-flagged installation makes the builder a fresh, unflagged person', async () => {
  const b = await upsertBuilder(user(9011, 'realbuilder'), NOW);
  const a = await install('Personal-test agent');
  const old = await personOf(a);
  assert.equal(old.test_reason, 'test');
  await linkInstallation(a, b.id, NOW);
  const now = await personOf(a);
  assert.notEqual(now.id, old.id);
  assert.equal(now.builder_id, b.id);
  assert.equal(now.test_reason, null);
});

test('I2 (v6.1.21): an env-list reason does reach the builder at link', async () => {
  const a = await install('Claude Code');
  process.env.EARNKIT_TEST_INSTALLATIONS = String(a);
  try {
    const b = await upsertBuilder(user(9012, 'listed'), NOW);
    await linkInstallation(a, b.id, NOW);
    const p = await personOf(a);
    assert.equal(p.builder_id, b.id);
    assert.equal(p.test_reason, 'test');
    assert.equal(p.test_reason_source, 'EARNKIT_TEST_INSTALLATIONS');
  } finally {
    delete process.env.EARNKIT_TEST_INSTALLATIONS;
  }
});

test('M2 (v6.1.21): two concurrent first links to one builder make one person', async () => {
  const b = await upsertBuilder(user(9013, 'racer'), NOW);
  const a1 = await install('Claude Code');
  const a2 = await install('Cursor');
  await Promise.all([linkInstallation(a1, b.id, NOW), linkInstallation(a2, b.id, NOW)]);
  const [p1, p2] = [await personOf(a1), await personOf(a2)];
  assert.equal(p1.id, p2.id);
  assert.equal(p1.builder_id, b.id);
  assert.equal((await sql()`SELECT count(*)::int AS c FROM people WHERE builder_id = ${b.id}`)[0].c, 1);
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
  // Old-only fields are unavailable (NULL), never 0 or false.
  for (const c of ['wallet', 'wallet_recipient', 'wallet_proven_at', 'wallet_first_tx_at', 'wallet_funder', 'funded_by_slug', 'points_total', 'points_weeks', 'last_points_week', 'referred_installs', 'shipping_score', 'shipping_rank', 'rank_total', 'streak_weeks', 'commit_weeks_12', 'last_commit_week', 'last_approved_week', 'coin_symbol', 'coin_url', 'coin_address', 'coin_backers', 'creator_fees_eth', 'programs_accepted', 'checkin_on', 'email_opted_in'])
    for (const r of rows) assert.equal((r as Record<string, unknown>)[c], null, c);
  // Typed NULLs: the columns keep the tracker's types.
  const types = Object.fromEntries((await sql()<{ column_name: string; data_type: string }[]>`
    SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'owner_people'`).map((t) => [t.column_name, t.data_type]));
  for (const c of ['points_total', 'points_weeks', 'referred_installs', 'streak_weeks', 'commit_weeks_12', 'coin_backers', 'programs_accepted', 'shipping_rank', 'rank_total'])
    assert.equal(types[c], 'integer', c);
  for (const c of ['wallet_recipient', 'checkin_on', 'email_opted_in', 'repo_private']) assert.equal(types[c], 'boolean', c);
  for (const c of ['shipping_score', 'creator_fees_eth']) assert.equal(types[c], 'numeric', c);
  for (const c of ['wallet', 'coin_symbol', 'coin_url']) assert.equal(types[c], 'text', c);
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

test('C1 (v6.1.21): EARNKIT_INSTALL_SIGNIN=github leaves authorize exactly as off, and logs that it is disabled', async () => {
  assert.equal(INSTALL_SIGNIN_ENABLED, false);
  const { client_id } = await registerClient({ redirect_uris: [CB], client_name: 'Switch Agent' });
  delete process.env.EARNKIT_INSTALL_SIGNIN;
  const off = await authorize(client_id);
  process.env.EARNKIT_INSTALL_SIGNIN = 'github';
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (m: string) => void warned.push(String(m));
  let on: Response;
  try {
    on = await authorize(client_id);
  } finally {
    console.warn = warn;
  }
  assert.equal(on.status, off.status);
  assert.equal(on.headers.get('set-cookie'), null);
  const [a, b] = [new URL(off.headers.get('location')!), new URL(on.headers.get('location')!)];
  assert.equal(b.origin + b.pathname, a.origin + a.pathname);
  assert.deepEqual([...b.searchParams.keys()].sort(), [...a.searchParams.keys()].sort());
  assert.equal(b.searchParams.get('state'), 's1');
  // The code is anonymous: the exchange makes an installation with no builder.
  assert.equal((await exchange(client_id, b.searchParams.get('code')!)).status, 200);
  const [row] = await sql()<{ builder_id: number | null }[]>`SELECT builder_id FROM installations WHERE client_name = 'Switch Agent'`;
  assert.equal(row.builder_id, null);
  // Logged at most once a process, in one line (an earlier test may have logged it already).
  assert.ok(warned.every((w) => w === '[install] install sign-in is disabled in this release'));
});

test('C1/M7 (v6.1.21): with the switch off an install state at the callback is unreachable: no sign-in, no code, no builder', async () => {
  process.env.EARNKIT_INSTALL_SIGNIN = 'github';
  const req = { client_id: 'c', redirect_uri: CB, state: 's', code_challenge: challenge };
  const state = signInstallState({ req, nonce: 'n1', exp: Date.now() + 60_000 }, SECRET);
  const gh = githubOAuthFetch({ id: 5151, login: 'victim', name: null, avatar_url: null });
  const r = await callback(state, 'ek_install=n1', gh.fetch);
  assert.equal(r.status, 400);
  assert.equal(r.headers.get('location'), null);
  const text = await r.text();
  assert.equal(text, INSTALL_FAILED);
  assert.doesNotMatch(text, /link/i);
  assert.equal((await sql()`SELECT count(*)::int AS c FROM builders WHERE login = 'victim'`)[0].c, 0);
});

test('dormant install sign-in (switch forced on in the test): GitHub first, then a code that links the installation', async () => {
  process.env.EARNKIT_INSTALL_SIGNIN = 'github';
  const { client_id } = await registerClient({ redirect_uris: [CB], client_name: 'Signed Agent' });
  const r = await authorizeGet(
    new Request(`https://earnkit.test/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CB, code_challenge: challenge, code_challenge_method: 'S256', state: 's1' })}`),
    { limit: async () => {}, installSignIn: true },
  );
  assert.equal(r.status, 302);
  const to = new URL(r.headers.get('location')!);
  assert.equal(to.origin, 'https://github.com');
  const state = to.searchParams.get('state')!;
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  assert.match(cookie, /^(__Host-)?ek_install=/);
  const cb = (c: string | null, gh: typeof fetch) =>
    callbackGet(new Request(`https://earnkit.test/auth/github/callback?code=ghc&state=${encodeURIComponent(state)}`, { headers: { 'x-real-ip': ip(), ...(c ? { cookie: c } : {}) } }), { now: new Date(), gh, installSignIn: true });
  const failed = async (res: Response) => {
    assert.equal(res.status, 400);
    assert.equal(await res.text(), INSTALL_FAILED);
  };
  // M7: no cookie, a stranger's, or a GitHub failure: the install failure page (it does not talk about linking), no code.
  await failed(await cb(null, githubOAuthFetch({ id: 4242, login: 'newbie', name: null, avatar_url: null }).fetch));
  await failed(await cb(`${cookie.split('=')[0]}=other`, githubOAuthFetch({ id: 4242, login: 'newbie', name: null, avatar_url: null }).fetch));
  await failed(await cb(cookie, githubOAuthFetch({ id: 4242, login: 'newbie', name: null, avatar_url: null }, { fail: 'token' }).fetch));
  const ok = await cb(cookie, githubOAuthFetch({ id: 4242, login: 'newbie', name: null, avatar_url: null }).fetch);
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

test('M3 (v6.1.21): a link that fails inside the exchange saves nothing and spends no code', async () => {
  // The dormant sign-in names a builder that is gone by the exchange: the link fails, the whole install rolls back.
  const { client_id } = await registerClient({ redirect_uris: [CB], client_name: 'Gone Builder Agent' });
  const b = await upsertBuilder(user(9014, 'soon-gone'), NOW);
  const req = { client_id, redirect_uri: CB, state: 's1', code_challenge: challenge };
  const { issueCode } = await import('../v5/oauth');
  const back = await issueCode(req, { builderId: b.id }, 'https://earnkit.test');
  await sql()`DELETE FROM builders WHERE id = ${b.id}`;
  await assert.rejects(exchange(client_id, back.searchParams.get('code')!));
  assert.equal((await sql()`SELECT count(*)::int AS c FROM installations WHERE client_name = 'Gone Builder Agent'`)[0].c, 0);
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
  const r = await authorizeGet(
    new Request(`https://earnkit.test/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CB, code_challenge: challenge, code_challenge_method: 'S256', state: 's1' })}`),
    { limit: async () => {}, installSignIn: true },
  );
  assert.equal(new URL(r.headers.get('location')!).origin, 'https://claude.ai');
});
