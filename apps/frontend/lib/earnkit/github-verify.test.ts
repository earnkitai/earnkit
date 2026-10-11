import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import {
  CODE_TTL_MS,
  CONFIRM_WARNING,
  VERIFY_PAGE,
  VERIFY_TTL_MS,
  callerLogin,
  codeLine,
  csrfCookieName,
  formatCode,
  normalizeCode,
  verifyConfirm,
  completeVerify,
  createVerifyLink,
  githubOAuth,
  githubVerifyEnabled,
  ownershipPasses,
  peekNonce,
  takeHostVerification,
  takeNonce,
  verifiedEntryIds,
  verifiedFor,
  verifyCallback,
  verifyStart,
  type GitHubOAuthDeps,
  loginBasisFor,
} from './github-verify';
import { SIGN_IN_FIRST, WALLET_CHANGED, tokenGate, tokenLineFor, type GateDeps } from './token-gate';

process.env.EARNKIT_AUTH_SECRET ??= 'github-verify-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

// ---- Pure

test('5.1 ownership: the owner (any case), or push or admin; never without them', () => {
  const tipjar = { owner: 'alice', repo: 'tipjar' };
  assert.equal(ownershipPasses('Alice', tipjar, null), true);
  assert.equal(ownershipPasses('bob', tipjar, { push: true }), true);
  assert.equal(ownershipPasses('bob', tipjar, { admin: true }), true);
  assert.equal(ownershipPasses('bob', tipjar, { push: false }), false);
  assert.equal(ownershipPasses('bob', { owner: 'acme-org', repo: 'app' }, null), false);
});

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
        const nonce = await linkNonce(await fixture('secret'), 'pickup');
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
type Fixture = { inst: number; project: number; repoKey: string; programId: string };
async function fixture(tag: string, o: { shared?: boolean; inst?: number; owner?: string } = {}): Promise<Fixture> {
  const s = stamp();
  const inst =
    o.inst ??
    (await sql()<{ id: number }[]>`
      INSERT INTO installations (token_hash, shared_client) VALUES (${`gv-${tag}-${s}`}, ${o.shared ?? false}) RETURNING id`)[0].id;
  const programId = `gv-${tag}-${s}`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${programId}, 'X', 'P', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed')`;
  const repoKey = `${o.owner ?? 'alice'}/gv-${tag}-${s}`.toLowerCase();
  const [{ id: project }] = await sql()<{ id: number }[]>`
    INSERT INTO projects (program_id, name, installation_id, repo_url)
    VALUES (${programId}, 'Tip Jar', ${inst}, ${`https://github.com/${repoKey}`}) RETURNING id`;
  return { inst, project, repoKey, programId };
}
/** The fee wallet entry links are made for (Ruling G11), and the gate tests launch to. */
const WF = `0x${'1'.repeat(40)}`;
const linkNonce = async (f: Fixture, purpose: 'entry' | 'pickup' | 'host' = 'entry', now = new Date(), wallet = WF) => {
  const link = await createVerifyLink(
    { installationId: f.inst, projectId: purpose === 'pickup' ? null : f.project, repoKey: f.repoKey, purpose, ...(purpose === 'entry' && { wallet, symbol: 'tip' }) },
    now,
  );
  return new URL(link).searchParams.get('n')!;
};
const github = (login: string, perms: { push?: boolean; admin?: boolean } | null = null, calls: string[] = []): GitHubOAuthDeps => ({
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
    return perms;
  },
});

test('the link: siteUrl origin, a 43-character nonce, only its sha256 stored', db, async () => {
  const f = await fixture('link');
  // Ruling G11: never an entry link without the fee wallet.
  await assert.rejects(createVerifyLink({ installationId: f.inst, projectId: f.project, repoKey: f.repoKey, purpose: 'entry' }));
  const link = await createVerifyLink({ installationId: f.inst, projectId: f.project, repoKey: f.repoKey, purpose: 'entry', wallet: WF });
  assert.match(link, /^https:\/\/earnkit\.com\/github\/verify\?n=[A-Za-z0-9_-]{43}$/);
  const nonce = new URL(link).searchParams.get('n')!;
  const rows = await sql()<{ nonce_hash: string }[]>`SELECT nonce_hash FROM github_verify_nonces WHERE project_id = ${f.project}`;
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].nonce_hash, nonce);
  assert.match(rows[0].nonce_hash, /^[0-9a-f]{64}$/);
  assert.equal((await sql()`SELECT 1 FROM github_verify_nonces WHERE nonce_hash = ${nonce}`).length, 0);
});

test('5.3 a nonce is single-use, also under two concurrent callbacks', db, async () => {
  const f = await fixture('once');
  const nonce = await linkNonce(f);
  const first = await takeNonce(nonce);
  // v2.10 Pre-flight P3: the App's login and account columns are null on every other nonce.
  assert.deepEqual(first, {
    installation_id: f.inst, project_id: f.project, repo_key: f.repoKey, purpose: 'entry', wallet: WF, symbol: 'TIP',
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
  const nonce = await linkNonce(f, 'entry', t0);
  assert.equal(await peekNonce(nonce, new Date(t0.getTime() + VERIFY_TTL_MS - 1000)), true);
  const at15 = new Date(t0.getTime() + VERIFY_TTL_MS);
  assert.equal(await peekNonce(nonce, at15), false);
  assert.equal(await takeNonce(nonce, at15), null);
  assert.deepEqual(await completeVerify('code', nonce, github('alice'), at15), { ok: false, reason: VERIFY_PAGE.expired });
});

test('5.5 a login that can\'t push: notYours, no verification, the nonce used; a pass is bound to the nonce\'s repo and entry', db, async () => {
  const f = await fixture('push');
  const nonce = await linkNonce(f);
  assert.deepEqual(await completeVerify('code', nonce, github('mallory', { push: false })), { ok: false, reason: VERIFY_PAGE.notYours });
  assert.equal((await sql()`SELECT 1 FROM github_verifications WHERE installation_id = ${f.inst}`).length, 0);
  assert.equal(await peekNonce(nonce), false, 'used');
  // An org repo the scopeless token sees no permissions on: the proof line is the way (review Minor 2).
  const org = await fixture('org', { owner: 'acme-org' });
  assert.deepEqual(await completeVerify('code', await linkNonce(org), github('alice', null)), { ok: false, reason: VERIFY_PAGE.orgRepo });
  // The owner: no repo read, and the verification names the nonce's own repo and entry only.
  const calls: string[] = [];
  const ok = await completeVerify('code', await linkNonce(f), github('Alice', null, calls));
  assert.deepEqual(ok, { ok: true, repoKey: f.repoKey });
  assert.deepEqual(calls, ['exchange', 'user']);
  const rows = await sql()<{ repo_key: string; project_id: number; login: string; public_repos: number }[]>`
    SELECT repo_key, project_id, login, public_repos FROM github_verifications WHERE installation_id = ${f.inst}`;
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ repo_key: f.repoKey, project_id: f.project, login: 'alice', public_repos: 3 }]);
  // A collaborator with push passes.
  const collab = await fixture('collab');
  assert.equal((await completeVerify('code', await linkNonce(collab), github('bob', { push: true }))).ok, true);
});

test('5.6 a shared installation, two builders on two repos: entry A\'s sign-in never proves entry B', db, async () => {
  const a = await fixture('sharedA', { shared: true });
  const b = await fixture('sharedB', { shared: true, inst: a.inst, owner: 'bob' });
  assert.equal((await completeVerify('code', await linkNonce(a), github('alice'))).ok, true);
  assert.ok(await verifiedFor({ projectId: a.project, repoKey: a.repoKey }));
  assert.equal(await verifiedFor({ projectId: b.project, repoKey: b.repoKey }), null);
  assert.equal(await verifiedFor({ projectId: b.project, repoKey: a.repoKey }), null);
  assert.equal(await verifiedFor({ repoKey: a.repoKey }), null, 'never unscoped');
  // B's token gate still asks for proof (the default verified reads the table; on this shared
  // install, G10: only a sign-in, with the caller's own code).
  await withEnv(ON, async () => {
    const deps: GateDeps = {
      repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
      owner: async () => ({ status: 'missing' }),
      screen: async () => {},
    };
    const gateB = await tokenGate(
      { policy: 'encouraged', repoUrl: `https://github.com/${b.repoKey}`, wallet: `0x${'1'.repeat(40)}`, symbol: 'TIP', installationId: b.inst, projectId: b.project, verifiedLogin: 'alice' },
      deps,
    );
    assert.equal(gateB.ok, false);
    assert.equal((gateB as { reason: string }).reason, SIGN_IN_FIRST);
    const gateA = await tokenGate(
      { policy: 'encouraged', repoUrl: `https://github.com/${a.repoKey}`, wallet: `0x${'1'.repeat(40)}`, symbol: 'TIP', installationId: a.inst, projectId: a.project, verifiedLogin: 'alice' },
      deps,
    );
    assert.deepEqual(gateA, { ok: true });
  });
  // Off: a stored verification proves nothing.
  await withEnv({ GITHUB_OAUTH_CLIENT_ID: undefined, GITHUB_OAUTH_CLIENT_SECRET: undefined }, async () => {
    const off = await tokenGate(
      { policy: 'encouraged', repoUrl: `https://github.com/${a.repoKey}`, wallet: `0x${'1'.repeat(40)}`, symbol: 'TIP', installationId: a.inst, projectId: a.project },
      { repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }), owner: async () => ({ status: 'missing' }), screen: async () => {} },
    );
    assert.equal(off.ok, false);
  });
});

test('P11: on a shared client a host verification is single-use and lasts 15 minutes; elsewhere it stays', db, async () => {
  const s = await fixture('hostS', { shared: true });
  const t0 = new Date();
  assert.equal((await completeVerify('code', await linkNonce(s, 'host', t0), github('alice'), t0)).ok, true);
  assert.ok(await takeHostVerification({ installationId: s.inst, repoKey: s.repoKey, shared: true }, t0));
  assert.equal(await takeHostVerification({ installationId: s.inst, repoKey: s.repoKey, shared: true }, t0), null, 'used once');
  assert.equal((await completeVerify('code', await linkNonce(s, 'host', t0), github('alice'), t0)).ok, true);
  const late = new Date(t0.getTime() + VERIFY_TTL_MS + 1000);
  assert.equal(await takeHostVerification({ installationId: s.inst, repoKey: s.repoKey, shared: true }, late), null, 'expired');
  const own = await fixture('hostO');
  assert.equal((await completeVerify('code', await linkNonce(own, 'host'), github('alice'))).ok, true);
  assert.ok(await takeHostVerification({ installationId: own.inst, repoKey: own.repoKey, shared: false }));
  assert.ok(await takeHostVerification({ installationId: own.inst, repoKey: own.repoKey, shared: false }), 'kept');
});

test('G8: the link shows a confirm page (repo, token, wallet, warning), never a redirect; its POST goes to GitHub with state = nonce.csrf', db, async () => {
  await withEnv(ON, async () => {
    const f = await fixture('confirm');
    const wallet = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
    // Ruling G11: the page shows the wallet and ticker the link was made for, whatever the entry holds later.
    const nonce = await linkNonce(f, 'entry', new Date(), wallet);
    await sql()`UPDATE projects SET token_symbol = 'XXX', creator_wallet = ${`0x${'9'.repeat(40)}`} WHERE id = ${f.project}`;
    const limit = { limit: async () => {} };
    const page = await verifyStart(new Request(`https://evil.example/github/verify?n=${nonce}`), limit);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('location'), null, 'never a redirect');
    const html = await page.text();
    assert.match(html, new RegExp(`Repo: github\\.com/${f.repoKey}`));
    assert.match(html, /Token: \$TIP/);
    assert.match(html, new RegExp(`Wallet for fees: ${wallet.toLowerCase()}`));
    assert.ok(html.includes(CONFIRM_WARNING));
    assert.match(html, /<form method="post" action="https:\/\/earnkit\.com\/github\/verify">/, 'siteUrl, never the request host');
    assert.doesNotMatch(html, /evil\.example|<script|none yet|0x9{40}|XXX/);
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
    assert.equal(to.searchParams.get('client_id'), 'test-client');
    assert.equal(to.searchParams.get('scope'), null);
    assert.equal(to.searchParams.get('allow_signup'), 'false');
    assert.doesNotMatch(go.headers.get('location')!, /test-secret/);
    // The callback in the same browser verifies; the page clears the cookie.
    const back = await verifyCallback(
      new Request(`https://earnkit.com/github/verify/callback?code=C&state=${nonce}.${csrf}`, { headers: { cookie: `${csrfCookieName(nonce)}=${csrf}` } }),
      (code, n) => completeVerify(code, n, github('alice')),
      limit,
    );
    assert.equal(back.status, 200);
    assert.ok((await back.text()).includes(VERIFY_PAGE.done));
    // An expired link: the expired line, no cookie.
    const gone = await verifyStart(new Request(`https://earnkit.com/github/verify?n=${nonce}`), limit);
    assert.equal(gone.status, 410);
    assert.equal(gone.headers.get('set-cookie'), null);
  });
});

test('G9: on a shared client the sign-in page shows a one-time code; only that code names the caller', db, async () => {
  const a = await fixture('codeA', { shared: true });
  const b = await fixture('codeB', { shared: true, inst: a.inst, owner: 'bob' });
  const t0 = new Date();
  const outA = await completeVerify('code', await linkNonce(a, 'entry', t0), github('alice'), t0);
  const outB = await completeVerify('code', await linkNonce(b, 'entry', t0), github('bob'), t0);
  assert.ok(outA.ok && outA.code && /^[A-Z2-7]{10}$/.test(outA.code));
  assert.ok(outB.ok && outB.code);
  const codeA = formatCode((outA as { code: string }).code);
  const codeB = (outB as { code: string }).code;
  const [row] = await sql()<{ code_hash: string }[]>`SELECT code_hash FROM github_verifications WHERE project_id = ${a.project}`;
  assert.match(row.code_hash, /^[0-9a-f]{64}$/, 'only the hash is kept');
  assert.equal(await callerLogin(a.inst, codeA.toLowerCase(), t0), 'alice');
  assert.equal(await callerLogin(a.inst, codeB, t0), 'bob', "B's code never names A");
  assert.equal(await callerLogin(a.inst, 'alice', t0), null, 'a claimed name is no code');
  assert.equal(await callerLogin(a.inst, undefined, t0), null);
  assert.equal(await callerLogin(a.inst, 'AAAA-AAAA-AA', t0), null);
  const other = await fixture('codeOther', { shared: true });
  assert.equal(await callerLogin(other.inst, codeA, t0), null, 'another installation');
  assert.equal(await callerLogin(a.inst, codeA, new Date(t0.getTime() + CODE_TTL_MS + 1000)), null, 'expired');
  assert.deepEqual(await verifiedEntryIds(a.inst, 'alice'), [a.project]);
  // Not a shared client: no code (the installation is the identity).
  const own = await fixture('codeOwn');
  const outOwn = await completeVerify('code', await linkNonce(own), github('alice'));
  assert.deepEqual(outOwn, { ok: true, repoKey: own.repoKey });
});

test('G8 to G11: on a shared client only the caller\'s own sign-in proves a launch, never the shared proof line, and only to the wallet it was made for', db, async () => {
  const a = await fixture('gateA', { shared: true });
  await completeVerify('code', await linkNonce(a), github('alice'));
  let lineReads = 0;
  // The repo's earnkit.txt carries the installation's own line (pushed by user A): it proves for anyone on the agent.
  const deps: GateDeps = {
    repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
    owner: async (r) => {
      lineReads++;
      return { status: 'ok', text: tokenLineFor(a.inst, `https://github.com/${r.owner}/${r.repo}`)! };
    },
    screen: async () => {},
  };
  const gate = (verifiedLogin: string | null | undefined, wallet = WF) =>
    tokenGate(
      { policy: 'encouraged', repoUrl: `https://github.com/${a.repoKey}`, wallet, symbol: 'TIP', installationId: a.inst, projectId: a.project, verifiedLogin },
      deps,
    );
  const needed = { ok: false, reason: SIGN_IN_FIRST, fixable: true, sign_in: 'needed' };
  await withEnv(ON, async () => {
    assert.deepEqual(await gate('alice'), { ok: true });
    // G10: user B (another code, or none) can't launch on A's sign-in nor on the line A pushed.
    assert.deepEqual(await gate('bob'), needed);
    assert.deepEqual(await gate(null), needed, 'a shared caller without a code');
    assert.equal(lineReads, 0, 'the proof line is never read on a shared client');
    // G11: A's own code, but another fee wallet than the one the confirm page showed.
    assert.deepEqual(await gate('alice', `0x${'2'.repeat(40)}`), { ok: false, reason: WALLET_CHANGED, fixable: true, sign_in: 'wallet_changed' });
    // Fix round 2: a caller that passes no login on this shared install is still a shared caller
    // (the gate reads it): no proof line, no sign-in without a code.
    assert.deepEqual(await gate(undefined), needed);
    assert.equal(lineReads, 0);
    // Not a shared client: the entry's sign-in, or the proof line, as before.
    const own = { ...deps, shared: async () => false };
    const plain = (wallet = WF) =>
      tokenGate({ policy: 'encouraged', repoUrl: `https://github.com/${a.repoKey}`, wallet, symbol: 'TIP', installationId: a.inst, projectId: a.project }, own);
    assert.deepEqual(await plain(), { ok: true });
    assert.deepEqual(await plain(`0x${'2'.repeat(40)}`), { ok: true }, 'the proof line still proves there');
  });
  // With the OAuth variables absent, nothing changes: the shared proof line proves the launch.
  await withEnv({ GITHUB_OAUTH_CLIENT_ID: undefined, GITHUB_OAUTH_CLIENT_SECRET: undefined }, async () => {
    assert.deepEqual(await gate(null), { ok: true });
    assert.deepEqual(await gate('bob'), { ok: true });
  });
});

test('4.10 an App nonce\'s callback stores the login on the nonce, writes no verification, keeps the cookie and 303s to the install page', db, async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { installUrl } = await import('./github-app');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const APP = { ...ON, GITHUB_APP_ID: '1', GITHUB_APP_SLUG: 'earnkit-read', GITHUB_APP_PRIVATE_KEY: privateKey };
  const f = await fixture('app');
  // With the App off, no App nonce can be made.
  await withEnv({ ...ON, GITHUB_APP_ID: undefined }, async () => {
    await assert.rejects(createVerifyLink({ installationId: f.inst, projectId: f.project, repoKey: f.repoKey, purpose: 'app' }), /App is off/);
  });
  await withEnv(APP, async () => {
    // No wallet: no launch rides on an App link (R9).
    const link = await createVerifyLink({ installationId: f.inst, projectId: f.project, repoKey: f.repoKey, purpose: 'app' });
    const nonce = new URL(link).searchParams.get('n')!;
    const page = await verifyStart(new Request(link), { limit: async () => {} });
    assert.match(await page.text(), /let EarnKit read this repo/);
    const back = await verifyCallback(
      new Request(`https://earnkit.com/github/verify/callback?code=C&state=${nonce}.K1`, { headers: { cookie: `${csrfCookieName(nonce)}=K1` } }),
      (code, n) => completeVerify(code, n, github('Alice')),
      { limit: async () => {} },
    );
    assert.equal(back.status, 303);
    assert.equal(back.headers.get('location'), installUrl('earnkit-read', nonce));
    assert.equal(back.headers.get('set-cookie'), null, 'the cookie stays for the setup URL');
    assert.equal(await peekNonce(nonce), true, 'not consumed');
    const [row] = await sql()<{ login: string; public_repos: number; created: boolean }[]>`
      SELECT n.login, n.public_repos, n.account_created_at IS NOT NULL AS created FROM github_verify_nonces n
      WHERE n.project_id = ${f.project} AND n.purpose = 'app'`;
    assert.deepEqual({ ...row }, { login: 'alice', public_repos: 3, created: true });
    assert.equal((await sql()`SELECT 1 FROM github_verifications WHERE installation_id = ${f.inst}`).length, 0);
    // A second OAuth hop on the same nonce can't replace the login.
    assert.deepEqual(await completeVerify('code', nonce, github('mallory')), { ok: false, reason: VERIFY_PAGE.expired });
    const [kept] = await sql()<{ login: string }[]>`SELECT login FROM github_verify_nonces WHERE project_id = ${f.project} AND purpose = 'app'`;
    assert.equal(kept.login, 'alice');
  });
});

test('concern 4 (fix round 1): an open link is shown again for the same purpose, repo, entry and installation; never on a shared client', db, async () => {
  const f = await fixture('reuse');
  const t0 = new Date();
  const link = (o: Partial<Parameters<typeof createVerifyLink>[0]> = {}, now = t0) =>
    createVerifyLink({ installationId: f.inst, projectId: f.project, repoKey: f.repoKey, purpose: 'entry', wallet: WF, symbol: 'tip', ...o }, now);
  const first = await link();
  assert.equal(await link(), first, 'reused');
  assert.equal(await link({ repoKey: f.repoKey.toUpperCase(), symbol: 'TIP' }), first, 'same repo and ticker, any case');
  assert.notEqual(await link({ wallet: `0x${'2'.repeat(40)}` }), first, 'another wallet');
  assert.notEqual(await link({ purpose: 'host', wallet: undefined, symbol: undefined }), first, 'another purpose');
  assert.notEqual(await link({ projectId: null, purpose: 'pickup', wallet: undefined, symbol: undefined }), first);
  assert.equal(
    (await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM github_verify_nonces WHERE installation_id = ${f.inst} AND purpose = 'entry' AND wallet = ${WF}`)[0].n,
    1,
  );
  // Less than 5 minutes left: a new link.
  assert.notEqual(await link({}, new Date(t0.getTime() + VERIFY_TTL_MS - 4 * 60_000)), first);
  // Used: a new link.
  const again = await link();
  assert.ok(await takeNonce(new URL(again).searchParams.get('n')!));
  assert.notEqual(await link(), again);
  // A shared client: every builder gets their own link.
  const s = await fixture('reuseShared', { shared: true });
  const shared = () => createVerifyLink({ installationId: s.inst, projectId: s.project, repoKey: s.repoKey, purpose: 'entry', wallet: WF, symbol: 'tip' });
  assert.notEqual(await shared(), await shared());
});

test('concern 4 (fix round 1): the hourly cron deletes links expired over a day ago, in a bounded batch', db, async () => {
  const { sweepVerifyNonces } = await import('./github-verify');
  const f = await fixture('sweep');
  const day = 86_400_000;
  const old = new Date(Date.now() - 3 * day);
  for (let i = 0; i < 3; i++) await createVerifyLink({ installationId: f.inst, projectId: null, repoKey: `${f.repoKey}-${i}`, purpose: 'pickup' }, old);
  const recent = await createVerifyLink({ installationId: f.inst, projectId: null, repoKey: f.repoKey, purpose: 'pickup' }, new Date(Date.now() - VERIFY_TTL_MS - 60_000));
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

test('3.8 loginBasisFor: signin (over the App), app, proof_line only for the builder\'s own User account whose own push added the line (T9 I1), null otherwise', db, async () => {
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
  // Review I2: the proof line names the owner only when the builder said it is them and GitHub says
  // it is a User account (S9's cached read, seeded here: the test guard blocks the network).
  const account = (login: string, type: string | null) => sql()`
    INSERT INTO url_checks (key, ok, checked_at, note)
    VALUES (${`ghuser:${login}`}, ${type !== null}, now(), ${type && JSON.stringify({ type, created_at: '2020-01-01T00:00:00Z', public_repos: 2 })})
    ON CONFLICT (key) DO UPDATE SET ok = EXCLUDED.ok, checked_at = EXCLUDED.checked_at, note = EXCLUDED.note`;
  assert.equal(await loginBasisFor(a, repo('line'), { lineOwner: tag }), null, 'no answer from GitHub: no login');
  await account(tag, 'User');
  assert.deepEqual(await loginBasisFor(a, repo('line'), { lineOwner: tag }), { login: tag, basis: 'proof_line' }, 'the builder, a User, owns it and pushed the line');
  assert.deepEqual(await loginBasisFor(a, repo('line'), { lineOwner: tag.toUpperCase() }), { login: tag, basis: 'proof_line' });
  // T9 security fix I1: a collaborator's push (GitHub's push actor is someone else), or no known pusher: no login.
  assert.equal(await loginBasisFor(a, repo('line'), { lineOwner: `${tag}-mallory` }), null, "a collaborator's push never names the owner");
  assert.equal(await loginBasisFor(a, repo('line'), { lineOwner: null }), null, 'no pusher: no login');
  assert.equal(await loginBasisFor(a, repo('line')), null, 'no pusher read and no deploy row: no login');
  await sql()`
    INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, status, cost_micro_usd, line_owner)
    VALUES (${a}, ${`installation:${a}`}, ${repo('deployed')}, 'arc', '0x01', 'deployed', 1, ${tag})`;
  assert.deepEqual(await loginBasisFor(a, repo('deployed')), { login: tag, basis: 'proof_line' }, "a deploy row records the owner's push");
  await sql()`
    INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, status, cost_micro_usd, line_owner)
    VALUES (${a}, ${`installation:${a}`}, ${repo('collab')}, 'arc', '0x01', 'deployed', 1, ${`${tag}-mallory`})`;
  assert.equal(await loginBasisFor(a, repo('collab')), null, "a deploy row whose line a collaborator pushed names no one");
  // An organization's repo: the proof line proves push access, never who the builder is.
  const org = `${tag}-org`;
  await account(org, 'Organization');
  const member = await inst({ githubUser: org });
  assert.equal(await loginBasisFor(member, `${org}/app`, { lineOwner: org }), null, 'an org is never the builder');
  // A collaborator's push to someone else's repo: the builder said another login.
  const collaborator = await inst({ githubUser: `${tag}-bob` });
  assert.equal(await loginBasisFor(collaborator, repo('line'), { lineOwner: tag }), null, "a github_user that isn't the owner");
  // A lying github_user: the agent says the owner's login, but its own push added the line.
  const liar = await inst({ githubUser: tag });
  assert.equal(await loginBasisFor(liar, repo('line'), { lineOwner: `${tag}-liar` }), null, 'a lying github_user');
  // A fork: its owner is the forker; the upstream owner's login is never reachable.
  assert.equal(await loginBasisFor(liar, `${tag}-liar/line`, { lineOwner: `${tag}-liar` }), null, 'a fork under another account');
  const unsaid = await inst();
  assert.equal(await loginBasisFor(unsaid, repo('line'), { lineOwner: tag }), null, 'the builder said no login');
  await account(`${tag}-gone`, null);
  const gone = await inst({ githubUser: `${tag}-gone` });
  assert.equal(await loginBasisFor(gone, `${tag}-gone/app`, { lineOwner: `${tag}-gone` }), null, 'no such account');

  // Neither: null, never GITHUB_TOKEN's login or the login an agent reported.
  const old = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'ghp_test_never_used';
  try {
    const b = await inst({ githubUser: 'mallory' });
    assert.equal(await loginBasisFor(b, repo('none')), null);
    await verify(b, repo('other'), 'bob');
    assert.equal(await loginBasisFor(b, repo('none')), null, "another repo's sign-in says nothing about this one");
    assert.equal(await loginBasisFor(a, repo('none')), null);
  } finally {
    if (old === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = old;
  }
  assert.equal(await loginBasisFor(a, 'no-slash'), null);
  assert.equal(await loginBasisFor(a, 'a/b/c'), null);
});

test('3.8 loginBasisFor on a shared client: only the caller\'s own sign-in or the entry\'s; never the proof line', db, async () => {
  const tag = `lbs${process.pid}${Date.now().toString(36)}`;
  const [{ id: s }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, shared_client) VALUES (${tag}, true) RETURNING id`;
  const repoKey = `${tag}/app`;
  await sql()`
    INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose)
    VALUES (${repoKey}, 'bob', ${s}, now(), 3, 'pickup')`;
  assert.equal(await loginBasisFor(s, repoKey), null, 'no caller: no login');
  assert.equal(await loginBasisFor(s, repoKey, { lineOwner: repoKey.split('/')[0] }), null, 'the proof line is the whole agent\'s');
  assert.equal(await loginBasisFor(s, repoKey, { callerLogin: null, lineOwner: repoKey.split('/')[0] }), null);
  assert.equal(await loginBasisFor(s, repoKey, { callerLogin: 'carol' }), null, "another builder's sign-in never names this caller");
  assert.deepEqual(await loginBasisFor(s, repoKey, { callerLogin: 'Bob' }), { login: 'bob', basis: 'signin' });
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${tag}, 'o', ${tag}, 'd', 'https://x', 'https://x', 'r', 's', 'active', 'allowed')`;
  const [{ id: project }] = await sql()<{ id: number }[]>`
    INSERT INTO projects (program_id, name, installation_id) VALUES (${tag}, 'App', ${s}) RETURNING id`;
  assert.equal(await loginBasisFor(s, repoKey, { projectId: project }), null, 'no sign-in bound to the entry');
  await sql()`
    INSERT INTO github_verifications (repo_key, login, installation_id, project_id, account_created_at, public_repos, purpose)
    VALUES (${repoKey}, 'dana', ${s}, ${project}, now(), 3, 'entry')`;
  assert.deepEqual(await loginBasisFor(s, repoKey, { projectId: project }), { login: 'dana', basis: 'signin' });
});
