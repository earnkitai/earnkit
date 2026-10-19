import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sql } from './db';
import { appSetup } from './github-app';
import { APP_CONFIRM_ONLY_YOURS, createVerifyLink, csrfCookieName, verifyStart } from './github-verify';
import { connectInstallation, saveInstallation } from './installations';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { APP_REMOVED, appCheckStep, installLink, proveByApp, repoProof } from './repo-proof';
import { attachToX } from './x-install';
import { readSources } from './sources';
import { defaultReaderDeps } from './source-readers';
import { proveRepo, tokenGate } from './token-gate';

appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
const NOW = new Date();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** A signed-in person whose agent named `key` as the one project (find through MCP). */
async function personWith(key: string, handle: string) {
  const t = `ek_app_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const a = await attachToX(own, { id: `93${RUN}${handle.length}${handle.charCodeAt(0)}`, username: `${handle}${RUN}`.slice(0, 15), name: handle, avatar: null }, NOW);
  assert.ok(a.ok);
  const c = (await connectInstallation(t))!;
  // Fix round 1: no matcher or reader leaves the process (find's matching and refresh are faked).
  const no = async () => { throw new Error('offline'); };
  const readerDeps = new Proxy({}, { get: (_t, k) => (k === 'now' ? new Date() : k === 'ghSpent' ? () => false : k === 'ghFetch' ? undefined : no) });
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, xUserId: c.x, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }), readerDeps } as never;
  await mcpCall(ctx, 'find', { identity: { project: { name: key.split('/')[1], repo: `https://github.com/${key}` } } });
  return { id: c.id, ctx };
}

test('6.1 an unproven repo gets the App install link (purpose app), never a proof code', db, async () => {
  const key = `maya${RUN}/recipes`;
  const p = await personWith(key, 'maya');
  const link = await installLink(p.id, key, NOW);
  assert.match(link!, /^https:\/\/earnkit\.com\/github\/verify\?n=/);
  const r = await mcpCall(p.ctx, 'find', {});
  assert.equal(r.reply?.proof, undefined);
  assert.equal(r.reply?.remove_branch, undefined);
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM proof_branches WHERE builder_id = ${p.id}`;
  assert.equal(n, 0);
});

test('6.2 the setup URL proves the repo (github_app), rescoring at once: the next find says it is on the Bench', db, async () => {
  const key = `nia${RUN}/notes`;
  const p = await personWith(key, 'nia');
  const gh = fakeGitHub({ [key]: { id: 9001, owner: `nia${RUN}`, installation: 77, private: true } });
  const nonce = new URL((await createVerifyLink({ installationId: p.id, projectId: null, repoKey: key, purpose: 'app' }, NOW))).searchParams.get('n')!;
  await sql()`UPDATE github_verify_nonces SET login = ${`nia${RUN}`}, account_created_at = '2020-01-01', public_repos = 3 WHERE nonce_hash = ${sha(nonce)}`;
  const res = await appSetup(new Request(`https://earnkit.com/github/verify/app?installation_id=77&state=${nonce}`, { headers: { cookie: `${csrfCookieName(nonce)}=x` } }), { fetch: gh, limit: async () => {} });
  assert.equal(res.status, 200);
  const [s] = await sql()<{ state: string; proof: string; gh_repo_id: string; gh_owner: string; public_at: Date | null }[]>`
    SELECT state, proof, gh_repo_id::text, gh_owner, public_at FROM builder_sources WHERE builder_id = ${p.id} AND kind = 'repo' AND lower(ref) = ${key}`;
  assert.deepEqual({ ...s, public_at: s.public_at === null }, { state: 'verified', proof: 'github_app', gh_repo_id: '9001', gh_owner: `nia${RUN}`, public_at: true });
  assert.deepEqual(await repoProof(p.id, key), { ok: true, via: 'app', owner: `nia${RUN}`, private: true });
  const r = await mcpCall(p.ctx, 'find', {});
  assert.match(String(r.reply?.show_to_builder), /is on the Bench/);
});

test('6.3 the App on a fork is a copy: refused, not verified', db, async () => {
  const key = `oli${RUN}/fork`;
  const p = await personWith(key, 'oli');
  const gh = fakeGitHub({ [key]: { id: 9002, owner: `oli${RUN}`, installation: 78, fork: true } });
  assert.deepEqual(await installApp({ builderId: p.id, repoKey: key, login: `oli${RUN}`, gh }), { ok: false, why: 'copy' });
  assert.deepEqual(await repoProof(p.id, key), { ok: false, why: 'copy' });
});

test('6.4 a repo another person already holds stays theirs', db, async () => {
  const key = `pat${RUN}/shared`;
  const first = await personWith(key, 'pat');
  const second = await personWith(key, 'quin');
  const gh = fakeGitHub({ [key]: { id: 9003, owner: `pat${RUN}`, installation: 79, admins: [`quin${RUN}`] } });
  assert.ok((await installApp({ builderId: first.id, repoKey: key, login: `pat${RUN}`, gh }) as { ok: boolean }).ok);
  assert.deepEqual(await installApp({ builderId: second.id, repoKey: key, login: `quin${RUN}`, gh }), { ok: false, why: 'taken' });
});

test('6.5 an org repo the installer does not administer proves nothing', db, async () => {
  const key = `acme${RUN}/app`;
  const p = await personWith(key, 'rae');
  const gh = fakeGitHub({ [key]: { id: 9004, owner: `acme${RUN}`, ownerType: 'Organization', installation: 80, admins: [] } });
  assert.deepEqual(await installApp({ builderId: p.id, repoKey: key, login: `rae${RUN}`, gh }), { notProven: 'not_yours' });
  assert.deepEqual(await repoProof(p.id, key), { ok: false, why: 'none' });
});

test('6.6 an App removed later sends the repo back to proposed and off the Bench at once', db, async () => {
  const key = `sol${RUN}/tool`;
  const p = await personWith(key, 'sol');
  const gh = fakeGitHub({ [key]: { id: 9005, owner: `sol${RUN}`, installation: 81 } });
  await installApp({ builderId: p.id, repoKey: key, login: `sol${RUN}`, gh });
  gh.repos[key].installation = null;
  const r = await appCheckStep(new Date(Date.now() + 25 * 3_600_000), { deadline: Date.now() + 10_000, only: [p.id], fetch: gh });
  assert.deepEqual(r, { checked: 1, removed: 1 });
  const [s] = await sql()<{ state: string; reject_reason: string }[]>`SELECT state, reject_reason FROM builder_sources WHERE builder_id = ${p.id} AND lower(ref) = ${key}`;
  assert.deepEqual(s, { state: 'proposed', reject_reason: APP_REMOVED });
  assert.doesNotMatch(String((await mcpCall(p.ctx, 'find', {})).reply?.show_to_builder), /is on the Bench/);
});

test('6.7 readings: an App-proven repo is read with its installation token, never the shared one', db, async () => {
  const key = `tia${RUN}/site`;
  const p = await personWith(key, 'tia');
  const gh = fakeGitHub({ [key]: { id: 9006, owner: `tia${RUN}`, installation: 82, private: true } });
  await installApp({ builderId: p.id, repoKey: key, login: `tia${RUN}`, gh });
  gh.calls.length = 0;
  await readSources(NOW, { deadline: Date.now() + 10_000, reader: { ...defaultReaderDeps(NOW, Date.now() + 10_000), ghFetch: gh }, only: [p.id] });
  // The App's own lookup of the repo's installation (GET /repos/{key}/installation) is signed with the App's JWT: not a reading.
  const reads = gh.calls.filter((c) => c.path === '/graphql' || (c.path.startsWith(`/repos/${key}`) && !c.path.endsWith('/installation')));
  assert.ok(reads.length > 0);
  for (const c of reads) assert.match(c.auth ?? '', /^Bearer ghs_fake_82$/, c.path);
});

test('6.8 the coin gate: an App-proven repo passes ownership; an unproven one gets the install link', db, async () => {
  const key = `uma${RUN}/coin`;
  const p = await personWith(key, 'uma');
  const gate = (k: string) => tokenGate(
    { policy: 'allowed', installationId: p.id, repoUrl: `https://github.com/${k}`, wallet: `0x${'1'.repeat(40)}`, symbol: 'UMA' },
    { repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null, defaultBranch: 'main', public: true }), screen: async () => {}, shared: async () => false, appLink: async () => 'https://earnkit.com/github/verify?n=x' },
  );
  const before = await gate(key);
  assert.equal(before.ok, false);
  assert.match((before as { reason: string }).reason, /read-only EarnKit app.*https:\/\/earnkit\.com\/github\/verify\?n=x/);
  await installApp({ builderId: p.id, repoKey: key, login: `uma${RUN}`, gh: fakeGitHub({ [key]: { id: 9007, owner: `uma${RUN}`, installation: 83 } }) });
  assert.equal((await gate(key)).ok, true);
});

test('6.9 existing verified sources stay verified and counted', db, async () => {
  const key = `vic${RUN}/old`;
  const p = await personWith(key, 'vic');
  await sql()`UPDATE builder_sources SET state = 'verified', proof = 'proof_branch', verified_at = now() WHERE builder_id = ${p.id} AND kind = 'repo' AND lower(ref) = ${key}`;
  assert.deepEqual(await repoProof(p.id, key), { ok: true, via: 'kept', owner: `vic${RUN}`, private: true });
});

test('6.10 I1: a private App-proven repo the agent never named reads "Private project" on the page', db, async () => {
  const named = `wes${RUN}/visible`;
  const p = await personWith(named, 'wes');
  const unnamed = `wes${RUN}/secret-plan`;
  const gh = fakeGitHub({ [unnamed]: { id: 9008, owner: `wes${RUN}`, installation: 84, private: true } });
  await installApp({ builderId: p.id, repoKey: unnamed, login: `wes${RUN}`, gh });
  const { safeNames } = await import('./page-data');
  const nameOf = await safeNames([p.id]);
  assert.equal(nameOf(p.id, unnamed), 'Private project');
});

test('6.11 S7: the App confirm page names the page the repo is added to', db, async () => {
  const key = `xan${RUN}/game`;
  const p = await personWith(key, 'xan');
  const link = await installLink(p.id, key, NOW);
  const res = await verifyStart(new Request(link!), { limit: async () => {} });
  assert.equal(res.status, 200);
  const page = await res.text();
  assert.ok(page.includes(`This adds github.com/${key} to earnkit.com/xan${RUN}`), page);
  assert.ok(page.includes(APP_CONFIRM_ONLY_YOURS), page);
  assert.match(APP_CONFIRM_ONLY_YOURS, /Only continue if that is your page/);
});

test('6.12 S7: no App link for a person with no handle (an anonymous installation)', db, async () => {
  const t = `ek_app_anon_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c = (await connectInstallation(t))!;
  await assert.rejects(createVerifyLink({ installationId: c.id, projectId: null, repoKey: `anon${RUN}/x`, purpose: 'app' }, NOW), /handle/);
  assert.equal(await installLink(c.id, `anon${RUN}/x`, NOW), null);
});

test('6.13 S8: two people completing the App on one repo at once: only one holds it', db, async () => {
  const key = `yuri${RUN}/twin`;
  const a = await personWith(key, 'yuri');
  const b = await personWith(key, 'zed');
  const gh = fakeGitHub({ [key]: { id: 9010, owner: `yuri${RUN}`, installation: 85, admins: [`zed${RUN}`] } });
  const out = await Promise.all([
    proveByApp({ builderId: a.id, repoKey: key, githubInstallationId: 85 }, { fetch: gh }),
    proveByApp({ builderId: b.id, repoKey: key, githubInstallationId: 85 }, { fetch: gh }),
  ]);
  assert.equal(out.filter((r) => r.ok).length, 1, JSON.stringify(out));
  assert.equal(out.filter((r) => !r.ok && r.why === 'taken').length, 1, JSON.stringify(out));
  const [{ n }] = await sql()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM builder_sources WHERE kind = 'repo' AND state = 'verified' AND lower(ref) = ${key}`;
  assert.equal(n, 1);
});

test('6.14 T6 security review: an action (coin, deploy, host) takes only an App proof GitHub confirmed within a day; a kept proof counts on the Bench only', db, async () => {
  const key = `abe${RUN}/kept`;
  const p = await personWith(key, 'abe');
  await sql()`UPDATE builder_sources SET state = 'verified', proof = 'repo_owner', verified_at = now() WHERE builder_id = ${p.id} AND kind = 'repo' AND lower(ref) = ${key}`;
  assert.equal((await repoProof(p.id, key)).ok, true, 'counted on the Bench');
  assert.deepEqual(await repoProof(p.id, key, undefined, { forAction: true }), { ok: false, why: 'none' });
  assert.equal(await proveRepo({ installationId: p.id, repoUrl: `https://github.com/${key}` }), null);
  const gate = (k: string) => tokenGate(
    { policy: 'allowed', installationId: p.id, repoUrl: `https://github.com/${k}`, wallet: `0x${'1'.repeat(40)}`, symbol: 'ABE' },
    { repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null, defaultBranch: 'main', public: true }), screen: async () => {}, shared: async () => false, appLink: async () => 'https://earnkit.com/github/verify?n=x' },
  );
  assert.equal((await gate(key)).ok, false, 'a kept proof never launches a coin');
  // An App proof: an action passes while GitHub confirmed it within a day; then the install link again.
  const app = `abf${RUN}/app`;
  const q = await personWith(app, 'abf');
  assert.equal(((await installApp({ builderId: q.id, repoKey: app, login: `abf${RUN}`, gh: fakeGitHub({ [app]: { id: 9020, owner: `abf${RUN}`, installation: 86 } }) })) as { ok: boolean }).ok, true);
  assert.ok(await proveRepo({ installationId: q.id, repoUrl: `https://github.com/${app}` }));
  await sql()`UPDATE builder_sources SET app_checked_at = now() - interval '27 hours' WHERE builder_id = ${q.id}`;
  assert.equal(await proveRepo({ installationId: q.id, repoUrl: `https://github.com/${app}` }), null, 'stale');
  assert.equal((await repoProof(q.id, app)).ok, true, 'still counted until the daily check says otherwise');
});

test('6.15 T6 security review: the daily check demotes a repo whose installation is not one this person proved (another account\'s install)', db, async () => {
  const key = `bea${RUN}/swap`;
  const p = await personWith(key, 'bea');
  const gh = fakeGitHub({ [key]: { id: 9021, owner: `bea${RUN}`, installation: 87 } });
  await installApp({ builderId: p.id, repoKey: key, login: `bea${RUN}`, gh });
  gh.repos[key].installation = 99; // uninstalled, then installed again by someone else outside EarnKit's link
  assert.deepEqual(await appCheckStep(new Date(Date.now() + 25 * 3_600_000), { deadline: Date.now() + 10_000, only: [p.id], fetch: gh }), { checked: 1, removed: 1 });
  const [s] = await sql()<{ state: string; reject_reason: string }[]>`SELECT state, reject_reason FROM builder_sources WHERE builder_id = ${p.id} AND lower(ref) = ${key}`;
  assert.deepEqual(s, { state: 'proposed', reject_reason: APP_REMOVED });
});

test('6.16 T6 security review: proveByApp verifies nothing unless GitHub names this very installation for the repo', db, async () => {
  const key = `cal${RUN}/other`;
  const p = await personWith(key, 'cal');
  const gh = fakeGitHub({ [key]: { id: 9022, owner: `cal${RUN}`, installation: 88 } });
  assert.deepEqual(await proveByApp({ builderId: p.id, repoKey: key, githubInstallationId: 89 }, { fetch: gh }), { ok: false, why: 'none' });
  assert.deepEqual(await repoProof(p.id, key), { ok: false, why: 'none' });
});

test('6.17 fix round 1: the daily check demotes an org repo whose prover is no longer its admin; an admin stays held', db, async () => {
  const key = `org${RUN}/tool`;
  const p = await personWith(key, 'dee');
  const gh = fakeGitHub({ [key]: { id: 9030, owner: `org${RUN}`, ownerType: 'Organization', installation: 90, admins: [`dee${RUN}`] } });
  assert.equal(((await installApp({ builderId: p.id, repoKey: key, login: `dee${RUN}`, gh })) as { ok: boolean }).ok, true);
  const later = new Date(Date.now() + 25 * 3_600_000);
  assert.deepEqual(await appCheckStep(later, { deadline: Date.now() + 10_000, only: [p.id], fetch: gh }), { checked: 1, removed: 0 });
  gh.repos[key].admins = [];
  assert.deepEqual(await appCheckStep(new Date(later.getTime() + 25 * 3_600_000), { deadline: Date.now() + 10_000, only: [p.id], fetch: gh }), { checked: 1, removed: 1 });
  const [s] = await sql()<{ state: string; reject_reason: string }[]>`SELECT state, reject_reason FROM builder_sources WHERE builder_id = ${p.id} AND lower(ref) = ${key}`;
  assert.deepEqual(s, { state: 'proposed', reject_reason: APP_REMOVED });
});
