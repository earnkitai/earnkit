import { after, test } from 'node:test';
import { checkFitsAsked, walletOffered } from './fixtures/wallet-step';
import { connectAsk } from './connect-moment';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sql } from './db';
import { appSetup } from './github-app';
import { APP_CONFIRM_ONLY_YOURS, createVerifyLink, csrfCookieName, verifyStart } from './github-verify';
import { connectInstallation, saveInstallation } from './installations';
import { mcpCall } from './fixtures/mcp-call';
import { type FakeGitHub, fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { APP_REMOVED, appCheckStep, budgetedFetch, installLink, proveByApp, repoProof } from './repo-proof';
import { ScoreDeadline } from './campaigns';
import { attachToX } from './x-install';
import { readSources } from './sources';
import { readPersonLive, rescorePerson } from './person-score';
import { defaultReaderDeps } from './source-readers';
import { proveRepo, tokenGate } from './token-gate';
import { padPool } from './fixtures/rank-pool';

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
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }), readerDeps } as never;
  await mcpCall(ctx, 'find', { identity: { project: { name: key.split('/')[1], repo: `https://github.com/${key}` } } });
  // v4.0: setup step 3 answered (this test is about another reply).
  await walletOffered(c.id);
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
  // v3.1 F3: the pool reaches RANK_MIN_POOL, so a rank shows.
  await padPool(9);
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
  // R4, R16c: read at connect with no commits, it ranks at 0 and the stand line is the score line.
  // v4.7.1 T1: the standing paragraph ("Score 0 · #1 of 10 builders. ..."), never "Notes · #1 of 10 builders".
  assert.match(String(r.reply?.show_to_builder), /^Score 0 · (#\d+ of \d+ builders?|Top [\d.]+% of builders)\. /m);
});

/** A person who named `key` and installed the App on it through the setup URL (appSetup, proveByApp). */
async function connected(key: string, handle: string, gh: ReturnType<typeof fakeGitHub>, inst: number) {
  const p = await personWith(key, handle);
  const nonce = new URL((await createVerifyLink({ installationId: p.id, projectId: null, repoKey: key, purpose: 'app' }, NOW))).searchParams.get('n')!;
  await sql()`UPDATE github_verify_nonces SET login = ${`${handle}${RUN}`}, account_created_at = '2020-01-01', public_repos = 3 WHERE nonce_hash = ${sha(nonce)}`;
  const res = await appSetup(new Request(`https://earnkit.com/github/verify/app?installation_id=${inst}&state=${nonce}`, { headers: { cookie: `${csrfCookieName(nonce)}=x` } }), { fetch: gh, limit: async () => {} });
  assert.equal(res.status, 200);
  const [live] = await sql()<{ score: number; ranked: boolean; parts: { shipping?: { raw?: Record<string, number> } } }[]>`SELECT score, ranked, parts FROM builder_live WHERE builder_id = ${p.id}`;
  return { ...p, live };
}
const ago = (weeks: number) => new Date(Date.now() - weeks * 7 * 86_400_000).toISOString();

test('6.2b R5 scored at connect: right after the App setup, a repo with commits has a real Shipping score and a rank', db, async () => {
  // v3.1 F3: the pool reaches RANK_MIN_POOL, so a rank shows.
  await padPool(9);
  const key = `gwen${RUN}/ships`;
  const commits = [0, 1, 2, 5].map((w, i) => ({ sha: `c${i}`, message: `change ${i}`, date: ago(w) }));
  const gh = fakeGitHub({ [key]: { id: 9101, owner: `gwen${RUN}`, installation: 91, private: true, commits } });
  const p = await connected(key, 'gwen', gh, 91);
  await walletOffered(p.id);
  // Weeks 0, 1, 2 and 5: weights 12 + 11 + 10 + 7 = 40 of 78, so round(90 x 40 / 78) = 46.
  assert.equal(p.live.score, 46);
  assert.equal(p.live.ranked, true);
  assert.equal(p.live.parts.shipping?.raw?.weeks, 4);
  // One reading, with the installation's token (never EarnKit's shared one).
  const reads = gh.calls.filter((c) => c.path === '/graphql');
  assert.equal(reads.length, 1);
  assert.equal(reads[0].auth, 'Bearer ghs_fake_91');
  // v3 Stage 1 Task 5, Task 16 step 3: the first ranked reply after connect offers the backfilled weeks in one yes.
  const first = String((await mcpCall(p.ctx, 'score', {})).reply?.show_to_builder);
  // v4.7 T2: score leads with the standing paragraph (the page's score and rank), so the connect reply's own standing is left out.
  assert.match(first, /^Score 46 · (#\d+ of \d+ builders?|Top [\d.]+% of builders)\. 3 weeks shipping in a row\. No grants won yet\.\n\n/, first);
  assert.doesNotMatch(first, /is on the leaderboard/, first);
  // v3.1 cold read: the question names no week count (it never disagrees with the streak).
  const m = /\nMake your shipping log public on (https:\/\/earnkit\.com\/\S+) so grant teams can see it\?$/.exec(first);
  assert.ok(m && first.endsWith(connectAsk(m[1])) && !/points/.test(first), first);
  const r = await mcpCall(p.ctx, 'score', {});
  const text = String(r.reply?.show_to_builder);
  // R16a: one ranked state; Task 16: the standing line carries the rank and the streak (v4.7 T2: score's standing paragraph).
  assert.match(text, /^Score 46 · (#\d+ of \d+ builders?|Top [\d.]+% of builders)\. 3 weeks shipping in a row\. No grants won yet\.$/m, text);
  assert.equal(r.reply?.streak, 3, 'the streak is still in the reply fields');
  // v3.1 F4: the why sentence stays on the page, never in the reply.
  assert.doesNotMatch(text, /Code in \d+ of the last 12 weeks/, text);
  // 2026-10-22: a private repo with titles off: the titles question, once.
  assert.ok(text.endsWith('\nShow what you shipped (commit titles) on your page so grant teams see real progress? Your code stays private.'), text);
  // L5: this week has code ("Done this week"): the plain points line. v4.3: the qualify reply carries no ship line, so
  // Base's grant steps are declined here and the ranked step is the ship step.
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('declined', jsonb_build_object(${`qualify:${key}`}::text, ${new Date().toISOString()}::text)) WHERE builder_id = ${p.id}`;
  // v4.7.1 T1: with no fit, check_fits comes once before the ship step (v471-money.test.ts); asked already here.
  await checkFitsAsked(p.id);
  const next = String((await mcpCall(p.ctx, 'score', {})).reply?.show_to_builder);
  // v4.7 T4: the ship ask carries its why line in place of the ship line.
  assert.ok(next.endsWith('\nShip code this week.') || /\nShipping this week (keeps your \d+-week streak|starts your streak) and lifts your score\.\n\n[^\n]*\?$/.test(next), next);
  assert.doesNotMatch(next, /Your code stays private/);
});

test('6.2c R5 fail soft: a reading that fails at connect leaves the proof standing, unranked until a repo reading exists', db, async () => {
  const key = `fynn${RUN}/down`;
  const repos = { [key]: { id: 9102, owner: `fynn${RUN}`, installation: 92, private: true, commits: [{ sha: 'a', message: 'x', date: ago(0) }] } };
  const base = fakeGitHub(repos);
  const gh = Object.assign((async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith('/graphql') ? new Response('{}', { status: 502 }) : base(input, init)) as typeof fetch, { calls: base.calls, repos });
  const p = await connected(key, 'fynn', gh, 92);
  assert.deepEqual(await repoProof(p.id, key), { ok: true, via: 'app', owner: `fynn${RUN}`, private: true });
  assert.equal(p.live.ranked, false, 'R4: no repo reading yet, no rank');
  assert.equal(p.live.score, 0);
  // The failed read writes nothing over the find's earlier attempt, so the next refresh reads it again.
  const rows = await sql()<{ ok: boolean; read_at: Date }[]>`SELECT l.ok, l.read_at FROM source_live l JOIN builder_sources s ON s.id = l.source_id WHERE s.builder_id = ${p.id} AND s.kind = 'repo'`;
  assert.ok(rows.every((x) => x.ok === false && x.read_at.getTime() < Date.now() - 1), JSON.stringify(rows));
  assert.equal(gh.calls.filter((c) => c.path === '/graphql').length, 0, 'the 502 went through the wrapper');
});

test('6.2e fix round 2 (anti-backdating rule 4): a first reading keeps only weeks a push landed in (or right before); if the push list fails, the weeks stand', db, async () => {
  const commits = Array.from({ length: 12 }, (_, w) => ({ sha: `b${w}`, message: `old ${w}`, date: ago(w) }));
  // Every backdated commit was pushed today.
  const key = `hugo${RUN}/back`;
  const gh = fakeGitHub({ [key]: { id: 9103, owner: `hugo${RUN}`, installation: 93, private: true, commits, pushes: [new Date().toISOString()] } });
  const p = await connected(key, 'hugo', gh, 93);
  // This week and last week only: round(90 x (12 + 11) / 78) = 27.
  assert.equal(p.live.score, 27);
  assert.equal(p.live.parts.shipping?.raw?.weeks, 2);
  const act = gh.calls.filter((c) => c.path.startsWith(`/repos/${key}/activity`));
  assert.equal(act.length, 1, 'one page (short), with the installation token');
  assert.equal(act[0].auth, 'Bearer ghs_fake_93');
});

test('6.2f fix rounds 3 and 4: an unverified first reading (the push list fails, the deadline) counts its last 4 weeks, is checked again on the next reads, and verifies once GitHub answers', db, async () => {
  const commits = Array.from({ length: 12 }, (_, w) => ({ sha: `b${w}`, message: `old ${w}`, date: ago(w) }));
  const liveOf = async (id: number) => (await sql()<{ score: number; signals: { pushes_checked?: boolean; push_tries?: number } }[]>`
    SELECT l.score, x.signals FROM builder_live l JOIN builder_sources s ON s.builder_id = l.builder_id AND s.kind = 'repo'
    JOIN source_live x ON x.source_id = s.id WHERE l.builder_id = ${id}`)[0];
  // The activity endpoint fails: never zero, only the last 4 weeks (12 + 11 + 10 + 9 = 42 of 78: 48).
  const key = `iris${RUN}/soft`;
  const repos = { [key]: { id: 9104, owner: `iris${RUN}`, installation: 94, private: true, commits, pushes: null as string[] | null } };
  const gh = fakeGitHub(repos);
  const q = await connected(key, 'iris', gh, 94);
  assert.equal(q.live.score, 48);
  assert.deepEqual([(await liveOf(q.id)).signals.pushes_checked, (await liveOf(q.id)).signals.push_tries], [false, undefined]);
  const [{ sid }] = await sql()<{ sid: number }[]>`SELECT id::int AS sid FROM builder_sources WHERE builder_id = ${q.id} AND kind = 'repo'`;
  const reread = async (f: typeof fetch, ms: number) => {
    const deadline = Date.now() + ms;
    await readPersonLive(q.id, new Date(), { deadline, reader: { ...defaultReaderDeps(new Date(), deadline), ghFetch: budgetedFetch(f, deadline) }, only: [sid], soft: true });
    await rescorePerson(q.id, new Date());
  };
  // Fix round 4: failing again and again never falls back to all weeks.
  for (let i = 0; i < 3; i++) await reread(gh, 8_000);
  assert.deepEqual([(await liveOf(q.id)).signals.pushes_checked, (await liveOf(q.id)).score], [false, 48]);
  const asked = gh.calls.filter((c) => c.path.startsWith(`/repos/${key}/activity`)).length;
  assert.equal(asked, 4, 'one activity check a read while unverified');
  // The next read: the activity call hangs and is aborted at the deadline: still unverified.
  repos[key].pushes = [new Date().toISOString()];
  const hangActivity = ((input: RequestInfo | URL, init?: RequestInit) => String(input).includes('/activity')
    ? new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
    : gh(input, init)) as typeof fetch;
  const t0 = Date.now();
  await reread(hangActivity, 1_500);
  assert.ok(Date.now() - t0 < 5_000, 'the hung page was aborted at the budget');
  assert.deepEqual([(await liveOf(q.id)).signals.pushes_checked, (await liveOf(q.id)).score], [false, 48]);
  // GitHub answers: every commit was pushed today, so only this week and last week stand (27), verified.
  await reread(gh, 8_000);
  assert.deepEqual([(await liveOf(q.id)).signals.pushes_checked, (await liveOf(q.id)).score], [true, 27]);
});

test('6.2g fix rounds 4 and 5: a full activity page: backdated weeks under a 200-branch flood never count, 28+ days later or with one push from a year ago; a busy repo keeps its history; no real gap, backed weeks only', db, async () => {
  const act = (gh: FakeGitHub, key: string) => gh.calls.filter((c) => c.path.startsWith(`/repos/${key}/activity`)).map((c) => c.path.replace(`/repos/${key}`, ''));
  // Commits dated 4 to 15 weeks ago, all pushed 30 days ago with 200 new branches, plus one real push a year ago; read now.
  const pushedAt = Date.now() - 30 * 86_400_000;
  const fake = Array.from({ length: 12 }, (_, i) => ({ sha: `f${i}`, message: `fake ${i}`, date: ago(i + 4) }));
  const flood = [
    { at: ago(52), type: 'push' },
    { at: new Date(pushedAt).toISOString(), type: 'push' },
    ...Array.from({ length: 200 }, (_, i) => ({ at: new Date(pushedAt + (i + 1) * 1_000).toISOString(), type: 'branch_creation' })),
  ];
  const key = `kai${RUN}/flood`;
  const gh = fakeGitHub({ [key]: { id: 9106, owner: `kai${RUN}`, installation: 100, private: true, commits: fake, pushes: flood } });
  const p = await connected(key, 'kai', gh, 100);
  assert.deepEqual(act(gh, key), ['/activity?per_page=100', '/activity?direction=asc&per_page=100']);
  // Only the push week (4 or 5 weeks ago) and the week before it stand: 2 weeks, not 12.
  assert.equal(p.live.parts.shipping?.raw?.weeks, 2);
  assert.ok(p.live.score <= 20, String(p.live.score));

  // A busy repo: 25 real pushes every week for 12 weeks (300 events). The pages back both ends, the middle is a
  // real gap between two full pages: 12 weeks (90).
  const real = Array.from({ length: 12 }, (_, w) => ({ sha: `r${w}`, message: `real ${w}`, date: ago(w) }));
  const busy = Array.from({ length: 300 }, (_, i) => new Date(Date.now() - Math.floor(i / 25) * 7 * 86_400_000 - (i % 25) * 60_000).toISOString());
  const key2 = `lou${RUN}/busy`;
  const gh2 = fakeGitHub({ [key2]: { id: 9107, owner: `lou${RUN}`, installation: 101, private: true, commits: real, pushes: busy } });
  const b = await connected(key2, 'lou', gh2, 101);
  assert.equal(b.live.parts.shipping?.raw?.weeks, 12);
  assert.equal(b.live.score, 90);
});

test('6.2d fix round 1: the connect read\'s budget holds on every call: a hung request is aborted at the deadline, none starts after it', async () => {
  let seen: AbortSignal | undefined;
  const hang = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_, reject) => {
    seen = init?.signal ?? undefined;
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
  })) as typeof fetch;
  const t0 = Date.now();
  await assert.rejects(budgetedFetch(hang, Date.now() + 60)('https://api.github.com/graphql', { method: 'POST' }));
  assert.ok(Date.now() - t0 < 2_000, 'aborted near the deadline, not left hanging');
  assert.equal(seen?.aborted, true);
  await assert.rejects(budgetedFetch(hang, Date.now() - 1)('https://api.github.com/graphql'), (e) => e instanceof ScoreDeadline);
  // The request's own signal still applies.
  const own = new AbortController();
  const p = budgetedFetch(hang, Date.now() + 60_000)('https://api.github.com/x', { signal: own.signal });
  own.abort(new Error('own'));
  await assert.rejects(p, /own/);
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
  assert.doesNotMatch(String((await mcpCall(p.ctx, 'find', {})).reply?.show_to_builder), /is on the leaderboard/);
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

test('6.18 fix round 1 (ruling): an action on an App proof older than a day checks GitHub now: held passes and refreshes, gone demotes and refuses, unknown refuses', db, async () => {
  const key = `eli${RUN}/live`;
  const p = await personWith(key, 'eli');
  const gh = fakeGitHub({ [key]: { id: 9031, owner: `eli${RUN}`, installation: 91 } });
  await installApp({ builderId: p.id, repoKey: key, login: `eli${RUN}`, gh });
  const age = () => sql()`UPDATE builder_sources SET app_checked_at = now() - interval '27 hours' WHERE builder_id = ${p.id} AND kind = 'repo'`;
  const checkedAt = async () => (await sql()<{ at: Date }[]>`SELECT app_checked_at AS at FROM builder_sources WHERE builder_id = ${p.id} AND kind = 'repo'`)[0].at;
  // Held: passes, refreshed.
  await age();
  assert.equal((await repoProof(p.id, key, undefined, { forAction: true, fetch: gh })).ok, true);
  assert.ok(Date.now() - (await checkedAt()).getTime() < 60_000, 'refreshed');
  // Unknown (GitHub errors): refused, still verified.
  await age();
  const down = (async () => new Response('{}', { status: 502 })) as unknown as typeof fetch;
  assert.deepEqual(await repoProof(p.id, key, undefined, { forAction: true, fetch: down }), { ok: false, why: 'none' });
  assert.equal((await repoProof(p.id, key)).ok, true, 'still counted');
  // Gone (uninstalled): demoted and refused.
  gh.repos[key].installation = null;
  assert.deepEqual(await repoProof(p.id, key, undefined, { forAction: true, fetch: gh }), { ok: false, why: 'none' });
  const [s] = await sql()<{ state: string; reject_reason: string }[]>`SELECT state, reject_reason FROM builder_sources WHERE builder_id = ${p.id} AND kind = 'repo'`;
  assert.deepEqual(s, { state: 'proposed', reject_reason: APP_REMOVED });
});

test('6.19 T6-2, final fix: a shared client never passes the coin gate, even when its group holds a fresh App source', db, async () => {
  const t = `ek_app_sh_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, true, 'Grok');
  const c = (await connectInstallation(t))!;
  const key = `fay${RUN}/shared`;
  await sql()`
    INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose, via, github_installation_id)
    VALUES (${key}, ${`fay${RUN}`}, ${c.id}, now(), 3, 'app', 'app', 92)`;
  await sql()`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by, state, proof, verified_at, gh_owner, gh_owner_type, app_checked_at)
    VALUES (${c.id}, 'repo', ${key}, ${key}, 'server', 'verified', 'github_app', now(), ${`fay${RUN}`}, 'User', now())`;
  // The real shared read and the real appProven: no person, no proof (no install link either: no page).
  const r = await tokenGate(
    { policy: 'allowed', installationId: c.id, repoUrl: `https://github.com/${key}`, wallet: `0x${'1'.repeat(40)}`, symbol: 'FAY' },
    { repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null, defaultBranch: 'main', public: true }), screen: async () => {}, appLink: async () => null },
  );
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /read-only EarnKit app/);
  assert.equal(await proveRepo({ installationId: c.id, repoUrl: `https://github.com/${key}` }), null, 'no action proof either');
});

test('6.20 fix round 1 (ruling): an App proof replaces another person\'s discovery-derived hold; another person\'s App hold still gives taken', db, async () => {
  const key = `hal${RUN}/held`;
  const holder = await personWith(key, 'hal');
  await sql()`UPDATE builder_sources SET state = 'verified', proof = 'x_match', verified_at = now() WHERE builder_id = ${holder.id} AND kind = 'repo' AND lower(ref) = ${key}`;
  const prover = await personWith(key, 'ivy');
  const gh = fakeGitHub({ [key]: { id: 9050, owner: `hal${RUN}`, installation: 94, admins: [`ivy${RUN}`] } });
  assert.equal(((await installApp({ builderId: prover.id, repoKey: key, login: `ivy${RUN}`, gh })) as { ok: boolean }).ok, true);
  const [old] = await sql()<{ state: string; reject_reason: string }[]>`SELECT state, reject_reason FROM builder_sources WHERE builder_id = ${holder.id} AND lower(ref) = ${key}`;
  assert.deepEqual(old, { state: 'proposed', reject_reason: 'replaced_by_app' });
  assert.equal((await repoProof(prover.id, key)).ok, true);
  assert.deepEqual(await repoProof(holder.id, key), { ok: false, why: 'taken' });
  // The first holder installing the App now: the App hold stays the prover's.
  assert.deepEqual(await installApp({ builderId: holder.id, repoKey: key, login: `hal${RUN}`, gh }), { ok: false, why: 'taken' });
});

test('6.21 fix round 2: a redirect from GitHub (renamed or transferred repo) is gone: demoted at the daily check', db, async () => {
  const key = `jan${RUN}/moved`;
  const p = await personWith(key, 'jan');
  const gh = fakeGitHub({ [key]: { id: 9060, owner: `jan${RUN}`, installation: 95 } });
  await installApp({ builderId: p.id, repoKey: key, login: `jan${RUN}`, gh });
  const moved = (async (input: RequestInfo | URL, init?: RequestInit) =>
    new URL(String(input)).pathname === `/repos/${key}/installation` ? new Response(null, { status: 301, headers: { location: 'https://api.github.com/repositories/9060/installation' } }) : gh(input, init)) as typeof fetch;
  assert.deepEqual(await appCheckStep(new Date(Date.now() + 25 * 3_600_000), { deadline: Date.now() + 10_000, only: [p.id], fetch: moved }), { checked: 1, removed: 1 });
  const [s] = await sql()<{ state: string; reject_reason: string }[]>`SELECT state, reject_reason FROM builder_sources WHERE builder_id = ${p.id} AND kind = 'repo'`;
  assert.deepEqual(s, { state: 'proposed', reject_reason: APP_REMOVED });
});

test('6.22 fix round 2: rows GitHub keeps not answering never starve the daily queue', db, async () => {
  const key = `kai${RUN}/ok`;
  const p = await personWith(key, 'kai');
  const gh = fakeGitHub({ [key]: { id: 9061, owner: `kai${RUN}`, installation: 96 } });
  await installApp({ builderId: p.id, repoKey: key, login: `kai${RUN}`, gh });
  // 55 App sources GitHub won't answer for, tried an hour ago and checked longer ago than the good one.
  await sql()`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by, state, proof, verified_at, gh_owner, gh_owner_type, app_checked_at, app_tried_at)
    SELECT ${p.id}, 'repo', ${`kai${RUN}/down`} || n, ${`kai${RUN}/down`} || n, 'server', 'verified', 'github_app', now(), ${`kai${RUN}`}, 'User',
      now() - interval '40 hours', now() - interval '1 hour'
    FROM generate_series(1, 55) n`;
  await sql()`UPDATE builder_sources SET app_checked_at = now() - interval '30 hours', app_tried_at = NULL WHERE builder_id = ${p.id} AND lower(ref) = ${key}`;
  const flaky = (async (input: RequestInfo | URL, init?: RequestInit) =>
    new URL(String(input)).pathname.includes('/down') ? new Response('{}', { status: 502 }) : gh(input, init)) as typeof fetch;
  const r = await appCheckStep(new Date(), { deadline: Date.now() + 20_000, only: [p.id], fetch: flaky });
  assert.ok(r.checked >= 1, JSON.stringify(r));
  const [good] = await sql()<{ fresh: boolean }[]>`SELECT app_checked_at > now() - interval '1 minute' AS fresh FROM builder_sources WHERE builder_id = ${p.id} AND lower(ref) = ${key}`;
  assert.equal(good.fresh, true, 'the answerable row was checked');
  const [{ tried }] = await sql()<{ tried: number }[]>`SELECT count(*)::int AS tried FROM builder_sources WHERE builder_id = ${p.id} AND app_tried_at > now() - interval '1 minute'`;
  assert.equal(tried, 50, 'every attempt is stamped, one run at most APP_CHECK_PER_RUN');
});

test('6.23 fix round 2: a second org admin whose App proof was taken is refused on a shared client', db, async () => {
  const key = `lux${RUN}/org`;
  const first = await personWith(key, 'lux');
  const gh = fakeGitHub({ [key]: { id: 9062, owner: `lux${RUN}`, ownerType: 'Organization', installation: 97, admins: [`lux${RUN}`, `max${RUN}`] } });
  assert.equal(((await installApp({ builderId: first.id, repoKey: key, login: `lux${RUN}`, gh })) as { ok: boolean }).ok, true);
  const t = `ek_app_sh2_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, true, 'Grok');
  const c = (await connectInstallation(t))!;
  // The second admin's setup URL wrote a verification on the shared client; proveByApp held nothing there.
  await sql()`
    INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose, via, github_installation_id)
    VALUES (${key}, ${`max${RUN}`}, ${c.id}, now(), 3, 'app', 'app', 97)`;
  assert.deepEqual(await proveByApp({ builderId: c.id, repoKey: key, githubInstallationId: 97 }, { fetch: gh }), { ok: false, why: 'none' });
  assert.equal(await proveRepo({ installationId: c.id, repoUrl: `https://github.com/${key}` }), null);
});

test('6.24 final fix 7: a caller with no page is never sent to createVerifyLink for an unseen repo, and no error is logged', db, async () => {
  const t = `ek_app_nolink_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c = (await connectInstallation(t))!;
  let matched = 0;
  const no = async () => { throw new Error('offline'); };
  const readerDeps = new Proxy({}, { get: (_t, k) => (k === 'now' ? new Date() : k === 'ghSpent' ? () => false : k === 'ghFetch' ? undefined : no) });
  const ctx = {
    installationId: c.id, ownInstallationId: c.own, sharedClient: false, readerDeps,
    matchProjects: async () => ((matched++), { checked: 1, scored: 0, fits: [], unseen: [{ name: 'secret', full_name: `nolink${RUN}/secret` }] }),
  } as never;
  const logged: string[] = [];
  const err = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  try {
    await mcpCall(ctx, 'find', { repos: [`https://github.com/nolink${RUN}/secret`] });
  } finally {
    console.error = err;
  }
  assert.ok(matched > 0, 'matching ran');
  assert.deepEqual(logged.filter((l) => l.includes('app link')), []);
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM github_verify_nonces WHERE installation_id = ${c.id}`;
  assert.equal(n, 0);
});
