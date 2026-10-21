import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub, type FakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { withEnv } from './fixtures/find';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { codesSettled } from './bench-find';
import { BASE_GRANTS_ID, BUILDER_CODES_FIRST, BUILDER_CODES_SUFFIX, builderCodesFound, builderCodesIn } from './builder-code';
import { BUILDER_CODES_FILES, BUILDER_CODES_TTL_MS, builderCodesKnown, builderCodesWords, checkBuilderCodes, codePaths } from './builder-codes-check';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';

/**
 * v3.1 Task 7: Base Builder Grants' first step is Builder Codes (ERC-8021). The one project's repo is read through the
 * read-only App (find starts the check in the background); Task 16: the draft says Builder Codes were found, or names
 * the first step with the guide; the reply never does. A read that fails says nothing about Builder Codes.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v31-builder-codes-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await codesSettled();
  await sql().end();
});
const RUN = String(process.pid % 100000);
const TITLE = 'Base Builder Grant Program';

type R = Awaited<ReturnType<typeof mcpCall>>;
type Ctx = Parameters<typeof mcpCall>[0];
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
let n = 0;

/** A ranked builder whose one project is `key` (proven by the App), fitting only Base Builder Grants (rolling). */
async function builder(key: string, files: Record<string, string> | null | undefined): Promise<{ ctx: Ctx; id: number; gh: FakeGitHub }> {
  n++;
  const t = `ek_v31bc_${n}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = key.split('/')[0];
  assert.ok((await attachToX(own, { id: `97${RUN}${n}`, username: handle, name: 'bc', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const ctx = {
    installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits: repoFits(key) })) as never,
    tokenDeps: { check: async () => true },
  } as Ctx;
  await mcpCall(ctx, 'find', { identity: { project: { name: 'App', repo: `https://github.com/${key}` } } });
  const gid = 9000 + n * 10;
  const gh = fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1, files } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  ctx.codesFetch = gh;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${c.id} AND kind = 'repo'`;
  return { ctx, id: c.id, gh };
}
function repoFits(key: string): RepoFit[] {
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'app', url: `https://github.com/${key}`, homepage: 'https://app.xyz', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  return [{
    repo: 'app', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true,
    verdicts: [{ program_id: BASE_GRANTS_ID, program: BASE_GRANTS_ID, status: 'likely' as const, missing: [], effort: 'none' as const, note: null }],
  }];
}
const stored = async (key: string) => (await sql()<{ found: boolean }[]>`SELECT found FROM repo_builder_codes WHERE repo_key = ${key}`)[0] ?? null;
const contents = (gh: FakeGitHub) => gh.calls.filter((c) => c.path.includes('/contents/'));
/** Task 16: the reply names the Best fit (the apply step, then the money line) and never Builder Codes. */
const bestOnly = (s: string) => {
  assert.ok(s.includes(`${TITLE}`), s);
  assert.doesNotMatch(s, /Builder Codes/, s);
};
/** Task 16 step 6: the Base draft's Builder Codes line (its explanation's), or undefined. */
const draftCodes = async (b: { ctx: Ctx }, key: string) => {
  const answers = { project_name_description: 'App: a Base app', live_product_url: 'https://app.xyz' };
  const r = await mcpCall(b.ctx, 'prepare', { program_id: BASE_GRANTS_ID, project: { name: 'App', repo_url: `https://github.com/${key}`, live_url: 'https://app.xyz' }, answers });
  return show(r).split('\n\n')[0].split('\n').find((l) => /Builder Codes/.test(l));
};

test('(a) builderCodesIn: each of the four signals, and a plain viem call without dataSuffix is false', () => {
  assert.equal(BUILDER_CODES_SUFFIX, '80218021802180218021802180218021');
  assert.ok(builderCodesIn(`import { Attribution } from 'ox/erc8021';`));
  assert.ok(builderCodesIn(`const suffix = Attribution.toDataSuffix({ codes: ['maya'] });`));
  assert.ok(builderCodesIn(`await walletClient.sendTransaction({ to, value, dataSuffix: suffix });`));
  assert.ok(builderCodesIn(`const S = '0x046d617961000a${BUILDER_CODES_SUFFIX}';`));
  assert.ok(builderCodesIn(`const S = "0x0A${BUILDER_CODES_SUFFIX.toUpperCase()}"`), 'any case');
  assert.equal(builderCodesIn(`await walletClient.writeContract({ address, abi, functionName: 'mint', args: [to] });`), false);
  assert.equal(builderCodesIn(`const data = '0x${BUILDER_CODES_SUFFIX}ff';`), false, 'the marker ends the literal');
  assert.equal(builderCodesIn('const myDataSuffix = 1;'), false);
});

test('(b) codePaths ranks and caps; skips node_modules, tests and .d.ts', () => {
  assert.deepEqual(codePaths([
    'README.md', 'src/App.tsx', 'src/lib/wagmi.ts', 'src/config.ts', 'node_modules/ox/erc8021.ts', 'dist/index.js', 'apps/web/.next/x.js',
    'src/a.test.ts', 'src/b.spec.tsx', 'types/env.d.ts', 'src/onchain/sendTx.ts', 'index.mjs', 'vendor/lib.cjs', 'coverage/x.js', 'build/x.js', 'out/x.js',
    'contracts/Token.sol', 'scripts/run.cjs',
  ]), ['src/config.ts', 'src/lib/wagmi.ts', 'src/onchain/sendTx.ts', 'index.mjs', 'src/App.tsx', 'scripts/run.cjs']);
  const many = Array.from({ length: 50 }, (_, i) => `src/f${String(i).padStart(2, '0')}.ts`);
  const ranked = codePaths([...many, 'src/deep/folder/wallet.ts']);
  assert.equal(ranked.length, BUILDER_CODES_FILES);
  assert.equal(ranked[0], 'src/deep/folder/wallet.ts', 'a likely path before a shorter one');
});

test('(c) checkBuilderCodes finds the import in the 3rd file, stores found=true; the draft then says "Builder Codes found in maya/app."', db, async () => {
  const key = 'maya/app';
  const b = await builder(key, {
    'README.md': 'import ox/erc8021 in the docs',
    'node_modules/ox/erc8021.ts': `import { Attribution } from 'ox/erc8021';`,
    'src/a.test.ts': `import { Attribution } from 'ox/erc8021';`,
    'src/wagmi.ts': `export const config = createConfig({ chains: [base] });`,
    'src/config.ts': 'export const chain = base;',
    'src/onchain/tx.ts': `import { Attribution } from 'ox/erc8021';\nexport const suffix = Attribution.toDataSuffix({ codes: ['maya'] });`,
    'src/onchain/wallet.ts': 'export const w = 1;',
    'src/App.tsx': 'export default function App() { return null; }',
  });
  const now = new Date();
  assert.equal(await checkBuilderCodes(b.id, key, now, { fetch: b.gh }), true);
  assert.deepEqual(contents(b.gh).map((c) => c.path), ['/repos/maya/app/contents/src/wagmi.ts', '/repos/maya/app/contents/src/config.ts', '/repos/maya/app/contents/src/onchain/tx.ts']);
  assert.ok(b.gh.calls.every((c) => c.routed), 'only faked calls');
  assert.deepEqual(await stored(key), { found: true });
  assert.deepEqual(await builderCodesKnown(key, now), { found: true, fresh: true });
  assert.deepEqual(await builderCodesKnown(key, new Date(now.getTime() + BUILDER_CODES_TTL_MS)), { found: true, fresh: false });
  const s = show(await mcpCall(b.ctx, 'find', {}));
  bestOnly(s);
  assert.ok((s.match(/https:\/\//g) ?? []).length <= 1, s);
  assert.equal(await draftCodes(b, key), builderCodesFound(key));
  assert.equal(builderCodesFound(key), 'Builder Codes found in maya/app.');
});

test('(d) App off, a 404 tree, or a timeout: null, nothing stored, no Builder Codes words', db, async () => {
  const files = { 'src/wagmi.ts': `import { Attribution } from 'ox/erc8021';` };
  // A 404 tree (the fake has no files for this repo).
  const missing = await builder('lena/app', undefined);
  assert.equal(await checkBuilderCodes(missing.id, 'lena/app', new Date(), { fetch: missing.gh }), null);
  assert.ok(missing.gh.calls.some((c) => c.path.startsWith('/repos/lena/app/git/trees/HEAD')), 'the tree was asked');
  assert.equal(await stored('lena/app'), null);
  // A timeout reading a file.
  const slow = await builder('omar/app', files);
  const timeout = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/contents/')) throw new DOMException('The operation timed out.', 'TimeoutError');
    return slow.gh(input, init);
  }) as typeof fetch;
  slow.ctx.codesFetch = timeout;
  assert.equal(await checkBuilderCodes(slow.id, 'omar/app', new Date(), { fetch: timeout }), null);
  assert.equal(await stored('omar/app'), null);
  // The App off.
  const off = await builder('ivy/app', files);
  await withEnv({ GITHUB_APP_PRIVATE_KEY: undefined }, async () => {
    assert.equal(await checkBuilderCodes(off.id, 'ivy/app', new Date(), { fetch: off.gh }), null);
  });
  assert.equal(off.gh.calls.filter((c) => c.path.includes('/git/trees/')).length, 0);
  assert.equal(await stored('ivy/app'), null);
  assert.equal(builderCodesWords('ivy/app', null), null);
  // The reply: the Best fit, nothing about Builder Codes.
  for (const b of [missing, slow, off]) {
    const s = show(await withEnv(b === off ? { GITHUB_APP_PRIVATE_KEY: undefined } : {}, () => mcpCall(b.ctx, 'find', {})));
    bestOnly(s);
    assert.doesNotMatch(s, /not found/i, s);
  }
  await codesSettled();
  for (const k of ['lena/app', 'omar/app', 'ivy/app']) assert.equal(await stored(k), null, k);
});

test('(e) none found: the draft\'s line ends with the guide, no https, no trailing period', db, async () => {
  const key = 'noor/app';
  const b = await builder(key, {
    'src/wagmi.ts': 'export const config = createConfig({ chains: [base] });',
    'src/mint.ts': `await walletClient.writeContract({ address, abi, functionName: 'mint', args: [to] });`,
  });
  assert.equal(await checkBuilderCodes(b.id, key, new Date(), { fetch: b.gh }), false);
  assert.equal(contents(b.gh).length, 2);
  assert.deepEqual(await stored(key), { found: false });
  bestOnly(show(await mcpCall(b.ctx, 'find', {})));
  const line = (await draftCodes(b, key))!;
  assert.equal(line, BUILDER_CODES_FIRST);
  assert.ok(line.endsWith('Guide: docs.base.org/base-chain/builder-codes/builder-codes'), line);
  assert.doesNotMatch(line, /https?:\/\/|\?|\.$|—/, line);
});

test('(f) fix round 1: a failed background check is not tried again on the next reply within the day', db, async () => {
  const key = 'ruth/app';
  const b = await builder(key, null); // the tree answers 500
  const trees = () => b.gh.calls.filter((c) => c.path.includes('/git/trees/')).length;
  bestOnly(show(await mcpCall(b.ctx, 'find', {})));
  await codesSettled();
  assert.equal(trees(), 1, 'the first reply starts one check');
  assert.equal(await stored(key), null, 'a failure stores nothing');
  bestOnly(show(await mcpCall(b.ctx, 'find', {})));
  await codesSettled();
  assert.equal(trees(), 1, 'the next reply does not read again');
});

test('(g) fix round 1: a file that answers without text (a symlink) is skipped and the scan goes on; an HTTP error is still null', db, async () => {
  const key = 'sam/app';
  const b = await builder(key, { 'src/wallet.ts': 'link', 'src/a.ts': `import { Attribution } from 'ox/erc8021';` });
  const symlink = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/contents/src/wallet.ts')) return new Response(JSON.stringify({ type: 'symlink', target: '../x.ts', path: 'src/wallet.ts' }), { status: 200 });
    return b.gh(input, init);
  }) as typeof fetch;
  assert.equal(await checkBuilderCodes(b.id, key, new Date(), { fetch: symlink }), true);
  assert.deepEqual(contents(b.gh).map((c) => c.path), ['/repos/sam/app/contents/src/a.ts']);
  assert.deepEqual(await stored(key), { found: true });
  const key2 = 'tia/app';
  const c = await builder(key2, { 'src/wallet.ts': 'x', 'src/a.ts': `import { Attribution } from 'ox/erc8021';` });
  const broken = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/contents/src/wallet.ts')) return new Response('{}', { status: 502 });
    return c.gh(input, init);
  }) as typeof fetch;
  assert.equal(await checkBuilderCodes(c.id, key2, new Date(), { fetch: broken }), null);
  assert.equal(await stored(key2), null);
});

test('(h) Task 9 fix round 1 (security): find reads and checks Builder Codes only for a repo the builder proved through the App', db, async () => {
  const key = 'tova/app';
  const b = await builder(key, { 'src/tx.ts': `const s = Attribution.toDataSuffix({ codes: ['x'] });` });
  await sql()`INSERT INTO repo_builder_codes (repo_key, found, checked_at) VALUES (${key}, true, now() - interval '2 days')`;
  // Counted by another proof (a proof branch), not the App: still ranked, but no stored answer read and no check.
  await sql()`UPDATE builder_sources SET proof = 'proof_branch' WHERE builder_id = ${b.id} AND kind = 'repo'`;
  const trees = () => b.gh.calls.filter((c) => c.path.includes('/git/trees/')).length;
  bestOnly(show(await mcpCall(b.ctx, 'find', {})));
  await codesSettled();
  assert.equal(trees(), 0, 'no check for an unproven repo');
  // Proven by the App again: the stale stored answer starts a check (the draft then says it).
  await sql()`UPDATE builder_sources SET proof = 'github_app' WHERE builder_id = ${b.id} AND kind = 'repo'`;
  bestOnly(show(await mcpCall(b.ctx, 'find', {})));
  await codesSettled();
  assert.equal(trees(), 1, 'an App-proven repo is checked');
  assert.equal(await draftCodes(b, key), `Builder Codes found in ${key}.`);
});
