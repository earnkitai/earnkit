import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync, randomBytes } from 'node:crypto';
import { sql } from './db';
import { GitHubError } from './match-projects';
import { APP_PAGE, appJwt, appProof, appSetup, appTokenFor, githubAppEnabled, hasAppProof, installUrl, installationToken } from './github-app';
import { VERIFY_PAGE, completeVerify, createVerifyLink, csrfCookieName, peekNonce, verifiedFor, type GitHubOAuthDeps } from './github-verify';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

// A test RSA key, made here (never a real App's key).
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const OAUTH = { GITHUB_OAUTH_CLIENT_ID: 'test-client', GITHUB_OAUTH_CLIENT_SECRET: 'test-secret' };
const APP = { ...OAUTH, GITHUB_APP_ID: '123456', GITHUB_APP_SLUG: 'earnkit-read', GITHUB_APP_PRIVATE_KEY: privateKey };

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

type Call = { method: string; path: string; auth: string | null; body: unknown };
/** A fake GitHub App API: answers by "METHOD path"; records every call. */
function fakeGitHub(answers: Record<string, () => Response>, calls: Call[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    calls.push({ method, path: u.pathname + u.search, auth: headers.get('authorization'), body: init?.body ? JSON.parse(String(init.body)) : null });
    const answer = answers[`${method} ${u.pathname}${u.search}`];
    return answer ? answer() : new Response('{"message":"Not Found"}', { status: 404 });
  }) as typeof fetch;
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

/** An installation (77) of `account` listing `repos`, minting `ghs_secret_token`; `permission` for the collaborator read. */
const appApi = (o: { account: string; repos: string[]; permission?: string; login?: string; repoKey?: string }) => ({
  'GET /app/installations/77': json({ id: 77, account: { login: o.account } }),
  'POST /app/installations/77/access_tokens': json({ token: 'ghs_secret_token', expires_at: '2026-10-09T13:00:00Z' }, 201),
  'GET /installation/repositories?per_page=100': json({ total_count: o.repos.length, repositories: o.repos.map((full_name) => ({ full_name })) }),
  ...(o.permission && o.repoKey && o.login
    ? { [`GET /repos/${o.repoKey}/collaborators/${o.login}/permission`]: json({ permission: o.permission }) }
    : {}),
});

test('4.6 the App is on only with all three vars, a PEM key and the sign-in on; its JWT is RS256 for 9 minutes from now', () => {
  assert.equal(githubAppEnabled(APP), true);
  for (const missing of ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY'] as const)
    assert.equal(githubAppEnabled({ ...APP, [missing]: undefined }), false, missing);
  assert.equal(githubAppEnabled({ ...APP, GITHUB_APP_PRIVATE_KEY: 'not a key' }), false);
  assert.equal(githubAppEnabled({ ...APP, GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' }), false);
  // Pre-flight P17: the App link starts with the v2.9 sign-in, so the App is off without it.
  assert.equal(githubAppEnabled({ ...APP, GITHUB_OAUTH_CLIENT_SECRET: undefined }), false);
  // A key pasted with literal \n (one-line env var) parses too.
  assert.equal(githubAppEnabled({ ...APP, GITHUB_APP_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n') }), true);

  const now = new Date('2026-10-09T12:00:00Z');
  const jwt = appJwt(now, APP);
  const [head, body, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as { iat: number; exp: number; iss: string };
  assert.equal(claims.iss, '123456');
  assert.equal(claims.iat, now.getTime() / 1000 - 60);
  assert.equal(claims.exp - claims.iat, 600);
  assert.equal(createVerify('RSA-SHA256').update(`${head}.${body}`).verify(publicKey, Buffer.from(sig, 'base64url')), true);
  assert.ok(!jwt.includes(privateKey.slice(40, 80)), 'the key is never in the JWT');
});

test('4.7 installationToken posts the repo name and the two read permissions only; the token is never in an error', async () => {
  await withEnv(APP, async () => {
    const calls: Call[] = [];
    const token = await installationToken(77, 'tipjar', { fetch: fakeGitHub(appApi({ account: 'alice', repos: [] }), calls) });
    assert.equal(token, 'ghs_secret_token');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].path, '/app/installations/77/access_tokens');
    assert.deepEqual(calls[0].body, { repositories: ['tipjar'], permissions: { contents: 'read', metadata: 'read' } });
    assert.match(calls[0].auth ?? '', /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/, 'the App JWT');
    // A refusal carries the status only: never the token, the JWT, the key or GitHub's body.
    const refused = fakeGitHub({ 'POST /app/installations/77/access_tokens': json({ message: 'ghs_secret_token leaked?' }, 401) }, calls);
    await assert.rejects(installationToken(77, 'tipjar', { fetch: refused }), (err: unknown) => {
      assert.ok(err instanceof GitHubError);
      assert.equal(err.message, 'GitHub App request failed (401)');
      assert.doesNotMatch(err.message, /ghs_|BEGIN|Bearer/);
      return true;
    });
  });
});

test('4.8 appProof: the installation is the login\'s own account, or the login is the repo\'s admin; and it lists the repo', async () => {
  await withEnv(APP, async () => {
    const proof = (login: string, repoKey: string, api: Record<string, () => Response>) =>
      appProof({ installationId: 77, login, repoKey }, { fetch: fakeGitHub(api) });
    // The account is the builder's (any case), and the repo is listed.
    assert.deepEqual(await proof('Alice', 'alice/tipjar', appApi({ account: 'alice', repos: ['Alice/TipJar'] })), { ok: true });
    // An org installation: the builder's collaborator permission decides.
    const org = (permission: string) => appApi({ account: 'acme', repos: ['acme/app'], permission, login: 'bob', repoKey: 'acme/app' });
    assert.deepEqual(await proof('bob', 'acme/app', org('admin')), { ok: true });
    assert.deepEqual(await proof('bob', 'acme/app', org('write')), { ok: false, reason: 'not_yours' });
    // No permission answer (not a collaborator): not theirs.
    assert.deepEqual(await proof('bob', 'acme/app', appApi({ account: 'acme', repos: ['acme/app'] })), { ok: false, reason: 'not_yours' });
    // The repo is missing from the installation's list, or GitHub refuses a token for it.
    assert.deepEqual(await proof('alice', 'alice/tipjar', appApi({ account: 'alice', repos: ['alice/other'] })), { ok: false, reason: 'not_listed' });
    const noToken = { ...appApi({ account: 'alice', repos: [] }), 'POST /app/installations/77/access_tokens': json({ message: 'no' }, 422) };
    assert.deepEqual(await proof('alice', 'alice/tipjar', noToken), { ok: false, reason: 'not_listed' });
  });
});

// ---- Against the database

const stamp = () => `${process.pid}-${Date.now()}-${randomBytes(3).toString('hex')}`;
async function fixture(tag: string, o: { shared?: boolean } = {}) {
  const s = stamp();
  const [{ id: inst }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, shared_client) VALUES (${`ga-${tag}-${s}`}, ${o.shared ?? false}) RETURNING id`;
  return { inst, repoKey: `alice/ga-${tag}-${s}`.toLowerCase() };
}
const oauth = (login: string): GitHubOAuthDeps => ({
  exchange: async () => 'gho_token',
  user: async () => ({ login, created_at: '2020-01-01T00:00:00Z', public_repos: 3 }),
  repoPerms: async () => null,
});
const setupAt = (q: string, cookie?: string) =>
  new Request(`https://earnkit.com/github/verify/app?${q}`, cookie ? { headers: { cookie } } : {});
const limit = { limit: async () => {} };

test('4.9 appSetup: the browser cookie first, then the nonce once; a passing proof writes one via=app verification', db, async () => {
  await withEnv(APP, async () => {
    const f = await fixture('setup');
    const link = await createVerifyLink({ installationId: f.inst, projectId: null, repoKey: f.repoKey, purpose: 'app' });
    const nonce = new URL(link).searchParams.get('n')!;
    // The OAuth hop stores the login on the nonce (not consumed).
    const hop = await completeVerify('code', nonce, oauth('Alice'));
    assert.deepEqual(hop, { ok: true, repoKey: f.repoKey, install: installUrl('earnkit-read', nonce) });
    const fetch = fakeGitHub(appApi({ account: 'alice', repos: [f.repoKey] }));
    const q = `installation_id=77&setup_action=install&state=${encodeURIComponent(nonce)}`;
    const cookie = `${csrfCookieName(nonce)}=K1`;

    // No cookie (another browser): refused before the nonce is used.
    const noCookie = await appSetup(setupAt(q), { ...limit, fetch });
    assert.equal(noCookie.status, 403);
    assert.equal(await peekNonce(nonce), true, 'the nonce is untouched');
    // An installation id that isn't a number: refused, nonce untouched.
    const badId = await appSetup(setupAt(`installation_id=77abc&state=${encodeURIComponent(nonce)}`, cookie), { ...limit, fetch });
    assert.equal(badId.status, 400);
    assert.equal(await peekNonce(nonce), true);
    assert.equal((await sql()`SELECT 1 FROM github_verifications WHERE installation_id = ${f.inst}`).length, 0);

    const ok = await appSetup(setupAt(q, cookie), { ...limit, fetch });
    assert.equal(ok.status, 200);
    assert.ok((await ok.text()).includes(VERIFY_PAGE.done));
    assert.match(ok.headers.get('set-cookie') ?? '', /Max-Age=0/, 'the cookie is cleared');
    const rows = await sql()<{ via: string; github_installation_id: string; purpose: string; login: string; repo_key: string; wallet: string | null; public_repos: number }[]>`
      SELECT via, github_installation_id::text, purpose, login, repo_key, wallet, public_repos FROM github_verifications WHERE installation_id = ${f.inst}`;
    assert.deepEqual(rows.map((r) => ({ ...r })), [
      { via: 'app', github_installation_id: '77', purpose: 'app', login: 'alice', repo_key: f.repoKey, wallet: null, public_repos: 3 },
    ]);
    // R9 (Pre-flight P11): an App row never stands in for a sign-in.
    assert.equal(await verifiedFor({ installationId: f.inst, repoKey: f.repoKey }), null);
    assert.ok(await verifiedFor({ installationId: f.inst, repoKey: f.repoKey, purpose: 'app' }));

    // The same nonce again: refused.
    const again = await appSetup(setupAt(q, cookie), { ...limit, fetch });
    assert.equal(again.status, 410);
    assert.equal((await sql()`SELECT 1 FROM github_verifications WHERE installation_id = ${f.inst}`).length, 1);
    // Final fix I2: hasAppProof sees this proof (any login off a shared client, the proving login on
    // one), never another login's, and a shared client with no verified caller has none.
    assert.equal(await hasAppProof({ installationId: f.inst, repoKey: f.repoKey }), true);
    assert.equal(await hasAppProof({ installationId: f.inst, login: 'alice', repoKey: f.repoKey.toUpperCase() }), true);
    assert.equal(await hasAppProof({ installationId: f.inst, login: 'mallory', repoKey: f.repoKey }), false);
    assert.equal(await hasAppProof({ installationId: f.inst, login: null, repoKey: f.repoKey }), false);
    assert.equal(await hasAppProof({ installationId: f.inst, repoKey: 'alice/other' }), false);
  });
});

test('4.9b appSetup refuses a nonce that skipped the OAuth hop or isn\'t an App nonce, and a proof that fails', db, async () => {
  await withEnv(APP, async () => {
    const f = await fixture('refuse');
    const fetch = fakeGitHub(appApi({ account: 'mallory', repos: [f.repoKey] }));
    const nonceOf = async (purpose: 'app' | 'host') =>
      new URL(await createVerifyLink({ installationId: f.inst, projectId: null, repoKey: f.repoKey, purpose })).searchParams.get('n')!;
    const run = (nonce: string) =>
      appSetup(setupAt(`installation_id=77&state=${encodeURIComponent(nonce)}`, `${csrfCookieName(nonce)}=K1`), { ...limit, fetch });
    // No login stored yet (the sign-in was skipped): refused, and the nonce is left for the sign-in.
    const fresh = await nonceOf('app');
    assert.equal((await run(fresh)).status, 410);
    assert.equal(await peekNonce(fresh), true);
    // A host sign-in nonce is never taken here.
    const host = await nonceOf('host');
    assert.equal((await run(host)).status, 410);
    assert.equal(await peekNonce(host), true);
    // An installation on another account, and alice isn't an admin there: not hers.
    assert.equal((await completeVerify('code', fresh, oauth('alice'))).ok, true);
    const res = await run(fresh);
    assert.equal(res.status, 403);
    assert.ok((await res.text()).includes(APP_PAGE.notYours.replace(/'/g, '&#39;')));
    assert.equal((await sql()`SELECT 1 FROM github_verifications WHERE installation_id = ${f.inst}`).length, 0);
  });
});

test('4.9c on a shared client the App page shows the one-time code (G9); appTokenFor reads only the caller\'s own proof', db, async () => {
  await withEnv(APP, async () => {
    const f = await fixture('shared', { shared: true });
    const nonce = new URL(await createVerifyLink({ installationId: f.inst, projectId: null, repoKey: f.repoKey, purpose: 'app' })).searchParams.get('n')!;
    await completeVerify('code', nonce, oauth('alice'));
    const fetch = fakeGitHub(appApi({ account: 'alice', repos: [f.repoKey] }));
    const res = await appSetup(setupAt(`installation_id=77&state=${encodeURIComponent(nonce)}`, `${csrfCookieName(nonce)}=K1`), { ...limit, fetch });
    assert.match(await res.text(), /Paste this code to your agent: [A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{2}/);
    const calls: Call[] = [];
    // v2.13.3 review M4: the installation is looked up by repo before the mint.
    const tokenFetch = fakeGitHub({ ...appApi({ account: 'alice', repos: [f.repoKey] }), [`GET /repos/${f.repoKey}/installation`]: json({ id: 77 }) }, calls);
    assert.equal(await appTokenFor({ installationId: f.inst, login: 'alice', repoKey: f.repoKey }, { fetch: tokenFetch }), 'ghs_secret_token');
    assert.deepEqual(calls.filter((c) => c.method === 'POST').map((c) => c.body), [{ repositories: [f.repoKey.split('/')[1]], permissions: { contents: 'read', metadata: 'read' } }]);
    assert.equal(await appTokenFor({ installationId: f.inst, login: 'bob', repoKey: f.repoKey }, { fetch: tokenFetch }), null, 'another caller');
    assert.equal(await appTokenFor({ installationId: f.inst, login: null, repoKey: f.repoKey }, { fetch: tokenFetch }), null, 'no caller');
    assert.equal(await appTokenFor({ installationId: f.inst, repoKey: 'alice/other' }, { fetch: tokenFetch }), null, 'another repo');
  });
  // The App off: no token, no link.
  const f = await fixture('off');
  assert.equal(await appTokenFor({ installationId: f.inst, repoKey: f.repoKey }), null);
  await assert.rejects(createVerifyLink({ installationId: f.inst, projectId: null, repoKey: f.repoKey, purpose: 'app' }), /App is off/);
  assert.equal((await appSetup(setupAt('installation_id=77&state=x'))).status, 404);
});
