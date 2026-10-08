import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import {
  VERIFY_PAGE,
  VERIFY_TTL_MS,
  callerLogin,
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
} from './github-verify';
import { tokenGate, type GateDeps } from './token-gate';

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
      new Request('https://earnkit.com/github/verify/callback?code=C1&state=S1&repo=mallory/x&repo_key=mallory/x&project_id=9'),
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
    // The handler's own source names no other parameter.
    const src = readFileSync(join(import.meta.dirname, 'github-verify.ts'), 'utf8');
    const params = [...src.matchAll(/\.get\('([^']+)'\)/g)].map((m) => m[1]).sort();
    assert.deepEqual(params, ['code', 'n', 'state']);
  });
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
const linkNonce = async (f: Fixture, purpose: 'entry' | 'pickup' | 'host' = 'entry', now = new Date()) => {
  const link = await createVerifyLink({ installationId: f.inst, projectId: purpose === 'pickup' ? null : f.project, repoKey: f.repoKey, purpose }, now);
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
  const link = await createVerifyLink({ installationId: f.inst, projectId: f.project, repoKey: f.repoKey, purpose: 'entry' });
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
  assert.deepEqual(first, { installation_id: f.inst, project_id: f.project, repo_key: f.repoKey, purpose: 'entry' });
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
  // An org repo the scopeless token sees no permissions on: notYours (the proof line stays the way).
  const org = await fixture('org', { owner: 'acme-org' });
  assert.deepEqual(await completeVerify('code', await linkNonce(org), github('alice', null)), { ok: false, reason: VERIFY_PAGE.notYours });
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
  // B's token gate still asks for the proof line (the default verified reads the table).
  await withEnv(ON, async () => {
    const deps: GateDeps = {
      repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
      owner: async () => ({ status: 'missing' }),
      screen: async () => {},
    };
    const gateB = await tokenGate(
      { policy: 'encouraged', repoUrl: `https://github.com/${b.repoKey}`, wallet: `0x${'1'.repeat(40)}`, symbol: 'TIP', installationId: b.inst, projectId: b.project },
      deps,
    );
    assert.equal(gateB.ok, false);
    assert.match((gateB as { reason: string }).reason, /proof line/);
    const gateA = await tokenGate(
      { policy: 'encouraged', repoUrl: `https://github.com/${a.repoKey}`, wallet: `0x${'1'.repeat(40)}`, symbol: 'TIP', installationId: a.inst, projectId: a.project },
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

test('G6/G7: the caller\'s login on a shared client: a recent sign-in matching what the call names; one login only', db, async () => {
  const a = await fixture('callerA', { shared: true });
  const b = await fixture('callerB', { shared: true, inst: a.inst, owner: 'bob' });
  const t0 = new Date();
  assert.equal(await callerLogin(a.inst, { github_user: 'alice' }, t0), null, 'no sign-in yet');
  await completeVerify('code', await linkNonce(a, 'entry', t0), github('alice'), t0);
  await completeVerify('code', await linkNonce(b, 'entry', t0), github('bob'), t0);
  assert.equal(await callerLogin(a.inst, { github_user: 'Alice' }, t0), 'alice');
  assert.equal(await callerLogin(a.inst, { project_ids: [b.project] }, t0), 'bob');
  assert.equal(await callerLogin(a.inst, { repo_keys: [a.repoKey] }, t0), 'alice');
  assert.equal(await callerLogin(a.inst, { github_user: 'alice', project_ids: [b.project] }, t0), null, 'two logins: never a guess');
  assert.equal(await callerLogin(a.inst, {}, t0), null);
  assert.equal(await callerLogin(a.inst, { github_user: 'alice' }, new Date(t0.getTime() + VERIFY_TTL_MS + 1000)), null, 'not current');
  assert.deepEqual(await verifiedEntryIds(a.inst, 'alice'), [a.project]);
});
