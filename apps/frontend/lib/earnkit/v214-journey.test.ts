import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { pathQuiet, pathUnquiet, walletOffered } from './fixtures/wallet-step';
import { registerClient } from './oauth';
import { authorizeGet, tokenPost } from './oauth-routes';
import { xSignInCallback } from './x-install';
import { connectInstallation, saveInstallation } from './installations';
import { csrfCookieName } from './github-verify';
import { appSetup } from './github-app';
import { weeklyFactsStep } from './week-facts';
import { mondayOf, weekOfMonday } from './weeks';
import { profileData } from './bench-data';
import { resolveHandle } from './profiles';
import { signinGet, SIGN_IN_NOTES } from './x-link';
import { mcpCall, type McpResult } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv } from './fixtures/app-install';
import BenchProfileView from '../../app/[handle]/BenchProfileView';
import { profileSite } from './site-data';
import type { ToolContext } from './tools';
import type { XOAuthDeps, XUser } from './x-oauth';
import { padPool } from './fixtures/rank-pool';
import { assertOpener, isOpener } from './fixtures/opener';
import { READY_SET } from './bench-find';

// v4.10 Task 4: this file pins the reply the path gives; a fresh session now opens with the ready set instead
// (v410-find.test.ts), so the set is off here (bench-find.ts READY_SET).
READY_SET.on = false;

/**
 * v2.14 T12: the spec's acceptance 1 to 5 as one brand-new builder lives them, through the real routes
 * (authorize, the X callback, token, the App setup URL, the sign-in link page) and the real MCP layer
 * (tools/call). X and GitHub are fakes, and nothing leaves the machine: fetch throws for the whole file (D3),
 * and every GitHub call must be one the fake routes. Keys, repo and installation ids are per run (D4).
 */
const outside: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  outside.push(String(input instanceof Request ? input.url : input));
  throw new Error('v214-journey: no network');
}) as typeof fetch;

(globalThis as { React?: typeof React }).React = React;
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  mock.timers.reset();
  globalThis.fetch = realFetch;
  if (process.env.DATABASE_URL) await sql().end();
});

const RUN = String(process.pid % 100000);
const ME: XUser = { id: `95${RUN}1`, username: `jenil${RUN}`.slice(0, 15), name: 'Jenil', avatar: null };
const LOGIN = `jenil${RUN}`;
const ORG = `earnkitai${RUN}`;
const KEY = `${ORG}/earnkit`;
const REPO_ID = Number(`31${RUN}`);
const GH_INSTALL = Number(`42${RUN}`);
const VERIFIER = 'j'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const noLimit = { limit: async () => {} };
const fakeX = (user: XUser): XOAuthDeps => ({ exchange: async () => 'x-token', me: async () => user });

// The week the Monday run writes is this week (still in progress at the App setup, so the setup's backfill of
// finished weeks never writes it first); the run is the next Monday, 15:30 UTC.
const WEEK = mondayOf(new Date());  // read before the clock is pinned below
const at = (days: number, time: string) => new Date(Date.parse(`${WEEK}T${time}Z`) + days * 86_400_000);
const MONDAY_RUN = at(7, '15:30:00');
/** The whole journey runs on this Wednesday noon of that week, whatever day the suite runs on: the week's commits (Tuesday and
 *  Wednesday) are then in the past and the week is still in progress, as on the weekday the fixtures were written. Only Date is
 *  pinned (the database's now() stays real). */
const WEDNESDAY_NOON = at(2, '12:00:00').getTime();
mock.timers.enable({ apis: ['Date'], now: WEDNESDAY_NOON });
const gh = fakeGitHub({
  [KEY]: {
    id: REPO_ID, owner: ORG, ownerType: 'Organization', installation: GH_INSTALL, admins: [LOGIN],
    commits: [
      { sha: '1', message: 'feat: sign in with X at install', date: at(1, '10:00:00').toISOString(), login: LOGIN },
      { sha: '2', message: 'Fix the reply copy', date: at(2, '10:00:00').toISOString(), login: LOGIN },
      { sha: '3', message: 'chore(deps): bump next', date: at(3, '10:00:00').toISOString(), login: 'dependabot[bot]', type: 'Bot' },
    ],
    pulls: [],
  },
});

/** Find's on-demand readers and program matching stay on this machine (as v214-app-proof.test.ts). */
const offline = async () => { throw new Error('offline'); };
const readerDeps = new Proxy({}, { get: (_t, k) => (k === 'now' ? new Date() : k === 'ghSpent' ? () => false : k === 'ghFetch' ? gh : k === 'requests' ? undefined : offline) });
const NO_MATCH = async () => ({ checked: 0, scored: 0, fits: [] });

const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
/** Final fix 14: an earnkit.com link written without https (A14: the page named beside the action link). */
const bareLinks = (s: string) => s.replace(/https?:\/\/\S+/g, ' ').match(/(?<![\w.@/-])(?:www\.)?earnkit\.com\/\S+/g)?.map((l) => l.replace(/[.,;:!?)]+$/, '')) ?? [];
/** Acceptance 5 on every reply: one https link, the money section, exactly one question and it is last, never "raise". */
function rule(r: McpResult): string {
  assert.equal(r.isError, false, r.text);
  const s = String(r.reply?.show_to_builder ?? '');
  // Task 16: at most one https link and exactly one question.
  assert.ok(links(s).length <= 1, s);
  assert.ok(links(s).every((l) => l.startsWith('https://')), s);
  // Final fix 14: bare earnkit.com links count too: at most the page, named once beside the one action link.
  assert.ok(bareLinks(s).length <= 1, s);
  assert.ok(links(s).length + bareLinks(s).length <= 2, s);
  const [bare] = bareLinks(s);
  if (bare && links(s)[0]) assert.ok(!links(s)[0]!.includes(bare), `the page is not linked twice: ${s}`);
  // v4.8 Task 4: target B's opener ends in a number to reply with and its one link (no question).
  assert.equal((s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length, isOpener(s) ? 0 : 1, s);
  assert.doesNotMatch(s, /raise|fundrais/i, s);
  assert.equal(r.reply?.schedule_weekly_update, undefined, 'nobody is asked to schedule anything');
  return s;
}
const ctxOf = (c: { id: number; own: number; shared: boolean; x: string | null }): ToolContext =>
  ({ installationId: c.id, ownInstallationId: c.own, sharedClient: c.shared, matchProjects: NO_MATCH, readerDeps }) as never;

/** "Add EarnKit to an agent" with X at install: register, authorize (to X), the callback, the token. */
async function addEarnKit(redirect: string, name: string, user: XUser) {
  const clientId = registerClient({ redirect_uris: [redirect], client_name: name }).client_id;
  const start = await authorizeGet(new Request(`https://earnkit.com/oauth/authorize?${new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirect, state: 's', code_challenge: CHALLENGE, code_challenge_method: 'S256' })}`), noLimit);
  assert.equal(start.status, 302, 'the install asks to sign in with X');
  const toX = new URL(start.headers.get('location')!);
  assert.equal(toX.hostname, 'x.com');
  const back = await xSignInCallback(new Request(`https://earnkit.com/x/callback?code=c&state=${toX.searchParams.get('state')}`, {
    headers: { cookie: start.headers.get('set-cookie')!.split(';')[0] } }), { x: fakeX(user), ...noLimit });
  assert.equal(back!.status, 302);
  const code = new URL(back!.headers.get('location')!).searchParams.get('code')!;
  const res = await tokenPost(new Request('https://earnkit.com/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `198.51.100.${Number(RUN) % 250}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirect, code_verifier: VERIFIER }) }));
  assert.equal(res.status, 200);
  const c = (await connectInstallation(((await res.json()) as { access_token: string }).access_token))!;
  assert.equal(c.x, user.id);
  return { id: c.id, own: c.own, ctx: ctxOf(c) };
}
let first: Awaited<ReturnType<typeof addEarnKit>>;
let installLinkSeen = '';

test('12.1 acceptance 1: the install signs in with X; the first reply names the account, shows the page and offers the repo picker', db, async () => {
  first = await addEarnKit('http://127.0.0.1:41234/callback', 'Claude Code', ME);
  const s = rule(await mcpCall(first.ctx, 'find', {}));
  // Task 16 step 2: the reply names the account itself; the picker's install link, no GitHub URL asked for.
  assert.equal(s.split('\n')[0], `You're in, @${ME.username}. Really glad you're here.`, s);
  assert.doesNotMatch(s, /Signed in as/);
  assert.match(links(s)[0]!, /^https:\/\/earnkit\.com\/github\/verify\?n=/);
  assert.ok(s.endsWith("Done?"), s);
  assert.doesNotMatch(s, /What's your GitHub/);
});

test('12.2 acceptance 2: a second agent with the same X is the same page, nothing to approve or merge', db, async () => {
  const second = await addEarnKit('https://claude.ai/api/mcp/auth_callback', 'Claude', ME);
  assert.equal(second.id, first.id, 'the same person');
  // Final fix 14: two installations (each agent its own), one page.
  assert.notEqual(second.own, first.own, 'a distinct own installation');
  assert.notEqual(second.ctx.ownInstallationId, first.ctx.ownInstallationId);
  const s = rule(await mcpCall(second.ctx, 'find', {}));
  assert.ok(s.includes(`@${ME.username}`), s);
  assert.doesNotMatch(s, /approve|merge|add this agent|remove it/i);
});

test('12.3 naming the repo: not counted, with the App install link', db, async () => {
  const s = rule(await mcpCall(first.ctx, 'find', { identity: { project: { name: 'EarnKit', repo: `https://github.com/${KEY}` } } }));
  // v3.1 cold read: "You're in" was the first reply's; this one goes straight to the money and the step.
  assert.doesNotMatch(s, /You're in/, s);
  installLinkSeen = links(s)[0]!;
  assert.match(installLinkSeen, /^https:\/\/earnkit\.com\/github\/verify\?n=/);
  assert.ok(s.endsWith("Done?"), s);
});

test('12.4 acceptance 3: the App installed on the org repo; the next reply says it is on the Bench with a rank', db, async () => {
  // v3.1 F3: the pool reaches RANK_MIN_POOL, so a rank shows.
  await padPool(9);
  assert.ok(installLinkSeen, '12.3 ran');
  const nonce = new URL(installLinkSeen).searchParams.get('n')!;
  // The GitHub sign-in hop of /github/verify (github-verify.ts) names the installer: done here as its callback would.
  await sql()`UPDATE github_verify_nonces SET login = ${LOGIN}, account_created_at = '2020-01-01', public_repos = 3 WHERE nonce_hash = ${sha(nonce)}`;
  const res = await appSetup(new Request(`https://earnkit.com/github/verify/app?installation_id=${GH_INSTALL}&state=${nonce}`, {
    headers: { cookie: `${csrfCookieName(nonce)}=x` } }), { fetch: gh, ...noLimit });
  assert.equal(res.status, 200);
  // v4.0: setup step 3 answered (this test is about another reply). v4.8 Task 1: the path parked, so the reply is the
  // standing paragraph and its step.
  await walletOffered(first.id);
  await pathQuiet(first.id);
  const s = rule(await mcpCall(first.ctx, 'find', {}));
  // Task 16: ranked, with a rank on the standing line (no backfilled weeks here, so no connect offer).
  // v4.7.1 T1: the standing is v4.7's paragraph ("Score 14 · #1 of 10 builders. ..."), never the old name line.
  assert.match(s, /^(?:EarnKit is on the leaderboard: |Score \d+ · )(#\d+ of \d+ builders?|Top [\d.]+% of builders)/m, s);
  // The path names programs again for the rest of the journey.
  await pathUnquiet(first.id);
});

test('12.5 acceptance 4: the next Monday the profile shows the week from its titles; nobody scheduled anything', db, async () => {
  // The daily reading of the repo (person-score.ts, not faked here) found the week's commits.
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at)
    SELECT id, ${sql().json({ commit_counts: { [weekOfMonday(WEEK)!]: 2 }, private: false } as never)}, true, now() FROM builder_sources
    WHERE builder_id = ${first.id} AND kind = 'repo' AND state = 'verified' AND lower(ref) LIKE ${`%${KEY}`}
    ON CONFLICT (source_id) DO UPDATE SET signals = EXCLUDED.signals, ok = true, read_at = EXCLUDED.read_at`;
  const step = await weeklyFactsStep(MONDAY_RUN, { deadline: Date.now() + 20_000, only: [first.id], ghFetch: gh });
  assert.deepEqual(step, { people: 1, rows: 1 });
  const r = await resolveHandle(ME.username);
  assert.ok(r && !('redirect' in r), 'the handle is the page');
  const data = await profileData(r.builderId, at(7, '16:00:00'));
  const html = renderToStaticMarkup(React.createElement(BenchProfileView, { data: data!, site: await profileSite(r.builderId, data!, at(7, '16:00:00')), page: 1 }));
  // Weekly updates: one summary of the week's titles, never the raw titles.
  // Weekly updates: one summary of the week's titles (the free rule summary: no ANTHROPIC_API_KEY in tests).
  assert.deepEqual(data!.log.map((c) => c.summary), ['Fixed the reply copy. Shipped sign in with X at install.']);
  assert.ok(html.includes('Fixed the reply copy. Shipped sign in with X at install.'), 'the week from its titles');
  assert.ok(!html.includes('bump next'), 'a bot is never in the log');
  const [p] = await sql()<{ sched: Date | null }[]>`SELECT updates_scheduled_at AS sched FROM builder_profiles WHERE builder_id = ${first.id}`;
  assert.equal(p.sched, null);
  // Acceptance 5 holds for score too.
  rule(await mcpCall(first.ctx, 'score', {}));
});

/** Opens the sign-in link in a browser, signs in with X, and reads the paste code off the done page. */
async function signInThrough(link: string, user: XUser): Promise<string> {
  const page = await signinGet(new Request(link), link.split('/').pop()!, noLimit);
  assert.equal(page.status, 200);
  const html = await page.text();
  const to = new URL(/href="(https:\/\/x\.com\/i\/oauth2\/authorize[^"]+)"/.exec(html)![1].replaceAll('&amp;', '&'));
  const cookie = page.headers.get('set-cookie')!.split(';')[0];
  const done = await xSignInCallback(new Request(`https://earnkit.com/x/callback?code=c&state=${to.searchParams.get('state')}`, { headers: { cookie } }), { x: fakeX(user), ...noLimit });
  assert.equal(done!.status, 200);
  const code = /([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})/.exec(await done!.text())?.[1];
  assert.ok(code, 'the done page shows a paste code');
  return code;
}

test('12.6 the fallback client: signed out, the link page, the paste code through find, then signed in', db, async () => {
  const kim: XUser = { id: `95${RUN}2`, username: `kim${RUN}`.slice(0, 15), name: 'Kim', avatar: null };
  const token = `ek_journey_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(token, undefined, false, 'Cursor');
  const ctx = ctxOf((await connectInstallation(token))!);
  const out = rule(await mcpCall(ctx, 'find', {}));
  const link = assertOpener(out);
  assert.match(link, /^https:\/\/earnkit\.com\/signin\/[A-Za-z0-9_-]{22}$/);
  const yes = await mcpCall(ctx, 'tell', { move_up: { kind: 'sign_in', project_key: null, answer: 'yes' } });
  assert.match(String(yes.reply?.agent_note), /sign_in_code/);
  const code = await signInThrough(link, kim);
  const bound = await mcpCall(ctx, 'find', { sign_in_code: code });
  assert.equal(bound.reply?.sign_in_note, SIGN_IN_NOTES.bound);
  const s = rule(bound);
  assert.ok(s.startsWith(`You're in, @${kim.username}. Really glad you're here.\n\n`), s);
  assert.ok(s.endsWith("Done?"), s);
});

test('12.7 no network: every GitHub call went through the fake and was routed; fetch was never called', () => {
  assert.ok(gh.calls.length > 0, 'the App setup and the Monday run read GitHub through the fake');
  assert.deepEqual(gh.calls.filter((c) => !c.routed), [], 'every call was one the fake answers');
  assert.deepEqual(outside, [], 'nothing reached for the network');
});
