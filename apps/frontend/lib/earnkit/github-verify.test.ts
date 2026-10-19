import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import {
  APP_CONFIRM_ONLY_YOURS,
  VERIFY_PAGE,
  VERIFY_TTL_MS,
  codeLine,
  csrfCookieName,
  formatCode,
  normalizeCode,
  verifyConfirm,
  completeVerify,
  createVerifyLink,
  githubOAuth,
  githubVerifyEnabled,
  peekNonce,
  takeNonce,
  verifyCallback,
  verifyStart,
  type GitHubOAuthDeps,
  loginBasisFor,
} from './github-verify';
import { appEnv } from './fixtures/app-install';

process.env.EARNKIT_AUTH_SECRET ??= 'github-verify-test-secret';
// v2.14 spec 2: the only link is the read-only App's (its sign-in hop needs GitHub sign-in on).
appEnv();

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

// ---- Pure

test('5.2 the feature is on only with both OAuth variables', () => {
  assert.equal(githubVerifyEnabled({}), false);
  assert.equal(githubVerifyEnabled({ GITHUB_OAUTH_CLIENT_ID: 'id' }), false);
  assert.equal(githubVerifyEnabled({ GITHUB_OAUTH_CLIENT_SECRET: 'secret' }), false);
  assert.equal(githubVerifyEnabled({ GITHUB_OAUTH_CLIENT_ID: 'id', GITHUB_OAUTH_CLIENT_SECRET: 'secret' }), true);
});

test('the routes answer 404 while the feature is off (the old behaviour)', async () => {
  await withEnv({ GITHUB_OAUTH_CLIENT_ID: undefined, GITHUB_OAUTH_CLIENT_SECRET: undefined }, async () => {
    assert.equal((await verifyStart(new Request('https://earnkit.com/github/verify?n=x'))).status, 404);
    assert.equal((await verifyCallback(new Request('https://earnkit.com/github/verify/callback?code=c&state=x'))).status, 404);
  });
});

test('5.5 the callback route reads only code and state (the repo is the nonce\'s)', async () => {
  await withEnv(ON, async () => {
    const seen: [string, string][] = [];
    const res = await verifyCallback(
      new Request('https://earnkit.com/github/verify/callback?code=C1&state=S1.K1&repo=mallory/x&repo_key=mallory/x&project_id=9', {
        headers: { cookie: `${csrfCookieName('S1')}=K1` },
      }),
      async (code, nonce) => {
        seen.push([code, nonce]);
        return { ok: true, repoKey: 'alice/tipjar' };
      },
      { limit: async () => {} },
    );
    assert.deepEqual(seen, [['C1', 'S1']]);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(await res.text(), new RegExp(VERIFY_PAGE.done.replace('.', '\\.')));
    assert.match(res.headers.get('set-cookie') ?? '', /^__Host-ekv-[0-9a-f]{16}=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Lax$/, 'cleared');
    // The callback's own source reads no other parameter (the cookie through cookieValue).
    const src = readFileSync(join(import.meta.dirname, 'github-verify.ts'), 'utf8');
    const body = src.slice(src.indexOf('export async function verifyCallback'));
    const params = [...body.matchAll(/\.get\('([^']+)'\)/g)].map((m) => m[1]).sort();
    assert.deepEqual(params, ['code', 'state']);
  });
});

test('G8: a missing or mismatched cookie is refused before the nonce is used or the code exchanged', async () => {
  await withEnv(ON, async () => {
    let called = 0;
    const complete = async () => {
      called++;
      return { ok: true as const, repoKey: 'alice/tipjar' };
    };
    const limit = { limit: async () => {} };
    const at = (state: string, cookie?: string) =>
      new Request(`https://earnkit.com/github/verify/callback?code=C&state=${state}`, cookie ? { headers: { cookie } } : {});
    for (const req of [
      at('N1.K1'),
      at('N1.K1', `${csrfCookieName('N1')}=K2`),
      at('N1.K1', `${csrfCookieName('N2')}=K1`),
      at('N1', `${csrfCookieName('N1')}=K1`),
      at('.K1', `${csrfCookieName('')}=K1`),
    ]) {
      const res = await verifyCallback(req, complete, limit);
      assert.equal(res.status, 403);
      assert.match(await res.text(), /Sign-in didn&#39;t finish/);
    }
    assert.equal(called, 0, 'never reached takeNonce or the exchange');
    // The confirm POST checks the same binding before sending anyone to GitHub.
    const post = (cookie: string | null, csrf: string) =>
      verifyConfirm(
        new Request('https://earnkit.com/github/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie && { cookie }) },
          body: new URLSearchParams({ n: 'N1', csrf }),
        }),
        limit,
      );
    assert.equal((await post(null, 'K1')).status, 403);
    assert.equal((await post(`${csrfCookieName('N1')}=K2`, 'K1')).status, 403);
    const cross = await verifyConfirm(
      new Request('https://earnkit.com/github/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example', cookie: `${csrfCookieName('N1')}=K1` },
        body: new URLSearchParams({ n: 'N1', csrf: 'K1' }),
      }),
      limit,
    );
    assert.equal(cross.status, 403, 'another origin');
  });
});

test('G9: the code is 10 base32 characters, shown as ABCD-EFGH-JK, read in any case with dashes', () => {
  assert.equal(formatCode('ABCDEFGHJK'), 'ABCD-EFGH-JK');
  assert.equal(normalizeCode('abcd-efgh-jk'), 'ABCDEFGHJK');
  assert.equal(normalizeCode(' ABCD EFGH JK '), 'ABCDEFGHJK');
  assert.equal(normalizeCode('ABCD-EFGH'), null);
  assert.equal(normalizeCode('ABCD-EFGH-J1'), null, '1 is not base32');
  assert.equal(normalizeCode(undefined), null);
  assert.equal(codeLine('ABCDEFGHJK'), 'Done. Paste this code to your agent: ABCD-EFGH-JK');
});

// ---- With the database

const ON = { GITHUB_OAUTH_CLIENT_ID: 'test-client', GITHUB_OAUTH_CLIENT_SECRET: 'test-secret' };
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

const stamp = () => `${process.pid}-${Date.now()}-${randomBytes(3).toString('hex')}`;
type Fixture = { inst: number; repoKey: string; handle: string };
/** A person with a page (an X-claimed profile): preflight S7, App links are only made for one. */
async function fixture(tag: string, o: { shared?: boolean; page?: boolean } = {}): Promise<Fixture> {
  const s = stamp();
  const [{ id: inst }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, shared_client) VALUES (${`gv-${tag}-${s}`}, ${o.shared ?? false}) RETURNING id`;
  const handle = `gv${inst}`;
  if (o.page !== false)
    await sql()`INSERT INTO builder_profiles (builder_id, slug, x_user_id, x_handle) VALUES (${inst}, ${`gv-${inst}`}, ${`88${inst}`}, ${handle})`;
  return { inst, repoKey: `alice/gv-${tag}-${s}`.toLowerCase(), handle };
}
const linkNonce = async (f: Fixture, now = new Date()) =>
  new URL(await createVerifyLink({ installationId: f.inst, projectId: null, repoKey: f.repoKey, purpose: 'app' }, now)).searchParams.get('n')!;
const github = (login: string, calls: string[] = []): GitHubOAuthDeps => ({
  exchange: async () => {
    calls.push('exchange');
    return 'gho_token';
  },
  user: async () => {
    calls.push('user');
    return { login, created_at: '2020-01-01T00:00:00Z', public_repos: 3 };
  },
  repoPerms: async () => {
    calls.push('repo');
    return null;
  },
});

test('5.7 a failing exchange logs no client secret, code, token or nonce', async () => {
  await withEnv({ ...ON, GITHUB_OAUTH_CLIENT_SECRET: 'super-secret-value' }, async () => {
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.map((x) => (x instanceof Error ? `${x.name} ${x.message} ${x.stack}` : String(x))).join(' '));
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      await assert.rejects(githubOAuth.exchange('the-code-123'), (err: Error) => {
        assert.doesNotMatch(err.message, /super-secret-value|the-code-123/);
        return true;
      });
      if (process.env.DATABASE_URL) {
        const nonce = await linkNonce(await fixture('secret'));
        const out = await completeVerify('the-code-123', nonce, { ...githubOAuth });
        assert.deepEqual(out, { ok: false, reason: VERIFY_PAGE.failed });
        assert.ok(logged.length > 0, 'the failure is logged');
        for (const l of logged) assert.doesNotMatch(l, new RegExp(`super-secret-value|the-code-123|gho_|${nonce}`));
      }
    } finally {
      console.error = orig;
      globalThis.fetch = origFetch;
    }
  });
});

test('the link: siteUrl origin, a 43-character nonce, only its sha256 stored', db, async () => {
  const f = await fixture('link');
  const link = await createVerifyLink({ installationId: f.inst, projectId: null, repoKey: f.repoKey, purpose: 'app' });
  assert.match(link, /^https:\/\/earnkit\.com\/github\/verify\?n=[A-Za-z0-9_-]{43}$/);
  const nonce = new URL(link).searchParams.get('n')!;
  const rows = await sql()<{ nonce_hash: string }[]>`SELECT nonce_hash FROM github_verify_nonces WHERE installation_id = ${f.inst}`;
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].nonce_hash, nonce);
  assert.match(rows[0].nonce_hash, /^[0-9a-f]{64}$/);
  assert.equal((await sql()`SELECT 1 FROM github_verify_nonces WHERE nonce_hash = ${nonce}`).length, 0);
});

test('v2.14 spec 2: only the App link is made; the GitHub sign-in proof is gone', db, async () => {
  const f = await fixture('purposes');
  for (const purpose of ['entry', 'pickup', 'host', 'claim'] as const)
    await assert.rejects(createVerifyLink({ installationId: f.inst, projectId: null, repoKey: f.repoKey, purpose, wallet: `0x${'1'.repeat(40)}` }), /Only the read-only GitHub App link/);
  // A v2.9 sign-in link made before v2.14 (a stored entry nonce) answers "expired" and is left untouched.
  const nonce = randomBytes(32).toString('base64url');
  const { createHash } = await import('node:crypto');
  await sql()`
    INSERT INTO github_verify_nonces (nonce_hash, installation_id, repo_key, purpose, created_at, expires_at, wallet)
    VALUES (${createHash('sha256').update(nonce).digest('hex')}, ${f.inst}, ${f.repoKey}, 'entry', now(), now() + interval '10 minutes', ${`0x${'1'.repeat(40)}`})`;
  const calls: string[] = [];
  assert.deepEqual(await completeVerify('code', nonce, github('alice', calls)), { ok: false, reason: VERIFY_PAGE.expired });
  assert.deepEqual(calls, [], 'no exchange, no read');
  assert.equal(await peekNonce(nonce), true, 'never consumed');
  assert.equal((await verifyStart(new Request(`https://earnkit.com/github/verify?n=${nonce}`), { limit: async () => {} })).status, 410, 'no confirm page');
  assert.equal((await sql()`SELECT 1 FROM github_verifications WHERE installation_id = ${f.inst}`).length, 0);
});

test('preflight S7: no App link for a person with no page, nor for a shared client', db, async () => {
  const anon = await fixture('anon', { page: false });
  await assert.rejects(createVerifyLink({ installationId: anon.inst, projectId: null, repoKey: anon.repoKey, purpose: 'app' }), /handle/);
  const shared = await fixture('shared', { shared: true });
  await assert.rejects(createVerifyLink({ installationId: shared.inst, projectId: null, repoKey: shared.repoKey, purpose: 'app' }), /handle/);
  // A page that lost its handle after the link was made shows no confirm page.
  const f = await fixture('gone');
  const nonce = await linkNonce(f);
  await sql()`UPDATE builder_profiles SET x_handle = NULL WHERE builder_id = ${f.inst}`;
  assert.equal((await verifyStart(new Request(`https://earnkit.com/github/verify?n=${nonce}`), { limit: async () => {} })).status, 410);
});

test('5.3 a nonce is single-use, also under two concurrent setups', db, async () => {
  const f = await fixture('once');
  const nonce = await linkNonce(f);
  const first = await takeNonce(nonce);
  assert.deepEqual(first, {
    installation_id: f.inst, project_id: null, repo_key: f.repoKey, purpose: 'app', wallet: null, symbol: null,
    login: null, account_created_at: null, public_repos: null,
  });
  assert.equal(await takeNonce(nonce), null);
  const race = await linkNonce(f);
  const both = await Promise.all([takeNonce(race), takeNonce(race)]);
  assert.equal(both.filter(Boolean).length, 1);
});

test('5.4 at 14 min 59 s the link works; at 15 min it has expired', db, async () => {
  const f = await fixture('ttl');
  const t0 = new Date('2026-10-08T10:00:00Z');
  const nonce = await linkNonce(f, t0);
  assert.equal(await peekNonce(nonce, new Date(t0.getTime() + VERIFY_TTL_MS - 1000)), true);
  const at15 = new Date(t0.getTime() + VERIFY_TTL_MS);
  assert.equal(await peekNonce(nonce, at15), false);
  assert.equal(await takeNonce(nonce, at15), null);
  assert.deepEqual(await completeVerify('code', nonce, github('alice'), at15), { ok: false, reason: VERIFY_PAGE.expired });
});

test('G8, S7: the link shows a confirm page (repo, the page it is added to, warning), never a redirect; its POST goes to GitHub with state = nonce.csrf', db, async () => {
  const f = await fixture('confirm');
  const nonce = await linkNonce(f);
  const limit = { limit: async () => {} };
  const page = await verifyStart(new Request(`https://evil.example/github/verify?n=${nonce}`), limit);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('location'), null, 'never a redirect');
  const html = await page.text();
  assert.match(html, new RegExp(`Repo: github\\.com/${f.repoKey}`));
  assert.ok(html.includes(`This adds github.com/${f.repoKey} to earnkit.com/${f.handle}.`), html);
  assert.ok(html.includes(APP_CONFIRM_ONLY_YOURS));
  assert.match(html, /<form method="post" action="https:\/\/earnkit\.com\/github\/verify">/, 'siteUrl, never the request host');
  assert.doesNotMatch(html, /evil\.example|<script/);
  // Review Minor 1: same-origin, never no-referrer, so the browser's POST carries a real Origin.
  assert.equal(page.headers.get('referrer-policy'), 'same-origin');
  const cookie = page.headers.get('set-cookie') ?? '';
  assert.match(cookie, new RegExp(`^${csrfCookieName(nonce)}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax$`));
  const csrf = cookie.split(';')[0].split('=')[1];
  assert.ok(html.includes(`name="csrf" value="${csrf}"`));
  assert.equal(await peekNonce(nonce), true, 'showing the page uses nothing');
  const go = await verifyConfirm(
    new Request('https://earnkit.com/github/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://earnkit.com', cookie: `${csrfCookieName(nonce)}=${csrf}` },
      body: new URLSearchParams({ n: nonce, csrf }),
    }),
    limit,
  );
  assert.equal(go.status, 303);
  const to = new URL(go.headers.get('location')!);
  assert.equal(to.origin + to.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(to.searchParams.get('state'), `${nonce}.${csrf}`);
  assert.equal(to.searchParams.get('redirect_uri'), 'https://earnkit.com/github/verify/callback');
  assert.equal(to.searchParams.get('client_id'), process.env.GITHUB_OAUTH_CLIENT_ID);
  assert.equal(to.searchParams.get('scope'), null);
  assert.equal(to.searchParams.get('allow_signup'), 'false');
  assert.doesNotMatch(go.headers.get('location')!, new RegExp(process.env.GITHUB_OAUTH_CLIENT_SECRET!));
});

test('4.10 an App nonce\'s callback stores the login on the nonce, writes no verification, keeps the cookie and 303s to the install page', db, async () => {
  const { installUrl } = await import('./github-app');
  const f = await fixture('app');
  // With the App off, no App nonce can be made.
  await withEnv({ GITHUB_APP_ID: undefined }, async () => {
    await assert.rejects(createVerifyLink({ installationId: f.inst, projectId: null, repoKey: f.repoKey, purpose: 'app' }), /App is off/);
  });
  const link = await createVerifyLink({ installationId: f.inst, projectId: null, repoKey: f.repoKey, purpose: 'app' });
  const nonce = new URL(link).searchParams.get('n')!;
  const page = await verifyStart(new Request(link), { limit: async () => {} });
  assert.match(await page.text(), /let EarnKit read this repo/);
  const back = await verifyCallback(
    new Request(`https://earnkit.com/github/verify/callback?code=C&state=${nonce}.K1`, { headers: { cookie: `${csrfCookieName(nonce)}=K1` } }),
    (code, n) => completeVerify(code, n, github('Alice')),
    { limit: async () => {} },
  );
  assert.equal(back.status, 303);
  assert.equal(back.headers.get('location'), installUrl(process.env.GITHUB_APP_SLUG!, nonce));
  assert.equal(back.headers.get('set-cookie'), null, 'the cookie stays for the setup URL');
  assert.equal(await peekNonce(nonce), true, 'not consumed');
  const [row] = await sql()<{ login: string; public_repos: number; created: boolean }[]>`
    SELECT n.login, n.public_repos, n.account_created_at IS NOT NULL AS created FROM github_verify_nonces n
    WHERE n.installation_id = ${f.inst} AND n.purpose = 'app'`;
  assert.deepEqual({ ...row }, { login: 'alice', public_repos: 3, created: true });
  assert.equal((await sql()`SELECT 1 FROM github_verifications WHERE installation_id = ${f.inst}`).length, 0);
  // A second OAuth hop on the same nonce can't replace the login.
  assert.deepEqual(await completeVerify('code', nonce, github('mallory')), { ok: false, reason: VERIFY_PAGE.expired });
  const [kept] = await sql()<{ login: string }[]>`SELECT login FROM github_verify_nonces WHERE installation_id = ${f.inst} AND purpose = 'app'`;
  assert.equal(kept.login, 'alice');
});

test('concern 4 (fix round 1): an open link is shown again for the same repo and person; a used or nearly expired one is not', db, async () => {
  const f = await fixture('reuse');
  const t0 = new Date();
  const link = (o: Partial<Parameters<typeof createVerifyLink>[0]> = {}, now = t0) =>
    createVerifyLink({ installationId: f.inst, projectId: null, repoKey: f.repoKey, purpose: 'app', ...o }, now);
  const first = await link();
  assert.equal(await link(), first, 'reused');
  assert.equal(await link({ repoKey: f.repoKey.toUpperCase() }), first, 'same repo, any case');
  assert.notEqual(await link({ repoKey: `${f.repoKey}-2` }), first, 'another repo');
  // Less than 5 minutes left: a new link.
  assert.notEqual(await link({}, new Date(t0.getTime() + VERIFY_TTL_MS - 4 * 60_000)), first);
  // Used: a new link.
  const again = await link();
  assert.ok(await takeNonce(new URL(again).searchParams.get('n')!));
  assert.notEqual(await link(), again);
});

test('concern 4 (fix round 1): the hourly cron deletes links expired over a day ago, in a bounded batch', db, async () => {
  const { sweepVerifyNonces } = await import('./github-verify');
  const f = await fixture('sweep');
  const day = 86_400_000;
  const old = new Date(Date.now() - 3 * day);
  for (let i = 0; i < 3; i++) await createVerifyLink({ installationId: f.inst, projectId: null, repoKey: `${f.repoKey}-${i}`, purpose: 'app' }, old);
  const recent = await createVerifyLink({ installationId: f.inst, projectId: null, repoKey: f.repoKey, purpose: 'app' }, new Date(Date.now() - VERIFY_TTL_MS - 60_000));
  const count = async () => (await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM github_verify_nonces WHERE installation_id = ${f.inst}`)[0].n;
  assert.equal(await count(), 4);
  // Bounded: at most `limit` a run (other test rows may also be old, so only an upper bound is checked).
  assert.ok((await sweepVerifyNonces(new Date(), 1)) <= 1);
  const { runCron } = await import('./cron');
  const out = await runCron({ only: ['none'], deps: { cleanup: { limit: 1000 }, refreshFees: async () => 0 } });
  assert.ok('cleanup' in out && typeof (out.cleanup as { nonces: number }).nonces === 'number');
  assert.equal(await count(), 1, 'only the link expired under a day ago is kept');
  assert.equal(await peekNonce(new URL(recent).searchParams.get('n')!), false, 'expired, but kept');
});

// ---- v2.11 T3 (3.8): loginBasisFor

test('3.8 loginBasisFor: a v2.9 sign-in (over the App), the App, null otherwise; the proof line names no one (v2.14)', db, async () => {
  const tag = `lb${process.pid}${Date.now().toString(36)}`;
  const inst = async (o: { shared?: boolean; githubUser?: string } = {}) =>
    (await sql()<{ id: number }[]>`
      INSERT INTO installations (token_hash, shared_client, github_user) VALUES (${`${tag}-${randomBytes(4).toString('hex')}`}, ${o.shared ?? false}, ${o.githubUser ?? null})
      RETURNING id`)[0].id;
  const verify = (id: number, repoKey: string, login: string, via: 'oauth' | 'app' = 'oauth', projectId: number | null = null) => sql()`
    INSERT INTO github_verifications (repo_key, login, installation_id, project_id, account_created_at, public_repos, purpose, via)
    VALUES (${repoKey}, ${login}, ${id}, ${projectId}, now(), 3, ${via === 'app' ? 'app' : 'entry'}, ${via})`;
  const repo = (n: string) => `${tag}/${n}`;
  const a = await inst({ githubUser: tag });
  await verify(a, repo('both'), 'Alice', 'app');
  await verify(a, repo('both'), 'alice');
  assert.deepEqual(await loginBasisFor(a, repo('both')), { login: 'alice', basis: 'signin' }, 'a sign-in wins over the App');
  await verify(a, repo('app'), 'alice', 'app');
  assert.deepEqual(await loginBasisFor(a, repo('app').toUpperCase()), { login: 'alice', basis: 'app' });
  // v2.14: a deploy row's recorded line owner names no one any more.
  await sql()`
    INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, status, cost_micro_usd, line_owner)
    VALUES (${a}, ${`installation:${a}`}, ${repo('deployed')}, 'arc', '0x01', 'deployed', 1, ${tag})`;
  assert.equal(await loginBasisFor(a, repo('deployed')), null);
  // Neither: null, never GITHUB_TOKEN's login or the login an agent reported.
  const old = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'ghp_test_never_used';
  try {
    const b = await inst({ githubUser: 'mallory' });
    assert.equal(await loginBasisFor(b, repo('none')), null);
    await verify(b, repo('other'), 'bob');
    assert.equal(await loginBasisFor(b, repo('none')), null, "another repo's sign-in says nothing about this one");
  } finally {
    if (old === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = old;
  }
  assert.equal(await loginBasisFor(a, 'no-slash'), null);
  assert.equal(await loginBasisFor(a, 'a/b/c'), null);
});

test('3.8 loginBasisFor on a shared client: only the caller\'s own verification or the entry\'s', db, async () => {
  const tag = `lbs${process.pid}${Date.now().toString(36)}`;
  const [{ id: s }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, shared_client) VALUES (${tag}, true) RETURNING id`;
  const repoKey = `${tag}/app`;
  await sql()`
    INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose)
    VALUES (${repoKey}, 'bob', ${s}, now(), 3, 'pickup')`;
  assert.equal(await loginBasisFor(s, repoKey), null, 'no caller: no login');
  assert.equal(await loginBasisFor(s, repoKey, { callerLogin: 'carol' }), null, "another builder's sign-in never names this caller");
  assert.deepEqual(await loginBasisFor(s, repoKey, { callerLogin: 'Bob' }), { login: 'bob', basis: 'signin' });
});
