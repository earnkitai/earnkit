import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sql } from './db';
import { GITHUB_INSTALLATIONS_URL, PICK_ADMIN_CHECKS, PICK_PAGE, appSetup } from './github-app';
import { APP_CONFIRM_ONLY_YOURS, PICK_REPOS, createVerifyLink, csrfCookieName, verifyStart } from './github-verify';
import { connectInstallation, saveInstallation } from './installations';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub, type FakeCommit, type FakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { mainProjectOf } from './main-project';
import { backfillMondays } from './week-facts';
import { attachToX } from './x-install';

/**
 * Launch ready L2: the repo picker on install. A signed-in builder with no project is offered the read-only App
 * with GitHub's own repo picker (never asked for a GitHub URL); the setup URL proves each picked repo with every
 * proveByApp rule, and the most recently pushed one becomes the one project, read, ranked and backfilled at once.
 * Agent input goes through the real MCP layer (mcpCall); GitHub is the fake.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
const DAY = 86_400_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const noLimit = { limit: async () => {} };
const MONDAYS = backfillMondays(new Date());
const ago = (days: number, sha: string, message = `change ${sha}`): FakeCommit => ({ sha, message, date: new Date(Date.now() - days * DAY).toISOString() });
const NO_MATCH = async () => ({ checked: 0, scored: 0, fits: [] });

let nextX = 0;
/** A builder signed in with X at install (a page, no project yet). */
async function signedIn(handle: string) {
  const t = `ek_pick_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const username = `${handle}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `96${RUN}${++nextX}`, username, name: handle, avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const no = async () => { throw new Error('offline'); };
  const readerDeps = new Proxy({}, { get: (_t, k) => (k === 'now' ? new Date() : k === 'ghSpent' ? () => false : k === 'ghFetch' ? undefined : no) });
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: NO_MATCH, readerDeps } as never;
  return { id: c.id, ctx, username, login: username.toLowerCase() };
}

/** The no-project find's picker link (one https link in show_to_builder). */
async function pickerLink(ctx: never): Promise<string> {
  const s = String((await mcpCall(ctx, 'find', {})).reply?.show_to_builder);
  const [link] = links(s);
  assert.match(link ?? '', /^https:\/\/earnkit\.com\/github\/verify\?n=/, s);
  return link!;
}

/** The link's GitHub sign-in hop names `login` (as its callback would), then GitHub sends the browser to the setup URL. */
async function setup(link: string, login: string, installation: number, gh: FakeGitHub) {
  const nonce = new URL(link).searchParams.get('n')!;
  await sql()`UPDATE github_verify_nonces SET login = ${login}, account_created_at = '2020-01-01', public_repos = 3 WHERE nonce_hash = ${sha(nonce)}`;
  const res = await appSetup(new Request(`https://earnkit.com/github/verify/app?installation_id=${installation}&state=${nonce}`, {
    headers: { cookie: `${csrfCookieName(nonce)}=x` } }), { fetch: gh, ...noLimit });
  return { res, text: await res.text(), nonce };
}

const source = async (id: number, key: string) => (await sql()<{ state: string; proof: string | null; reject_reason: string | null }[]>`
  SELECT state, proof, reject_reason FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo' AND lower(ref) = ${key}
  ORDER BY (state = 'verified') DESC, id LIMIT 1`)[0] ?? null;

test('L2.1 signed in with no project: the reply carries the repo picker link and never asks for a GitHub URL', db, async () => {
  const p = await signedIn('ana');
  const r = await mcpCall(p.ctx, 'find', {});
  const s = String(r.reply?.show_to_builder);
  assert.match(s, /How to move up\nInstall the read-only EarnKit app on the repo you want ranked \(one click\): https:\/\/earnkit\.com\/github\/verify\?n=\S+\nWant me to rank it once that's done\?$/, s);
  assert.doesNotMatch(s, /What's your GitHub|link to something you've made/);
  assert.equal(links(s).length, 1, 'one https link (the page is named without https)');
  assert.ok(s.includes(`Your page: earnkit.com/${p.username}`), s);
  assert.equal((r.reply?.move_up as { kind?: string })?.kind, 'pick_repo');
  // The link is a repo-less App nonce for this person's page.
  const [row] = await sql()<{ repo_key: string; purpose: string; installation_id: number }[]>`
    SELECT repo_key, purpose, installation_id FROM github_verify_nonces WHERE nonce_hash = ${sha(new URL(links(s)[0]!).searchParams.get('n')!)}`;
  assert.deepEqual(row, { repo_key: PICK_REPOS, purpose: 'app', installation_id: p.id });
  // A yes is told to wait for the install, then find again.
  const yes = await mcpCall(p.ctx, 'tell', { move_up: { kind: 'pick_repo', project_key: null, answer: 'yes' } });
  assert.match(String(yes.reply?.agent_note), /installed EarnKit from the link and picked their repos/);
});

test('L2.2 S7: the picker\'s confirm page names the page every repo goes to; no page, no link', db, async () => {
  const p = await signedIn('ben');
  const link = await pickerLink(p.ctx);
  const page = await verifyStart(new Request(link), noLimit);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes(`This connects your repos to earnkit.com/${p.username}. ${APP_CONFIRM_ONLY_YOURS}`), html);
  assert.ok(html.includes('The ones you pick on GitHub'), html);
  assert.doesNotMatch(html, /This adds github\.com\//);
  assert.match(page.headers.get('set-cookie') ?? '', /^__Host-ekv-/);
  // An installation with no page (never signed in with X) gets no picker link.
  const t = `ek_pick_anon_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const anon = (await connectInstallation(t))!;
  await assert.rejects(createVerifyLink({ installationId: anon.id, projectId: null, repoKey: null, purpose: 'app' }), /page handle/);
});

test('L2.3 two picked repos: both proven, the most recently pushed is the one project, read, ranked and backfilled', db, async () => {
  const p = await signedIn('cat');
  const older = `${p.login}/older`;
  const newer = `${p.login}/newer`;
  const inst = Number(`61${RUN}`);
  const gh = fakeGitHub({
    [older]: { id: Number(`71${RUN}`), owner: p.login, installation: inst, commits: [ago(40, 'o1')] },
    [newer]: { id: Number(`72${RUN}`), owner: p.login, installation: inst, private: true, pulls: [],
      commits: [ago(15, 'n1', 'Add the share card'), ago(8, 'n2', 'Fix the timer'), ago(1, 'n3', 'Ship dark mode')] },
  });
  const link = await pickerLink(p.ctx);
  const { res, text } = await setup(link, p.login, inst, gh);
  assert.equal(res.status, 200, text);
  // Fix round 1 (I1, I2): the page names the ranked repo, the page it is on, and the way out.
  assert.ok(text.includes(`Done. EarnKit now ranks github.com/${newer} on earnkit.com/${p.username}. Tell your agent if you want a different repo ranked.`), text);
  assert.ok(text.includes(`${PICK_PAGE.remove(true)} <a href="${GITHUB_INSTALLATIONS_URL}"`), text);
  assert.equal(links(text.replace(/<[^>]+>/g, ' ')).length, 1, 'one link on the page');
  for (const key of [older, newer]) assert.deepEqual(await source(p.id, key), { state: 'verified', proof: 'github_app', reject_reason: null });
  assert.equal(await mainProjectOf(p.id), newer);
  // One verification per picked repo, for this installation (appProofLive reads them).
  const v = await sql()<{ repo_key: string }[]>`SELECT repo_key FROM github_verifications WHERE installation_id = ${p.id} AND via = 'app' AND github_installation_id = ${inst} ORDER BY repo_key`;
  assert.deepEqual(v.map((x) => x.repo_key), [newer, older]);
  // Read at connect with the installation's own token, then ranked.
  assert.ok(gh.calls.some((c) => c.path === '/graphql' && c.auth === `Bearer ghs_fake_${inst}`));
  const [live] = await sql()<{ ranked: boolean; score: number }[]>`SELECT ranked, score FROM builder_live WHERE builder_id = ${p.id}`;
  assert.equal(live.ranked, true);
  assert.ok(live.score > 0, String(live.score));
  // R13: the one project's last 3 finished weeks were written at connect.
  const weeks = await sql()<{ week: string }[]>`SELECT week::text AS week FROM project_updates WHERE builder_id = ${p.id} AND lower(project_key) = ${newer} AND week IN ${sql()(MONDAYS)}`;
  assert.equal(weeks.length, 3);
  const s = String((await mcpCall(p.ctx, 'find', {})).reply?.show_to_builder);
  assert.match(s, /^Newer: Shipping \d+ · (#\d+ of \d+ builders?|Top [\d.]+% of builders) this week\./m, s);
  assert.ok(gh.calls.every((c) => c.routed), 'every GitHub call was one the fake answers');
});

test('L2.4 a fork in the picked set is skipped; the rest are proven', db, async () => {
  const p = await signedIn('dan');
  const mine = `${p.login}/mine`;
  const fork = `${p.login}/forked`;
  const inst = Number(`62${RUN}`);
  const gh = fakeGitHub({
    [mine]: { id: Number(`73${RUN}`), owner: p.login, installation: inst, commits: [ago(3, 'm1')] },
    // The fork was pushed last, so it would be the one project if it counted.
    [fork]: { id: Number(`74${RUN}`), owner: p.login, installation: inst, fork: true, commits: [ago(1, 'f1')] },
  });
  const { res, text } = await setup(await pickerLink(p.ctx), p.login, inst, gh);
  assert.equal(res.status, 200, text);
  assert.deepEqual(await source(p.id, fork), { state: 'rejected', proof: null, reject_reason: 'derived' });
  assert.equal((await source(p.id, mine))?.proof, 'github_app');
  assert.equal(await mainProjectOf(p.id), mine);
});

test('L2.5 another person\'s App-held repo is taken; their hold stays and the builder\'s other repo is proven', db, async () => {
  const org = `org${RUN}`;
  const shared = `${org}/shared`;
  const other = `${org}/other`;
  const inst = Number(`63${RUN}`);
  const first = await signedIn('eli');
  const p = await signedIn('fay');
  const gh = fakeGitHub({
    [shared]: { id: Number(`75${RUN}`), owner: org, ownerType: 'Organization', installation: inst, admins: [first.login, p.login], commits: [ago(1, 's1')] },
    [other]: { id: Number(`76${RUN}`), owner: org, ownerType: 'Organization', installation: inst, admins: [p.login], commits: [ago(2, 'x1')] },
  });
  assert.equal(((await installApp({ builderId: first.id, repoKey: shared, login: first.login, gh })) as { ok?: boolean }).ok, true);
  const { res, text } = await setup(await pickerLink(p.ctx), p.login, inst, gh);
  assert.equal(res.status, 200, text);
  assert.equal((await source(first.id, shared))?.proof, 'github_app', 'the first App holder keeps it');
  // Fix round 1 (M2): it passed the ownership check (an admin), but proveOne's hold check refused it, so no
  // verification row is written (appTokenFor could otherwise mint a token for it).
  const [v] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM github_verifications WHERE installation_id = ${p.id} AND repo_key = ${shared} AND via = 'app'`;
  assert.equal(v.n, 0);
  const [o] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM github_verifications WHERE installation_id = ${p.id} AND repo_key = ${other} AND via = 'app'`;
  assert.equal(o.n, 1);
  assert.notEqual((await source(p.id, shared))?.state, 'verified');
  assert.equal((await source(p.id, other))?.proof, 'github_app');
  assert.equal(await mainProjectOf(p.id), other, 'the newer pushed repo was taken, so the one proven is the one project');
});

test('L2.6 the installer must own or administer each repo; none: nothing is proven', db, async () => {
  const p = await signedIn('gus');
  const org = `club${RUN}`;
  const key = `${org}/site`;
  const inst = Number(`64${RUN}`);
  const gh = fakeGitHub({ [key]: { id: Number(`77${RUN}`), owner: org, ownerType: 'Organization', installation: inst, admins: ['someone-else'], commits: [ago(1, 'c1')] } });
  const { res, text } = await setup(await pickerLink(p.ctx), p.login, inst, gh);
  assert.equal(res.status, 403);
  assert.ok(text.includes(PICK_PAGE.notYours.replace("'", '&#39;')), text);
  assert.equal(await source(p.id, key), null);
  assert.equal(await mainProjectOf(p.id), null);
});

test('L2.7 the nonce is used once: the setup URL again is expired, and nothing more is proven', db, async () => {
  const p = await signedIn('hal');
  const key = `${p.login}/once`;
  const inst = Number(`65${RUN}`);
  const gh = fakeGitHub({ [key]: { id: Number(`78${RUN}`), owner: p.login, installation: inst, commits: [ago(1, 'c1')] } });
  const link = await pickerLink(p.ctx);
  const one = await setup(link, p.login, inst, gh);
  assert.equal(one.res.status, 200, one.text);
  const calls = gh.calls.length;
  const again = await appSetup(new Request(`https://earnkit.com/github/verify/app?installation_id=${inst}&state=${one.nonce}`, {
    headers: { cookie: `${csrfCookieName(one.nonce)}=x` } }), { fetch: gh, ...noLimit });
  assert.equal(again.status, 410);
  assert.equal(gh.calls.length, calls, 'no GitHub call for a used link');
  // Without this browser's cookie, refused before the nonce is read.
  const fresh = await createVerifyLink({ installationId: p.id, projectId: null, repoKey: null, purpose: 'app' });
  const n = new URL(fresh).searchParams.get('n')!;
  const nocookie = await appSetup(new Request(`https://earnkit.com/github/verify/app?installation_id=${inst}&state=${n}`), { fetch: gh, ...noLimit });
  assert.equal(nocookie.status, 403);
});

test('L2.8 fix round 1 (I1): an unconfirmed one project not picked is replaced by the newest picked repo, and the page names it', db, async () => {
  const p = await signedIn('ivy');
  const named = `${p.login}/named`;
  await mcpCall(p.ctx, 'find', { identity: { project: { name: 'Named', repo: `https://github.com/${named}` } } });
  assert.equal(await mainProjectOf(p.id), named);
  const added = `${p.login}/added`;
  const inst = Number(`66${RUN}`);
  const gh = fakeGitHub({ [added]: { id: Number(`79${RUN}`), owner: p.login, installation: inst, commits: [ago(1, 'a1')] } });
  const link = await createVerifyLink({ installationId: p.id, projectId: null, repoKey: null, purpose: 'app' });
  const { res, text } = await setup(link, p.login, inst, gh);
  assert.equal(res.status, 200, text);
  assert.ok(text.includes(PICK_PAGE.ranked(added, p.username)), text);
  assert.equal(await mainProjectOf(p.id), added, 'the unconfirmed named repo is replaced');
  assert.equal((await source(p.id, added))?.proof, 'github_app');
});

test('L2.8b fix round 1 (I1): a confirmed one project stays, and the page names it; a picked one project stays too', db, async () => {
  const p = await signedIn('ivo');
  const kept = `${p.login}/kept`;
  const inst = Number(`68${RUN}`);
  const newer = `${p.login}/newer`;
  const gh = fakeGitHub({
    [kept]: { id: Number(`82${RUN}`), owner: p.login, installation: inst, commits: [ago(20, 'k1')] },
    [newer]: { id: Number(`83${RUN}`), owner: p.login, installation: inst, commits: [ago(1, 'n1')] },
  });
  await mcpCall(p.ctx, 'find', { identity: { project: { name: 'Kept', repo: `https://github.com/${kept}` } } });
  assert.equal(((await installApp({ builderId: p.id, repoKey: kept, login: p.login, gh })) as { ok?: boolean }).ok, true);
  assert.match(String((await mcpCall(p.ctx, 'find', {})).reply?.show_to_builder), /^Kept: Shipping /m, 'confirmed');
  const { res, text } = await setup(await createVerifyLink({ installationId: p.id, projectId: null, repoKey: null, purpose: 'app' }), p.login, inst, gh);
  assert.equal(res.status, 200, text);
  assert.equal(await mainProjectOf(p.id), kept, 'one of the picked repos: kept even though another was pushed later');
  assert.ok(text.includes(PICK_PAGE.ranked(kept, p.username)), text);
  // Not among the picked repos (only the newer one picked now) and confirmed: still kept and named.
  const only = fakeGitHub({ [newer]: { id: Number(`83${RUN}`), owner: p.login, installation: inst + 1, commits: [ago(1, 'n1')] } });
  const again = await setup(await createVerifyLink({ installationId: p.id, projectId: null, repoKey: null, purpose: 'app' }), p.login, inst + 1, only);
  assert.equal(again.res.status, 200, again.text);
  assert.equal(await mainProjectOf(p.id), kept);
  assert.ok(again.text.includes(PICK_PAGE.ranked(kept, p.username)), again.text);
});

test('L2.10 fix round 1 (M2, M3): a single-repo link writes no verification for a fork; every proof failing at GitHub is the failed page', db, async () => {
  const p = await signedIn('lea');
  const fork = `${p.login}/copied`;
  const inst = Number(`69${RUN}`);
  const gh = fakeGitHub({ [fork]: { id: Number(`84${RUN}`), owner: p.login, installation: inst, fork: true, commits: [ago(1, 'c1')] } });
  const one = await setup(await createVerifyLink({ installationId: p.id, projectId: null, repoKey: fork, purpose: 'app' }), p.login, inst, gh);
  assert.equal(one.res.status, 200);
  const [v] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM github_verifications WHERE installation_id = ${p.id} AND repo_key = ${fork}`;
  assert.equal(v.n, 0);
  // Every per-repo token is refused by GitHub: the failed page (502), never "none could count".
  const key = `${p.login}/real`;
  const base = fakeGitHub({ [key]: { id: Number(`85${RUN}`), owner: p.login, installation: inst + 1, commits: [ago(1, 'r1')] } });
  const down = Object.assign((async (input: RequestInfo | URL, init?: RequestInit) =>
    /access_tokens$/.test(String(input)) && String(init?.body ?? '').includes('repositories') ? new Response('{}', { status: 500 }) : base(input, init)) as typeof fetch,
  { calls: base.calls, repos: base.repos }) as FakeGitHub;
  const failed = await setup(await createVerifyLink({ installationId: p.id, projectId: null, repoKey: null, purpose: 'app' }), p.login, inst + 1, down);
  assert.equal(failed.res.status, 502, failed.text);
  assert.equal(await source(p.id, key), null);
});

test('L2.11 fix round 1 (I3): at most PICK_ADMIN_CHECKS admin checks at one setup', db, async () => {
  const p = await signedIn('max');
  const org = `big${RUN}`;
  const inst = Number(`70${RUN}`);
  const repos = Object.fromEntries(Array.from({ length: 40 }, (_, k) => [`${org}/r${k}`,
    { id: Number(`86${RUN}${k}`), owner: org, ownerType: 'Organization' as const, installation: inst, admins: ['nobody'], commits: [ago(k + 1, `c${k}`)] }]));
  const gh = fakeGitHub(repos);
  const { res } = await setup(await pickerLink(p.ctx), p.login, inst, gh);
  assert.equal(res.status, 403);
  assert.equal(gh.calls.filter((c) => c.path.includes('/collaborators/')).length, PICK_ADMIN_CHECKS);
});

test('L2.9 tell main_project switches to another App-proven repo, even a confirmed one; an unproven repo gets its own install link', db, async () => {
  const p = await signedIn('jon');
  const a = `${p.login}/alpha`;
  const b = `${p.login}/beta`;
  const inst = Number(`67${RUN}`);
  const gh = fakeGitHub({
    [a]: { id: Number(`80${RUN}`), owner: p.login, installation: inst, commits: [ago(9, 'a1')] },
    [b]: { id: Number(`81${RUN}`), owner: p.login, installation: inst, commits: [ago(1, 'b1')] },
  });
  assert.equal((await setup(await pickerLink(p.ctx), p.login, inst, gh)).res.status, 200);
  assert.equal(await mainProjectOf(p.id), b);
  assert.match(String((await mcpCall(p.ctx, 'find', {})).reply?.show_to_builder), /^Beta: Shipping /m, 'confirmed and ranked');
  const sw = await mcpCall(p.ctx, 'tell', { main_project: `https://github.com/${a}` });
  assert.equal(sw.reply?.show_to_builder, `EarnKit now ranks github.com/${a}.`);
  assert.equal(await mainProjectOf(p.id), a);
  assert.match(String((await mcpCall(p.ctx, 'find', {})).reply?.show_to_builder), /^Alpha: Shipping /m);
  const same = await mcpCall(p.ctx, 'tell', { main_project: a });
  assert.equal(same.reply?.show_to_builder, `EarnKit already ranks github.com/${a}.`);
  // A repo this person never proved: nothing changes, and that repo's own install link is offered (fix round 1, M5).
  const unproven = `${p.login}/gamma`;
  const no = await mcpCall(p.ctx, 'tell', { main_project: unproven });
  const s = String(no.reply?.show_to_builder);
  assert.match(s, new RegExp(`^github\\.com/${unproven} isn't connected yet\\. Install the read-only EarnKit app on it \\(one click\\): https://earnkit\\.com/github/verify\\?n=\\S+\\nWant me to rank it once that's done\\?$`), s);
  const [n] = await sql()<{ repo_key: string }[]>`SELECT repo_key FROM github_verify_nonces WHERE nonce_hash = ${sha(new URL(links(s)[0]!).searchParams.get('n')!)}`;
  assert.equal(n.repo_key, unproven);
  assert.equal(await mainProjectOf(p.id), a);
  // Another person's App-proven repo is never this person's to rank.
  const q = await signedIn('kai');
  await mcpCall(q.ctx, 'tell', { main_project: a });
  assert.equal(await mainProjectOf(q.id), null);
});
