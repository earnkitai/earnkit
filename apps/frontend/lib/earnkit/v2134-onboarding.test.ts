import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';
import { tools } from './tools';
import { CLAIM_TEXT, bindX, claimGet, claimJoinPost, claimPost, xCallback } from './claim';
import { answerJoin, joinOnProvenTie, pendingJoinOf, rootOf } from './identity';
import { X_ON, dropAvalanche, find, install, person, withEnv, type Found } from './fixtures/find';
import { DETACH_LINES, JOIN_TABLES, PROBATION_LINES, joinNoticeLine } from './page-joins';
import { linkInstallations } from './identity';
import { clientNameOf } from './oauth';
import { agoText } from './claim';
import { fakeGitHub } from './fixtures/fake-github-branch';
import { APP, installApp, privateGitHub } from './fixtures/private-github';
import {
  BENCH_HEADS, claimAskLine, claimQuestion, checkingBranchLine, installAppAsk, linkedLine, onBenchLine, pageLine, privateLine,
} from './bench-reply';
import { CLAIM_NOTE, displayName, fundNeeds } from './bench-find';
import { checkLive, liveDefaults, parkedPage } from './live-check';
import { pageUrl } from './reserved-routes';
import { createMcpServer } from './mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { benchIdentity, identityInput } from './identity-input';
import { localGitInput } from './discovery';
import type { XOAuthDeps, XUser } from './x-oauth';

/**
 * v2.13.4, the owner's spec (2026-10-17): a builder gets value after the X claim and nothing else. The
 * owner's acceptance test a to g, under EARNKIT_BENCH, with controller rulings R1 to R5:
 * a. a fresh agent signing in with an X that already has a page joins it on one click on the claim page
 *    (R1), never another agent's approval; b. after the claim no reply shows a claim link; c. a private
 *    org repo gets the App install link in one line right after the claim, and is on the Bench in the same
 *    session once installed; d. a reconnect keeps the same handle and page; e. a live_url that loads is
 *    live (no "once it's live"); f. never a claim link beside a join question; g. every reply ends on one
 *    question, with at most one link.
 */

process.env.EARNKIT_AUTH_SECRET ||= 'v2134-secret';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropAvalanche();
  await sql().end();
});

const RUN = randomBytes(3).toString('hex');
let seq = 0;
const uniq = (p: string) => `${p}${RUN}${++seq}`;
const ON = { EARNKIT_URL: undefined, ...X_ON };
const on = <T>(fn: () => Promise<T>) => withEnv(ON, fn);
const NO_MATCH = { matchProjects: async () => ({ checked: 1, scored: 0, fits: [] }) };
const links = (t: string) => (t.match(/https?:\/\/\S+/g) ?? []).map((l) => l.replace(/[.,]$/, ''));
const questions = (t: string) => (t.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const CLAIM_URL = /\/claim\/[a-z2-7]{12}/;
const xUser = (): XUser => ({ id: `v2134${randomBytes(6).toString('hex')}`, username: uniq('jen').slice(0, 15), name: 'Jenil', avatar: null });

/** (g) The reply ends on one question, last, with at most one link. */
function oneQuestionLast(r: { show_to_builder: string }, what: string) {
  const t = r.show_to_builder;
  assert.ok(t.trimEnd().endsWith('?'), `${what}: the last line is a question\n${t}`);
  assert.equal(questions(t), 1, `${what}: one question\n${t}`);
  assert.ok(links(t).length <= 1, `${what}: at most one link\n${t}`);
}
/** (b) No claim link and no join question, anywhere in the reply or its fields. */
function noClaim(r: Found & Record<string, unknown>, what: string) {
  assert.doesNotMatch(r.show_to_builder, CLAIM_URL, `${what}: no claim link\n${r.show_to_builder}`);
  assert.equal(r.claim, undefined, what);
  assert.doesNotMatch(r.show_to_builder, /already on an EarnKit page|already on a page/i, what);
}

// ---- The claim page, as a browser carries it (claim.test.ts's helpers) ---------------------------

const fakeX = (user: XUser): XOAuthDeps & { calls: number } => {
  const x = { calls: 0, exchange: async () => (x.calls++, 'tok'), me: async () => user };
  return x;
};
const noLimit = { limit: async () => {} };
async function signIn(link: string, user: XUser) {
  const code = link.split('/').pop()!;
  const get = await claimGet(new Request(link), code);
  assert.equal(get.status, 200);
  const cookie = get.headers.get('set-cookie')!.split(';')[0];
  const csrf = /name="csrf" value="([^"]+)"/.exec(await get.text())![1];
  const post = await claimPost(
    new Request(link, { method: 'POST', headers: { cookie, origin: 'https://earnkit.com', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf }) }),
    code,
    noLimit,
  );
  assert.equal(post.status, 303);
  const state = new URL(post.headers.get('location')!).searchParams.get('state')!;
  const page = await xCallback(new Request(`https://earnkit.com/x/callback?code=c&state=${encodeURIComponent(state)}`, { headers: { cookie } }), { x: fakeX(user), limit: noLimit.limit });
  return { page, body: await page.text(), cookie };
}
const offerOf = (body: string) => /name="t" value="([^"]+)"/.exec(body)?.[1] ?? null;
const confirmJoin = (t: string, cookie: string | null, origin = 'https://earnkit.com') =>
  claimJoinPost(
    new Request('https://earnkit.com/claim/join', {
      method: 'POST',
      headers: { ...(cookie && { cookie }), origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ t }),
    }),
    noLimit,
  );
/** An installation that has a claimed page (signed in with `user` through the real claim page). */
async function withPage(user: XUser) {
  const id = await install();
  const r = await find(id, {}, NO_MATCH);
  assert.ok(r.claim?.link, r.show_to_builder);
  const { page } = await signIn(r.claim!.link, user);
  assert.equal(page.status, 200);
  return id;
}
const findAs = (own: number, input: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  rootOf(own).then((root) => find(root, input, { ownInstallationId: own, ...NO_MATCH, ...extra }) as Promise<Found & Record<string, unknown>>);

// ---- a. An X that already has a page: one click on the claim page, no other agent ---------------

test('a.1 a fresh agent signing in with an X that already has a page: the same page shows one button (R1); the click joins at once; no other agent is asked', dbTest, () =>
  on(async () => {
    const user = xUser();
    const first = await withPage(user);
    const fresh = await install();
    const r1 = await find(fresh, {}, NO_MATCH);
    assert.ok(r1.claim?.link);
    const { page, body, cookie } = await signIn(r1.claim!.link, user);
    assert.equal(page.status, 200);
    // R1: the button and its line, before anything is joined; never "your agents will each ask you".
    assert.ok(body.includes(CLAIM_TEXT.joinButton(user.username).replace(/"/g, '&quot;')), body);
    assert.ok(body.includes(CLAIM_TEXT.joinWarning), body);
    assert.doesNotMatch(body, /<script/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.notEqual(await rootOf(fresh), await rootOf(first), 'nothing joins before the click');
    assert.equal(await pendingJoinOf(fresh), null, 'no cross-agent yes is set up');
    assert.equal(await pendingJoinOf(first), null);
    const t = offerOf(body)!;
    assert.ok(t, 'the offer token is in the form');
    const done = await confirmJoin(t, cookie);
    assert.equal(done.status, 200);
    assert.match(await done.text(), new RegExp(CLAIM_TEXT.linked));
    assert.equal(await rootOf(fresh), await rootOf(first), 'joined at once');
    assert.equal(await pendingJoinOf(fresh), null);
    // The next find in that agent says so, once; later finds say "Your page".
    const r2 = await findAs(fresh);
    assert.equal(r2.show_to_builder.split('\n').filter((l) => l === linkedLine(pageUrl(user.username)) || l === linkedLine(`https://earnkit.com/${user.username}`)).length, 1, r2.show_to_builder);
    noClaim(r2, 'after the join');
    oneQuestionLast(r2, 'after the join');
    const r3 = await findAs(fresh);
    assert.doesNotMatch(r3.show_to_builder, /Linked to your page/);
    assert.ok(r3.show_to_builder.includes(pageLine(`https://earnkit.com/${user.username}`)), r3.show_to_builder);
    // The first agent is never asked anything about it.
    const rf = await findAs(first);
    assert.doesNotMatch(rf.show_to_builder, /Another agent|Add it to your page|Linked to your page/);
  }));

test('a.2 the join button is safe: no cookie, another site, a replay or an expired offer never joins; a new X makes its page with no extra click', dbTest, () =>
  on(async () => {
    const user = xUser();
    const first = await withPage(user);
    const fresh = await install();
    const r = await find(fresh, {}, NO_MATCH);
    const { body, cookie } = await signIn(r.claim!.link, user);
    const t = offerOf(body)!;
    assert.equal((await confirmJoin(t, null)).status, 403, 'no cookie (a forwarded page)');
    assert.equal((await confirmJoin(t, cookie, 'https://evil.example.com')).status, 403, 'another site');
    assert.equal((await confirmJoin('x'.repeat(43), cookie)).status, 410, 'an unknown offer');
    assert.notEqual(await rootOf(fresh), await rootOf(first));
    assert.equal((await confirmJoin(t, cookie)).status, 200);
    assert.equal((await confirmJoin(t, cookie)).status, 410, 'one use');
    // Expired.
    const user2 = xUser();
    await withPage(user2);
    const late = await install();
    const r2 = await find(late, {}, NO_MATCH);
    const s2 = await signIn(r2.claim!.link, user2);
    const t2 = offerOf(s2.body)!;
    await sql()`UPDATE x_join_offers SET expires_at = now() - interval '1 minute' WHERE offer_hash = ${createHash('sha256').update(t2).digest('hex')}`;
    assert.equal((await confirmJoin(t2, s2.cookie)).status, 410);
    assert.notEqual(await rootOf(late), await rootOf(first));
    // The offer table never holds the token or the cookie in the clear.
    const [kept] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM x_join_offers WHERE offer_hash = ${t2} OR csrf_hash = ${s2.cookie.split('=')[1]}`;
    assert.equal(kept.n, 0);
    // A new X (no page yet): the page is made at sign-in, no button.
    const lone = await install();
    const r3 = await find(lone, {}, NO_MATCH);
    const s3 = await signIn(r3.claim!.link, xUser());
    assert.equal(offerOf(s3.body), null);
    assert.match(s3.body, /Your page is live/);
  }));

test('a.3 under the Bench an X tie never sets up a cross-agent yes; flag off (score only) keeps v2.12.1\'s', dbTest, () =>
  on(async () => {
    const user = xUser();
    const a = await withPage(user);
    const b = await install();
    await find(b, {}, NO_MATCH);
    const r = await bindX(b, user, new Date());
    assert.equal(r.ok, false);
    assert.equal(await pendingJoinOf(a), null);
    assert.equal(await pendingJoinOf(b), null);
    // v2.13.4 R8: the strong-proof two-agent yes stays for an installation that isn't fresh and empty (R8.2).
  }));

// ---- b. After the claim, never a claim link again -------------------------------------------------

test('b.1 after the claim, no reply in that agent shows a claim link (find, score, a move_up answer)', dbTest, () =>
  on(async () => {
    const id = await install();
    const r1 = await find(id, {}, NO_MATCH);
    // a. The first find: where you stand, ways to get funded, then the one question: claim with X.
    assert.equal(r1.show_to_builder.split('\n')[0], BENCH_HEADS.stand);
    const last = r1.show_to_builder.split('\n').slice(-2);
    assert.equal(last[0], claimAskLine(r1.claim!.link));
    assert.equal(last[1], claimQuestion(null));
    assert.equal(r1.move_up?.kind, 'claim');
    assert.equal(r1.move_up?.agent_note, CLAIM_NOTE);
    oneQuestionLast(r1, 'first find');
    assert.equal(r1.show_to_builder.match(CLAIM_URL)?.length, 1, 'the claim link once');
    await signIn(r1.claim!.link, xUser());
    for (let i = 0; i < 2; i++) {
      const r = await find(id, {}, NO_MATCH);
      noClaim(r, `find ${i}`);
      oneQuestionLast(r, `find ${i}`);
    }
    const s = (await tools.score({}, { installationId: id } as never)) as Found & Record<string, unknown>;
    noClaim(s, 'score');
    const yes = (await tools.tell({ move_up: { kind: 'claim', project_key: null, answer: 'yes' } }, { installationId: id } as never)) as { show_to_builder: string };
    assert.doesNotMatch(yes.show_to_builder, CLAIM_URL);
  }));

// ---- c. A private org repo: the install link right after the claim, then the Bench ---------------

test('c.1 a private org repo (700+ commits): first find asks only for X; right after the claim, the install link in one line; installed, it is on the Bench in the same session', dbTest, () =>
  withEnv({ ...ON, ...APP }, async () => {
    const login = uniq('jenil').toLowerCase();
    const key = `${uniq('earnkitai')}/earnkit`;
    const gh = privateGitHub(key, { commits: 720 });
    const id = await install();
    const input = { agent_can_build: true, github_user: login, local_repos: [{ name: 'earnkit', url: `https://github.com/${key}` }] };
    // a. Where you stand (the project's display name, never "EarnKit can't see earnkit"), then only X.
    const r1 = await find(id, input, { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.equal(r1.show_to_builder.split('\n')[1], privateLine('Earnkit'), r1.show_to_builder);
    assert.doesNotMatch(r1.show_to_builder, /can't see/);
    assert.ok(r1.show_to_builder.endsWith(`${claimAskLine(r1.claim!.link)}\n${claimQuestion('Earnkit')}`), r1.show_to_builder);
    assert.equal(links(r1.show_to_builder).length, 1);
    oneQuestionLast(r1, 'private, unclaimed');
    // b. The claim.
    const user = xUser();
    await signIn(r1.claim!.link, user);
    // c. Right after the claim: "Your page", then the install link in one line, the question last.
    const r2 = await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
    noClaim(r2, 'after the claim');
    const ls = links(r2.show_to_builder);
    assert.equal(ls.length, 1, r2.show_to_builder);
    assert.match(ls[0], /^https:\/\/earnkit\.com\/github\/verify\?n=/);
    assert.ok(r2.show_to_builder.includes(pageLine(pageUrl(user.username))), r2.show_to_builder);
    const up = r2.show_to_builder.split('\n\n').at(-1)!;
    assert.equal(up, `${BENCH_HEADS.up}\n${installAppAsk('Earnkit', ls[0])}`);
    assert.equal(installAppAsk('Earnkit', 'L'), "Earnkit is private, so I can't count it yet. Install the read-only EarnKit app on it (one click): L\nWant me to count it once that's done?");
    assert.equal(r2.move_up?.kind, 'install_app');
    oneQuestionLast(r2, 'install ask');
    // d. Installed: the next find counts it (the branch is checked with the installation token) ...
    await installApp(id, key, login);
    const r3 = await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.equal(r3.show_to_builder.split('\n')[1], checkingBranchLine('Earnkit'), r3.show_to_builder);
    noClaim(r3, 'installed');
    oneQuestionLast(r3, 'installed');
    const branch = (r3.proof as { branch: string } | undefined)?.branch;
    assert.ok(branch);
    gh.push(key, branch!, login);
    await sql()`UPDATE proof_branches SET checked_at = checked_at - interval '2 minutes' WHERE builder_id = ${id} AND checked_at IS NOT NULL`;
    // ... and the find after the agent's push shows it on the Bench, followed by one way to move up.
    const r4 = await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.match(r4.show_to_builder.split('\n')[1], /^Earnkit is on the Bench/, r4.show_to_builder);
    noClaim(r4, 'on the Bench');
    oneQuestionLast(r4, 'on the Bench');
    const [s] = await sql()<{ state: string }[]>`SELECT state FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo' AND lower(ref) = ${key}`;
    assert.equal(s.state, 'verified');
  }));

test('c.2 a public repo: right after the claim, "Your page" and the one-line proof; never an install link', dbTest, () =>
  on(async () => {
    const login = uniq('maya').toLowerCase();
    const key = `${login}/recipes`;
    const gh = fakeGitHub();
    const id = await install();
    const r1 = await find(id, { agent_can_build: true, identity: { github_login: login, project: { name: 'Recipe planner', repo: key } } }, { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.equal(r1.show_to_builder.split('\n')[1], checkingBranchLine('Recipe planner'), r1.show_to_builder);
    assert.ok(r1.show_to_builder.endsWith(`${claimAskLine(r1.claim!.link)}\n${claimQuestion('Recipe planner')}`), r1.show_to_builder);
    oneQuestionLast(r1, 'public, unclaimed');
    const user = xUser();
    await signIn(r1.claim!.link, user);
    const r2 = await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
    noClaim(r2, 'public, claimed');
    assert.equal(r2.show_to_builder.split('\n')[1], checkingBranchLine('Recipe planner'));
    assert.ok(r2.show_to_builder.includes(pageLine(`https://earnkit.com/${user.username}`)), r2.show_to_builder);
    assert.doesNotMatch(r2.show_to_builder, /Install|github\/verify/);
    oneQuestionLast(r2, 'public, claimed');
    gh.push(key, (r2.proof as { branch: string }).branch, login);
    await sql()`UPDATE proof_branches SET checked_at = checked_at - interval '2 minutes' WHERE builder_id = ${id} AND checked_at IS NOT NULL`;
    const r3 = await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.match(r3.show_to_builder.split('\n')[1], /^Recipe planner is on the Bench/, r3.show_to_builder);
    oneQuestionLast(r3, 'public, on the Bench');
  }));

// ---- d. Reconnect: same handle, same page --------------------------------------------------------

test('d.1 reconnecting the connector (a new installation): the same handle and page, nothing split', dbTest, () =>
  on(async () => {
    const user = xUser();
    const a = await withPage(user);
    const [before] = await sql()<{ slug: string }[]>`SELECT slug FROM builder_profiles WHERE builder_id = ${await rootOf(a)}`;
    const b = await install(); // the reconnect
    const r1 = await find(b, {}, NO_MATCH);
    oneQuestionLast(r1, 'reconnect, first find');
    const { body, cookie } = await signIn(r1.claim!.link, user);
    assert.equal((await confirmJoin(offerOf(body)!, cookie)).status, 200);
    assert.equal(await rootOf(b), await rootOf(a));
    const pages = await sql()<{ builder_id: number; slug: string; x_handle: string }[]>`SELECT builder_id, slug, x_handle FROM builder_profiles WHERE x_user_id = ${user.id}`;
    assert.equal(pages.length, 1, 'one page for this X');
    assert.equal(pages[0].slug, before.slug, 'the same page');
    assert.equal(pages[0].x_handle, user.username);
    const r2 = await findAs(b);
    noClaim(r2, 'reconnect, after');
    oneQuestionLast(r2, 'reconnect, after');
  }));

test('d.2 the agent that joins is the older installation: the X page and its handle stay', dbTest, () =>
  on(async () => {
    const user = xUser();
    const older = await install();
    const r0 = await find(older, {}, NO_MATCH);
    const newer = await withPage(user);
    const { body, cookie } = await signIn(r0.claim!.link, user);
    assert.equal((await confirmJoin(offerOf(body)!, cookie)).status, 200);
    const root = await rootOf(newer);
    assert.equal(await rootOf(older), root);
    const [p] = await sql()<{ x_user_id: string; x_handle: string; slug: string }[]>`SELECT x_user_id, x_handle, slug FROM builder_profiles WHERE builder_id = ${root}`;
    assert.deepEqual({ ...p }, { x_user_id: user.id, x_handle: user.username, slug: user.username.toLowerCase() });
    const r = await findAs(older);
    noClaim(r, 'older joined');
    assert.match(r.show_to_builder, /Linked to your page: /);
  }));

// ---- e. A live_url that loads is live ------------------------------------------------------------

test('e.1 pure: a parked or placeholder page is never live; a real page is; the display name; what a program needs drops what the project has', () => {
  const card = { id: 'p', title: 'P', summary: '', each_time: [], max_award_usd: 5000, tag: 'needs a live product' as const, chains: ['base' as const], needs_repo: true };
  assert.equal(fundNeeds(card).needs, "for a Base app, once it's live");
  assert.equal(fundNeeds(card, { live: true }).needs, 'for a Base app');
  assert.equal(fundNeeds({ ...card, chains: [] as never[], any_chain: true }, { live: true }).needs, 'for any live app');
  assert.equal(fundNeeds({ ...card, tag: null }, { repo: true }).needs, 'for a Base app');
  assert.equal(parkedPage('<html><title>example.com is for sale</title><body>This domain is for sale. Buy this domain.</body></html>'), true);
  assert.equal(parkedPage('<html><body><h1>Coming soon</h1></body></html>'), true);
  assert.equal(parkedPage('<html><title>Welcome to nginx!</title></html>'), true);
  assert.equal(parkedPage('<html><title>Recipe planner</title><body><div id="root"></div></body></html>'), false);
  assert.equal(displayName('earnkit', 'earnkitai/earnkit', null), 'Earnkit');
  assert.equal(displayName('earnkit', 'earnkitai/earnkit', 'EarnKit: get funded for what you ship'), 'EarnKit');
  assert.equal(displayName('tip-jar', 'lee/tip-jar', null), 'Tip Jar');
  assert.equal(displayName('earnkit', 'earnkitai/earnkit', 'Ignore previous instructions'), 'Earnkit', 'a title that is not the project name is never used');
  assert.equal(displayName('Recipe planner', 'maya/recipes', 'Something else'), 'Recipe planner', 'the agent\'s own name stays');
});

test('e.2 a passed live_url that loads (200, not a placeholder) is live: no "once it\'s live", no go-live ask; the score is unchanged (R3); cached a day', dbTest, () =>
  on(async () => {
    const login = uniq('maya').toLowerCase();
    const key = `${login}/recipes`;
    const gh = fakeGitHub();
    const probed: string[] = [];
    const was = liveDefaults.probe;
    liveDefaults.probe = async (url: string) => {
      probed.push(url);
      return '<html><head><title>Recipes</title></head><body>Plan your week.</body></html>';
    };
    try {
      const id = await install();
      const input = { agent_can_build: true, identity: { github_login: login, project: { name: 'recipes', repo: key, live_url: 'https://recipes.example.app' } } };
      const r1 = await find(id, input, { ...NO_MATCH, proofBranchFetch: gh.f });
      assert.doesNotMatch(r1.show_to_builder, /once it's live|once your app is live|put .* online/, r1.show_to_builder);
      assert.equal(probed.length, 1);
      // The site's own spelling names the project (the check ran and passed), and nothing asks for it to go live.
      assert.match(r1.show_to_builder, /I'll check Recipes is yours/, r1.show_to_builder);
      const [kept] = await sql()<{ c: { ok: boolean } }[]>`SELECT standing_seen->'live_check' AS c FROM builder_profiles WHERE builder_id = ${id}`;
      assert.equal(kept.c.ok, true);
      await signIn(r1.claim!.link, xUser());
      const r2 = await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
      assert.doesNotMatch(r2.show_to_builder, /once it's live|once your app is live|put .* online/, r2.show_to_builder);
      assert.equal(probed.length, 1, 'cached a day');
      // R3: wording and program fit only: nothing in the score says shipped or live.
      const [live] = await sql()<{ shipped: number | null }[]>`SELECT shipped FROM builder_live WHERE builder_id = ${id}`;
      assert.ok(!live || live.shipped === 0, JSON.stringify(live));
      const [site] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_sources WHERE builder_id = ${id} AND kind = 'site' AND state = 'verified'`;
      assert.equal(site.n, 0, 'the check confirms no site');
    } finally {
      liveDefaults.probe = was;
    }
  }));

test('e.3 a live_url that fails or is parked is not live', dbTest, () =>
  on(async () => {
    const was = liveDefaults.probe;
    liveDefaults.probe = async () => '<html><body>This domain is parked free, courtesy of the registrar. Buy this domain.</body></html>';
    try {
      const login = uniq('lee').toLowerCase();
      const id = await install();
      const r = await find(id, { agent_can_build: true, identity: { github_login: login, project: { name: 'tips', repo: `${login}/tips`, live_url: 'https://tips.example.app' } } }, { ...NO_MATCH, proofBranchFetch: fakeGitHub().f });
      assert.ok(r.show_to_builder.includes("I'll check Tips is yours"), r.show_to_builder);
      const [kept] = await sql()<{ c: { ok: boolean } }[]>`SELECT standing_seen->'live_check' AS c FROM builder_profiles WHERE builder_id = ${id}`;
      assert.equal(kept.c.ok, false, 'a parked page is not live');
    } finally {
      liveDefaults.probe = was;
    }
  }));

// ---- f. Never a claim link and "your X is already on a page" together ---------------------------

test('f.1 an unclaimed agent with a pending GitHub join: the join question is the one question, with no claim link', dbTest, () =>
  on(async () => {
    const login = uniq('gh').toLowerCase();
    const a = await install();
    await find(a, {}, NO_MATCH);
    await sql()`UPDATE builder_profiles SET github_login = ${login}, github_basis = 'signin' WHERE builder_id = ${a}`;
    const b = await install();
    await find(b, {}, NO_MATCH);
    assert.equal(await joinOnProvenTie(b, { github_login: login }), 1);
    const r = (await find(b, {}, NO_MATCH)) as Found & Record<string, unknown>;
    assert.match(r.show_to_builder, /Your GitHub is already on an EarnKit page/);
    assert.doesNotMatch(r.show_to_builder, CLAIM_URL, r.show_to_builder);
    assert.equal(r.claim, undefined);
    oneQuestionLast(r, 'join pending');
  }));

// ---- Security review (coordinator, after the scan of claim.ts): (a) to (f) ------------------------

/** A page held by `user`, a fresh installation signed in with the same X on the claim page: the offer page. */
async function offered(user = xUser()) {
  const holder = await withPage(user);
  const joiner = await install();
  const r = await find(joiner, {}, NO_MATCH);
  const s = await signIn(r.claim!.link, user);
  return { user, holder, joiner, link: r.claim!.link, t: offerOf(s.body)!, cookie: s.cookie };
}

test('S.a no path links an installation to an existing X page without the R1 click: not bindX, not the callback, not a cross-agent yes', dbTest, () =>
  on(async () => {
    const { user, holder, joiner } = await offered();
    assert.notEqual(await rootOf(joiner), await rootOf(holder), 'the sign-in alone joins nothing');
    assert.deepEqual(await bindX(joiner, user, new Date()), { ok: false, reason: 'held', target: await rootOf(holder) });
    assert.notEqual(await rootOf(joiner), await rootOf(holder));
    // R10: there is no X two-agent yes at all (joinOnProvenTie takes no X tie).
    assert.equal(await answerJoin(joiner, true), 'none');
    assert.equal(await answerJoin(holder, true), 'none');
    assert.notEqual(await rootOf(joiner), await rootOf(holder));
  }));

test('S.b the confirm is POST only, needs the signing-in browser\'s cookie and Origin, is single use and expires: a GET, a prefetch or a forwarded link joins nothing', dbTest, () =>
  on(async () => {
    const { holder, joiner, t, cookie } = await offered();
    // A GET (or a prefetch) of /claim/join: the claim page route reads it as a code, a 404; the route has no GET.
    assert.equal((await claimGet(new Request('https://earnkit.com/claim/join'), 'join')).status, 404);
    const route = await import('../../app/claim/join/route');
    assert.deepEqual(Object.keys(route).filter((k) => /^[A-Z]+$/.test(k)), ['POST']);
    // Forwarded: the token without the cookie of the browser that signed in with X; a cookie of another claim.
    assert.equal((await confirmJoin(t, null)).status, 403);
    const other = await offered();
    assert.equal((await confirmJoin(t, other.cookie)).status, 403, 'another browser\'s claim cookie');
    // CSRF: another site, no Origin.
    assert.equal((await confirmJoin(t, cookie, 'https://evil.example.com')).status, 403);
    const noOrigin = await claimJoinPost(new Request('https://earnkit.com/claim/join', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ t }) }), noLimit);
    assert.equal(noOrigin.status, 403);
    assert.notEqual(await rootOf(joiner), await rootOf(holder), 'none of these joined');
    // Single use.
    assert.equal((await confirmJoin(t, cookie)).status, 200);
    assert.equal((await confirmJoin(t, cookie)).status, 410);
    // 15 minutes.
    const [o] = await sql()<{ m: number }[]>`SELECT extract(epoch FROM expires_at - now())::int / 60 AS m FROM x_join_offers WHERE offer_hash = ${createHash('sha256').update(other.t).digest('hex')}`;
    assert.ok(o.m <= 15 && o.m >= 14, String(o.m));
  }));

test('S.c the X identity is the X user id, never the handle: another X account with the same handle never reaches the page', dbTest, () =>
  on(async () => {
    const user = xUser();
    const holder = await withPage(user);
    const joiner = await install();
    const r = await find(joiner, {}, NO_MATCH);
    const impostor: XUser = { ...user, id: `v2134${randomBytes(6).toString('hex')}` };
    const s = await signIn(r.claim!.link, impostor);
    assert.equal(offerOf(s.body), null, 'no join offer for a different X user id');
    assert.notEqual(await rootOf(joiner), await rootOf(holder));
    // The offer row is checked by x_user_id at the click: a page whose X changed since is never joined.
    const o = await offered();
    await sql()`UPDATE x_join_offers SET x_user_id = ${'v2134-someone-else'} WHERE offer_hash = ${createHash('sha256').update(o.t).digest('hex')}`;
    assert.equal((await confirmJoin(o.t, o.cookie)).status, 410);
    assert.notEqual(await rootOf(o.joiner), await rootOf(o.holder));
  }));

test('S.d a shared client never joins (either side)', dbTest, () =>
  on(async () => {
    const a = await offered();
    await sql()`UPDATE installations SET shared_client = true WHERE id = ${a.holder}`;
    assert.equal((await confirmJoin(a.t, a.cookie)).status, 409);
    assert.notEqual(await rootOf(a.joiner), await rootOf(a.holder));
    const b = await offered();
    await sql()`UPDATE installations SET shared_client = true WHERE id = ${b.joiner}`;
    assert.notEqual((await confirmJoin(b.t, b.cookie)).status, 200);
    assert.notEqual(await rootOf(b.joiner), await rootOf(b.holder));
  }));

test('S.e an installation already on another person\'s page is never moved', dbTest, () =>
  on(async () => {
    const o = await offered();
    // Since the offer, the joining installation got its own claim (another X account): the click moves nothing.
    await bindX(o.joiner, xUser(), new Date());
    const before = await rootOf(o.joiner);
    assert.notEqual((await confirmJoin(o.t, o.cookie)).status, 200);
    assert.equal(await rootOf(o.joiner), before);
    assert.notEqual(await rootOf(o.joiner), await rootOf(o.holder));
    // A stale holder of another X account (its handle moved on) signing in with this X: refused at sign-in.
    const p = await offered();
    await sql()`UPDATE builder_profiles SET x_user_id = ${`v2134stale${randomBytes(3).toString('hex')}`}, x_handle = NULL WHERE builder_id = ${await rootOf(p.joiner)}`;
    assert.notEqual((await confirmJoin(p.t, p.cookie)).status, 200);
    assert.notEqual(await rootOf(p.joiner), await rootOf(p.holder));
  }));

test('S.f the join is recorded in the event log', dbTest, () =>
  withEnv({ ...ON, EARNKIT_EVENT_LOG: 'on' }, async () => {
    const o = await offered();
    assert.equal((await confirmJoin(o.t, o.cookie)).status, 200);
    const root = await rootOf(o.holder);
    const [e] = await sql()<{ detail: { from: number; via: string } }[]>`SELECT detail FROM builder_events WHERE type = 'page_joined' AND installation_id = ${root}`;
    assert.ok(e, 'a page_joined event');
    assert.equal(e.detail.via, 'x_claim_page');
    assert.equal(e.detail.from, o.joiner);
  }));

test('e.4 the live check: placeholder hosts are never live, except EarnKit\'s own site for EarnKit\'s own repos (the owner\'s test); a failed read is not live; only https', async () => {
  const was = liveDefaults.probe;
  const probed: string[] = [];
  liveDefaults.probe = async (url: string) => (probed.push(url), '<html><title>EarnKit: get funded</title><body>Ship every week.</body></html>');
  try {
    assert.deepEqual(await checkLive('https://earnkit.com', 'earnkitai/earnkit'), { ok: true, title: 'EarnKit: get funded' });
    assert.deepEqual(await checkLive('https://earnkit.com', 'maya/recipes'), { ok: false, title: null });
    assert.deepEqual(await checkLive('https://example.com', 'maya/recipes'), { ok: false, title: null });
    assert.deepEqual(await checkLive('http://recipes.app', 'maya/recipes'), { ok: false, title: null });
    assert.deepEqual(probed, ['https://earnkit.com'], 'a placeholder or plain-http link is never fetched');
    assert.equal(displayName('earnkit', 'earnkitai/earnkit', 'EarnKit: get funded'), 'EarnKit');
    liveDefaults.probe = async () => {
      throw new Error('down');
    };
    assert.deepEqual(await checkLive('https://recipes.app', 'maya/recipes'), { ok: false, title: null });
  } finally {
    liveDefaults.probe = was;
  }
});

// ---- R6 (controller ruling, answering a scan: the R1 join is weaker than the two-agent yes) --------

/** A page with a confirmed main project (claimed with X user `x<id>`), and a new installation joined to it by R1. */
async function joinedPage(o: { clientName?: string; extra?: number } = {}) {
  const key = `${uniq('r6')}/recipes`;
  const handle = uniq('r6h').slice(0, 15);
  const holder = await person({ main: key, claimed: handle, projects: [{ key, name: 'Recipe planner', confirmed: true }] });
  // A second installation already on the page before the join (eligible too).
  if (o.extra !== undefined) await sql()`UPDATE installations SET builder_id = ${holder} WHERE id = ${o.extra}`;
  const joiner = await install();
  if (o.clientName) await sql()`UPDATE installations SET client_name = ${o.clientName} WHERE id = ${joiner}`;
  const r = await find(joiner, {}, NO_MATCH);
  const s = await signIn(r.claim!.link, { id: `x${holder}`, username: handle, name: 'Maya', avatar: null });
  const t = offerOf(s.body)!;
  assert.ok(t, s.body);
  const page = s.body;
  assert.equal((await confirmJoin(t, s.cookie)).status, 200);
  assert.equal(await rootOf(joiner), holder);
  return { key, handle, holder, joiner, page };
}
const asJoiner = (j: { holder: number; joiner: number }) => ({ installationId: j.holder, ownInstallationId: j.joiner }) as never;
const asHolder = (j: { holder: number }) => ({ installationId: j.holder, ownInstallationId: j.holder }) as never;

test('R6.1 the R1 page names what is joining: the agent\'s registered client name and when it connected', dbTest, () =>
  on(async () => {
    const j = await joinedPage({ clientName: 'Claude Desktop' });
    assert.ok(j.page.includes(CLAIM_TEXT.joinAgent('Claude Desktop', 'just now')), j.page);
    assert.equal(CLAIM_TEXT.joinAgent('Claude Desktop', '3 minutes ago'), 'This agent: Claude Desktop, connected 3 minutes ago.');
    const now = new Date();
    assert.equal(agoText(new Date(now.getTime() - 3 * 60_000), now), '3 minutes ago');
    assert.equal(agoText(new Date(now.getTime() - 60 * 60_000), now), '1 hour ago');
    assert.equal(agoText(new Date(now.getTime() - 3 * 86_400_000), now), '3 days ago');
    assert.equal(clientNameOf('  Claude\u0000 Desktop <script>  '), 'Claude Desktop script');
    assert.equal(clientNameOf(42), null);
    assert.equal(clientNameOf('x'.repeat(80))?.length, 40);
  }));

const tell = (input: Record<string, unknown>, ctx: never) => tools.tell(input, ctx) as Promise<Found & Record<string, unknown>>;
/** Ends on exactly one question (the last line). */
const endsOnOne = (t: string, what: string) => {
  assert.ok(t.trimEnd().endsWith('?'), `${what}\n${t}`);
  assert.equal(questions(t), 1, `${what}\n${t}`);
};
const noticeFind = (j: { holder: number }, own: number) => find(j.holder, {}, { ownInstallationId: own, ...NO_MATCH }) as Promise<Found & Record<string, unknown>>;
const NOTICE = /A new agent was added to your page on \w+ \d+\. If that wasn't you, want me to remove it\?$/;
const answer = (j: { holder: number }, own: number, pk: string, a: 'yes' | 'no') =>
  tell({ move_up: { kind: 'remove_agent', project_key: pk, answer: a } }, { installationId: j.holder, ownInstallationId: own } as never);

test('R7.0 the R1 page names the installation that minted the claim link (not the group root)', dbTest, () =>
  on(async () => {
    const key = `${uniq('r7m')}/recipes`;
    const handle = uniq('r7m').slice(0, 15);
    const holder = await person({ main: key, claimed: handle, projects: [{ key, name: 'Recipe planner', confirmed: true }] });
    const a = await install();
    const b = await install();
    await find(a, {}, NO_MATCH);
    await linkInstallations(b, [a]);
    await sql()`UPDATE installations SET client_name = 'Root Client' WHERE id = ${a}`;
    await sql()`UPDATE installations SET client_name = 'Cursor' WHERE id = ${b}`;
    const r = await find(a, {}, { ownInstallationId: b, ...NO_MATCH });
    const code = r.claim!.link.split('/').pop()!;
    const [c] = await sql()<{ minted_by: number }[]>`SELECT minted_by FROM claim_codes WHERE code_hash = ${createHash('sha256').update(code).digest('hex')}`;
    assert.equal(c.minted_by, b, 'the installation that asked for the link');
    // v2.13.4 R8: a group of two is never offered the one click.
    const s2 = await signIn(r.claim!.link, { id: `x${holder}`, username: handle, name: 'Maya', avatar: null });
    assert.equal(offerOf(s2.body), null);
    assert.ok(s2.body.includes(CLAIM_TEXT.needsFresh.replace(/"/g, '&quot;')), s2.body);
    // A fresh, empty installation's page names it (the minting installation is the installation itself).
    const lone = await install();
    await sql()`UPDATE installations SET client_name = 'Cursor' WHERE id = ${lone}`;
    const rl = await find(lone, {}, NO_MATCH);
    const sl = await signIn(rl.claim!.link, { id: `x${holder}`, username: handle, name: 'Maya', avatar: null });
    assert.ok(sl.body.includes(CLAIM_TEXT.joinAgent('Cursor', 'just now')), sl.body);
  }));

test('R7.1 the notice is per installation: re-shown until that installation answers, even while its reply is held; one question', dbTest, () =>
  on(async () => {
    const j = await joinedPage();
    const f1 = await noticeFind(j, j.holder);
    assert.match(f1.show_to_builder, NOTICE, f1.show_to_builder);
    endsOnOne(f1.show_to_builder, 'notice');
    assert.equal(f1.move_up?.kind, 'remove_agent');
    const [{ at }] = await sql()<{ at: Date }[]>`SELECT joined_at AS at FROM page_joins WHERE root = ${j.holder} ORDER BY id DESC LIMIT 1`;
    assert.equal(f1.show_to_builder.split('\n').at(-1), joinNoticeLine(at));
    assert.equal(joinNoticeLine(new Date('2026-10-17T12:00:00Z')), "A new agent was added to your page on Oct 17. If that wasn't you, want me to remove it?");
    // Not answered: shown again, and the shared bench_ask is not where it lives.
    assert.match((await noticeFind(j, j.holder)).show_to_builder, NOTICE);
    const [seen] = await sql()<{ ask: { kind?: string } | null }[]>`SELECT standing_seen->'bench_ask' AS ask FROM builder_profiles WHERE builder_id = ${j.holder}`;
    assert.notEqual(seen.ask?.kind, 'remove_agent');
    // Held (an outcome question or a join question pending): the notice still shows, as the one question.
    const login = uniq('r7gh').toLowerCase();
    await sql()`UPDATE builder_profiles SET github_login = ${login}, github_basis = 'signin' WHERE builder_id = ${j.holder}`;
    const other = await install();
    await find(other, {}, NO_MATCH);
    await joinOnProvenTie(other, { github_login: login });
    const held = await noticeFind(j, j.holder);
    assert.match(held.show_to_builder, NOTICE, held.show_to_builder);
    endsOnOne(held.show_to_builder, 'held');
    // A second earlier installation of the page sees it too, separately.
    const second = await install();
    const j2 = await joinedPage({ extra: second });
    await answer(j2, j2.holder, (await noticeFind(j2, j2.holder)).move_up!.project_key!, 'no');
    assert.doesNotMatch((await noticeFind(j2, j2.holder)).show_to_builder, /A new agent was added/, 'answered: not again for it');
    assert.match((await noticeFind(j2, second)).show_to_builder, NOTICE, 'still asked of the other installation');
  }));

test('R7.2 the newcomer can never answer or clear the notice (yes or no); eligibility is by join order, checked on yes and no', dbTest, () =>
  on(async () => {
    const j = await joinedPage();
    const pk = (await noticeFind(j, j.holder)).move_up!.project_key!;
    for (const a of ['yes', 'no'] as const) {
      const r = await answer(j, j.joiner, pk, a);
      assert.notEqual(r.show_to_builder.split('\n')[0], DETACH_LINES.done.split('\n')[0]);
      endsOnOne(r.show_to_builder, `newcomer ${a}`);
    }
    assert.equal(await rootOf(j.joiner), j.holder, 'not detached');
    assert.match((await noticeFind(j, j.holder)).show_to_builder, NOTICE, 'not cleared for the owner');
    // A later join's member can't answer an earlier join; an earlier join's attached member can answer a later one.
    const later = await install();
    const rl = await find(later, {}, NO_MATCH);
    const [h] = await sql()<{ handle: string }[]>`SELECT x_handle AS handle FROM builder_profiles WHERE builder_id = ${j.holder}`;
    const sl = await signIn(rl.claim!.link, { id: `x${j.holder}`, username: h.handle, name: 'Maya', avatar: null });
    assert.equal((await confirmJoin(offerOf(sl.body)!, sl.cookie)).status, 200);
    const r2 = await answer(j, later, pk, 'yes');
    assert.notEqual(r2.show_to_builder.split('\n')[0], DETACH_LINES.done.split('\n')[0]);
    assert.equal(await rootOf(j.joiner), j.holder, 'a later newcomer never detaches an earlier one');
    // The earlier member (still attached) is eligible for the later join once its probation is over.
    await sql()`UPDATE page_joins SET joined_at = joined_at - interval '2 days' WHERE root = ${j.holder} AND ${j.joiner}::int = ANY(members)`;
    const fl = await noticeFind(j, j.joiner);
    assert.match(fl.show_to_builder, NOTICE, fl.show_to_builder);
  }));

test('R7.3 a yes from an eligible installation detaches the newcomer back to its own former group and hides its updates; the line says so; a no-op is never "Done"', dbTest, () =>
  withEnv({ ...ON, EARNKIT_EVENT_LOG: 'on' }, async () => {
    // v2.13.4 R8: the joining side is a single fresh installation.
    const jp = await joinedPage();
    const { holder } = jp;
    const a = jp.joiner;
    const j = { holder, joiner: a };
    const posted = await tell({ update: { text: 'Added the fridge photo import.' } }, asJoiner(j));
    assert.ok(posted.show_to_builder.length > 0, JSON.stringify(posted));
    const pk = (await noticeFind(j, holder)).move_up!.project_key!;
    const yes = await answer(j, holder, pk, 'yes');
    assert.ok(yes.show_to_builder.startsWith(DETACH_LINES.done), yes.show_to_builder);
    assert.equal(DETACH_LINES.done, "Done. That agent is off your page, and its updates since it joined are hidden.");
    endsOnOne(yes.show_to_builder, 'detach');
    assert.equal(await rootOf(a), a, 'its own again');
    const [u] = await sql()<{ hidden: boolean }[]>`SELECT hidden FROM project_updates WHERE builder_id = ${holder} AND posted_by = ${a}`;
    assert.equal(u.hidden, true);
    const [e] = await sql()`SELECT 1 FROM builder_events WHERE type = 'page_detached' AND installation_id = ${holder}`;
    assert.ok(e, 'logged');
    // The same yes again: nothing to do, never "Done".
    const again = await answer(j, holder, pk, 'yes');
    assert.ok(!again.show_to_builder.startsWith('Done.'), again.show_to_builder);
  }));

test('R7.4 probation: for 24 hours the newcomer may only post updates; every other write is refused with one line and one question', dbTest, () =>
  withEnv({ ...ON, ...APP, EARNKIT_RAISING: 'on' }, async () => {
    const j = await joinedPage();
    const ctx = asJoiner(j);
    const before = (await sql()<{ main: string; identity: unknown; reported: string | null; hidden: boolean; updates: Date | null }[]>`
      SELECT main_project_key AS main, identity, reported_github AS reported, hidden, updates_on_at AS updates FROM builder_profiles WHERE builder_id = ${j.holder}`)[0];
    const refusals: [string, Promise<Found & Record<string, unknown>>][] = [];
    const add = (what: string, p: Promise<unknown>) => refusals.push([what, p as Promise<Found & Record<string, unknown>>]);
    add('coin', tell({ coin: { project_key: j.key, answer: 'yes', wallet: `0x${'2b'.repeat(20)}` } }, ctx));
    add('raising', tell({ coin: { raising: true } }, ctx));
    add('hide', tell({ profile: 'hide' }, ctx));
    add('card', tell({ card: 'yes' }, ctx));
    add('updates off', tell({ updates: { on: false } }, ctx));
    add('not_mine', tell({ repo_facts: [{ repo: j.key, not_mine: true }] }, ctx));
    add('move_up', tell({ move_up: { kind: 'updates', project_key: j.key, answer: 'yes' } }, ctx));
    add('prepare', tools.prepare({ program_id: 'earnkit-coin' }, ctx));
    add('build', tools.prepare({ program_id: 'arc-microgrants', build: { start: true, program_id: 'arc-microgrants' } }, ctx));
    add('confirm', tools.confirm({ project_id: 1, yes: true }, ctx));
    add('confirm entry', tools.confirm({ program_id: 'arc-microgrants', yes: true }, ctx));
    for (const [what, p] of refusals) {
      const r = await p;
      assert.ok(Object.values(PROBATION_LINES).some((l) => r.show_to_builder.startsWith(l.split('\n')[0])), `${what}: ${r.show_to_builder}`);
      endsOnOne(r.show_to_builder, what);
    }
    // find: another project is refused (the main stays), identity isn't written, no proof code or install link is made.
    const other = `${uniq('r7o')}/thing`;
    const codes = async () => (await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM proof_branches WHERE builder_id = ${j.holder}`)[0].n;
    const n0 = await codes();
    const f = await findAs(j.joiner, { agent_can_build: true, github_user: 'someoneelse', identity: { github_login: 'someoneelse', project: { name: 'Thing', repo: other } } });
    assert.ok(f.show_to_builder.startsWith(PROBATION_LINES.main.split('\n')[0]), f.show_to_builder);
    endsOnOne(f.show_to_builder, 'find');
    assert.equal(f.proof, undefined);
    assert.doesNotMatch(f.show_to_builder, /github\/verify/);
    assert.equal(await codes(), n0, 'no code issued');
    const after = (await sql()<{ main: string; identity: unknown; reported: string | null; hidden: boolean; updates: Date | null }[]>`
      SELECT main_project_key AS main, identity, reported_github AS reported, hidden, updates_on_at AS updates FROM builder_profiles WHERE builder_id = ${j.holder}`)[0];
    assert.deepEqual(after, before, 'nothing on the page changed');
    const s = (await tools.score({}, ctx)) as Found;
    assert.equal(s.proof, undefined);
    // Updates may be posted, and never over another installation's update for the same week.
    const mine = await tell({ update: { text: 'Shipped the import.' } }, ctx);
    assert.ok(mine.show_to_builder.length > 0 && !mine.agent_note?.toString().includes('not'), JSON.stringify(mine));
    const [row] = await sql()<{ id: number }[]>`SELECT id::int FROM project_updates WHERE builder_id = ${j.holder} AND posted_by = ${j.joiner}`;
    await sql()`UPDATE project_updates SET posted_by = ${j.holder}, text = 'The owner wrote this.' WHERE id = ${row.id}`;
    const over = await tell({ update: { text: 'Overwrite it.' } }, ctx);
    assert.ok(over.show_to_builder.startsWith(PROBATION_LINES.update_taken.split('\n')[0]), over.show_to_builder);
    endsOnOne(over.show_to_builder, 'overwrite');
    const [kept] = await sql()<{ text: string }[]>`SELECT text FROM project_updates WHERE id = ${row.id}`;
    assert.equal(kept.text, 'The owner wrote this.');
    // The owner's own agent isn't on probation; after a day the newcomer isn't either.
    const own = await tell({ coin: { raising: true } }, asHolder(j));
    assert.ok(!own.show_to_builder.startsWith(PROBATION_LINES.write.split('\n')[0]));
    await sql()`UPDATE page_joins SET joined_at = joined_at - interval '25 hours' WHERE root = ${j.holder}`;
    const later = await tell({ coin: { raising: true } }, ctx);
    assert.ok(!later.show_to_builder.startsWith(PROBATION_LINES.write.split('\n')[0]), later.show_to_builder);
  }));

test('R7.5 (item 8) a newcomer on probation can\'t pull a third installation onto the page by answering a GitHub join for the page', dbTest, () =>
  on(async () => {
    const j = await joinedPage();
    const login = uniq('r7p').toLowerCase();
    await sql()`UPDATE builder_profiles SET github_login = ${login}, github_basis = 'signin' WHERE builder_id = ${j.holder}`;
    const third = await install();
    await find(third, {}, NO_MATCH);
    assert.equal(await joinOnProvenTie(third, { github_login: login }), 1);
    await answerJoin(third, true); // the third side's yes
    const r = await tell({ pickup: 'yes' }, asJoiner(j));
    assert.ok(r.show_to_builder.startsWith(PROBATION_LINES.write.split('\n')[0]), r.show_to_builder);
    endsOnOne(r.show_to_builder, 'pickup');
    assert.notEqual(await rootOf(third), j.holder, 'not pulled onto the page');
    assert.ok(await pendingJoinOf(j.holder), 'still waiting for the owner');
    // The owner's own yes still works, once it has answered the notice about the new agent (R8).
    await answer(j, j.holder, (await noticeFind(j, j.holder)).move_up!.project_key!, 'no');
    await tell({ pickup: 'yes' }, asHolder(j));
    assert.equal(await rootOf(third), j.holder);
  }));

// ---- R8: the one click attaches only a fresh, empty installation ---------------------------------

/** A page claimed with X user `x<id>`, and the claim page as a candidate installation reaches it after Sign in with X. */
async function pageAndCandidate(prep: (cand: number) => Promise<unknown>) {
  const key = `${uniq('r8')}/recipes`;
  const handle = uniq('r8h').slice(0, 15);
  const holder = await person({ main: key, claimed: handle, projects: [{ key, name: 'Recipe planner', confirmed: true }] });
  const cand = await install();
  const r = await find(cand, {}, NO_MATCH);
  await prep(cand);
  const s = await signIn(r.claim!.link, { id: `x${holder}`, username: handle, name: 'Maya', avatar: null });
  return { holder, cand, key, s };
}
const W = (c: string) => `0x${c.repeat(40)}`;

test('R8.1 a fresh, empty installation joins with one click; the link carries none of its data and is recorded with the eligible installations', dbTest, () =>
  on(async () => {
    const j = await joinedPage();
    const [row] = await sql()<{ members: number[]; eligible: number[]; from_root: number }[]>`SELECT members, eligible, from_root FROM page_joins WHERE root = ${j.holder} ORDER BY id DESC LIMIT 1`;
    assert.deepEqual(row.members, [j.joiner]);
    assert.deepEqual(row.eligible, [j.holder]);
    assert.equal(row.from_root, j.joiner);
    assert.equal((await sql()`SELECT 1 FROM builder_profiles WHERE builder_id = ${j.joiner}`).length, 0, 'its empty profile is not merged, just dropped');
  }));

test('R8.2 not fresh or empty: a wallet, a payout wallet, a verification, an open verify nonce, a verified source, an entry, a coin offer, another member, a hosted site, a contract deploy, a host upload token or a proof line: no one click, a fresh connection instead (R10); nothing reaches the page', dbTest, () =>
  on(async () => {
    const cases: [string, (c: number) => Promise<unknown>][] = [
      ['wallet', (c) => sql()`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${c}, ${W('a')})`],
      ['person wallet', (c) => sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${`0x${randomBytes(20).toString('hex')}`}, ${c})`],
      ['payout wallet', (c) => sql()`UPDATE installations SET payout_wallet = ${W('b')} WHERE id = ${c}`],
      ['verification', (c) => sql()`INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose) VALUES (${`${uniq('v')}/r`}, ${uniq('gh')}, ${c}, now() - interval '2 years', 3, 'claim')`],
      ['open nonce', (c) => sql()`INSERT INTO github_verify_nonces (nonce_hash, installation_id, repo_key, purpose, expires_at) VALUES (${randomBytes(32).toString('hex')}, ${c}, ${`${uniq('n')}/r`}, 'app', now() + interval '1 hour')`],
      ['verified source', (c) => sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by, verified_at) VALUES (${c}, 'repo', ${`${uniq('s')}/r`}, ${`${uniq('s')}/r`}, 'verified', 'proof_line', 'agent', now())`],
      ['entry', (c) => sql()`INSERT INTO projects (program_id, name, installation_id) VALUES ('earnkit-coin', 'Thing', ${c})`],
      ['token offer', (c) => sql()`INSERT INTO token_offers (installation_id, program_id, entry_key, offered_name, offered_ticker) VALUES (${c}, 'earnkit-coin', 'k', 'Thing', 'THING')`],
      ['coin moment', (c) => sql()`INSERT INTO coin_moments (builder_id, project_key, moment) VALUES (${c}, 'a/b', 'countable')`],
      ['another member', async (c) => { const m = await install(); await sql()`UPDATE installations SET builder_id = ${c} WHERE id = ${m}`; }],
      // I-1: no projects row, but a hosted site, a deploy, an upload token or a proof line.
      ['hosted site', (c) => sql()`INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status) VALUES (${uniq('site')}, 'x', ${`${uniq('h')}/r`}, ${c}, 1, 1, 'live')`],
      ['contract deploy', (c) => sql()`INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, status, cost_micro_usd) VALUES (${c}, ${uniq('bk')}, ${`${uniq('d')}/r`}, 'arc', ${`0x${randomBytes(32).toString('hex')}`}, 'deployed', 1)`],
      ['host upload token', (c) => sql()`INSERT INTO host_upload_tokens (token_hash, installation_id, login, repo_key, slug, project, expires_at) VALUES (${randomBytes(32).toString('hex')}, ${c}, 'x', ${`${uniq('u')}/r`}, ${uniq('s')}, 'P', now() + interval '1 hour')`],
      ['proof line', (c) => sql()`INSERT INTO proof_line_issues (installation_id, repo_key, first_at) VALUES (${c}, ${`${uniq('pl')}/r`}, now())`],
    ];
    for (const [what, prep] of cases) {
      const t = await pageAndCandidate(prep);
      assert.equal(offerOf(t.s.body), null, `${what}: no one-click offer`);
      assert.ok(t.s.body.includes(CLAIM_TEXT.needsFresh), `${what}: ${t.s.body}`);
      assert.notEqual(await rootOf(t.cand), t.holder, `${what}: not joined`);
      assert.equal(await pendingJoinOf(t.cand), null, `${what}: R10, no X two-agent yes`);
      // Nothing of the candidate's reached the page.
      const [n] = await sql()<{ n: number }[]>`
        SELECT ((SELECT count(*) FROM github_verifications WHERE installation_id = ${t.holder})
          + (SELECT count(*) FROM installation_wallets WHERE installation_id = ${t.holder})
          + (SELECT count(*) FROM person_wallets WHERE builder_id = ${t.holder})
          + (SELECT count(*) FROM builder_sources WHERE builder_id = ${t.holder} AND proposed_by = 'agent' AND ref <> ${t.key})
          + (SELECT count(*) FROM token_offers WHERE installation_id = ${t.holder}))::int AS n`;
      assert.equal(n.n, 0, `${what}: nothing on the page`);
      const [p] = await sql()<{ payout: string | null }[]>`SELECT payout_wallet AS payout FROM installations WHERE id = ${t.holder}`;
      assert.equal(p.payout, null);
    }
  }));

test('R8.3 the offer re-checks at the click: an installation that got data after the offer is refused', dbTest, () =>
  on(async () => {
    const t = await pageAndCandidate(async () => undefined);
    const tok = offerOf(t.s.body)!;
    assert.ok(tok);
    await sql()`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${t.cand}, ${W('c')})`;
    assert.notEqual((await confirmJoin(tok, t.s.cookie)).status, 200);
    assert.notEqual(await rootOf(t.cand), t.holder);
    assert.equal((await sql()`SELECT 1 FROM page_joins WHERE ${t.cand}::int = ANY(members)`).length, 0, 'no join row without a link, nor a link without one');
  }));

test('R8.4 the old route is closed: an installation with a GitHub verification is never merged by the one click, so a later GitHub tie never reaches the page', dbTest, () =>
  on(async () => {
    const login = uniq('atk').toLowerCase();
    const t = await pageAndCandidate((c) => sql()`INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose) VALUES (${`${login}/r`}, ${login}, ${c}, now() - interval '2 years', 3, 'claim')`);
    assert.equal(offerOf(t.s.body), null);
    const third = await install();
    await find(third, {}, NO_MATCH);
    await joinOnProvenTie(third, { github_login: login });
    const [pj] = await sql()<{ target: number }[]>`SELECT target FROM pending_joins WHERE installation_id = ${third}`;
    assert.notEqual(await rootOf(pj.target), t.holder, 'the tie points at the attacker, never the page');
  }));

test('R8.5 a GitHub tie-join onto a page with an unanswered R1 join is refused until every eligible installation answers', dbTest, () =>
  on(async () => {
    const j = await joinedPage();
    const login = uniq('r8t').toLowerCase();
    await sql()`UPDATE builder_profiles SET github_login = ${login}, github_basis = 'signin' WHERE builder_id = ${j.holder}`;
    const third = await install();
    await find(third, {}, NO_MATCH);
    await joinOnProvenTie(third, { github_login: login });
    await answerJoin(third, true);
    assert.equal(await answerJoin(j.holder, true), 'refused');
    assert.notEqual(await rootOf(third), j.holder);
    // Once the owner answers the notice, the tie-join goes through.
    const pk = (await noticeFind(j, j.holder)).move_up!.project_key!;
    await answer(j, j.holder, pk, 'no');
    assert.equal(await answerJoin(j.holder, true), 'linked');
    assert.equal(await rootOf(third), j.holder);
  }));

test('R8.6 the notice follows the page\'s current root and the eligible snapshot; an installation added later is never eligible', dbTest, () =>
  on(async () => {
    const j = await joinedPage();
    // A later installation of the page (after the join) is not in the snapshot.
    const late = await install();
    await sql()`UPDATE installations SET builder_id = ${j.holder} WHERE id = ${late}`;
    assert.doesNotMatch((await noticeFind(j, late)).show_to_builder, /A new agent was added/);
    const pk = (await noticeFind(j, j.holder)).move_up!.project_key!;
    assert.ok(!(await answer(j, late, pk, 'yes')).show_to_builder.startsWith('Done.'));
    // The page re-roots under an older group: the notice still shows for the eligible installation.
    const older = await install();
    await sql()`UPDATE installations SET builder_id = ${older} WHERE id = ${j.holder} OR builder_id = ${j.holder}`;
    await sql()`UPDATE builder_profiles SET builder_id = ${older} WHERE builder_id = ${j.holder}`;
    const f = await find(older, {}, { ownInstallationId: j.holder, ...NO_MATCH });
    assert.match(f.show_to_builder, NOTICE, f.show_to_builder);
  }));

test('R8.7 probation fails closed, mints no App link, keeps no match, and counts update posts per installation', dbTest, () =>
  withEnv({ ...ON, ...APP }, async () => {
    const { withProbation } = await import('./tools');
    const j = await joinedPage();
    // A failed read is probation (an id the database can't even read).
    const ctx = await withProbation({ installationId: j.holder, ownInstallationId: 2 ** 40 } as never);
    assert.equal((ctx as { probation?: boolean }).probation, true);
    // No App verify nonce minted on probation (a private repo matched or reported).
    const n0 = (await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM github_verify_nonces WHERE installation_id = ${j.holder}`)[0].n;
    const unseen = { matchProjects: async () => ({ checked: 1, scored: 0, fits: [], unseen: [{ name: 'secret', full_name: `${uniq('p')}/secret` }] }) };
    await find(j.holder, { agent_can_build: true }, { ownInstallationId: j.joiner, ...unseen });
    assert.equal((await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM github_verify_nonces WHERE installation_id = ${j.holder}`)[0].n, n0);
    const [m] = await sql()<{ m: unknown }[]>`SELECT standing_seen->'bench_match' AS m FROM builder_profiles WHERE builder_id = ${j.holder}`;
    assert.equal(m.m, null, 'no kept match written');
    // The page's daily posts are not used up by a probationer.
    await sql()`DELETE FROM rate_windows WHERE key LIKE ${`updatePost:${j.holder}%`}`;
    for (let i = 0; i < 25; i++) await tools.tell({ update: { text: `Shipped part ${i} of the import.` } }, asJoiner(j));
    const owner = await tools.tell({ update: { text: 'Shipped the owner part.' } }, asHolder(j)) as { show_to_builder: string; agent_note?: string };
    assert.doesNotMatch(String(owner.agent_note ?? ''), /limit|too many|tomorrow/i, JSON.stringify(owner));
  }));

test('R8.8 one probation tell with an update and a refused part: one reply, one question, last', dbTest, () =>
  on(async () => {
    const j = await joinedPage();
    const r = await tell({ update: { text: 'Added the fridge photo import.' }, profile: 'hide' }, asJoiner(j));
    endsOnOne(r.show_to_builder, 'combined');
    assert.ok(r.show_to_builder.includes(PROBATION_LINES.write.split('\n')[0]), r.show_to_builder);
  }));

// ---- R9: agent-reported, unproven data never blocks the one click; it is discarded at the join ----

test('R9.1 a realistic reconnect (the first find reports the repo and a GitHub login) gets the one click; nothing it reported is merged; the next find shows "Linked to your page" with the page\'s project', dbTest, () =>
  on(async () => {
    const login = uniq('jenil').toLowerCase();
    const key = `${uniq('earnkitai')}/earnkit`;
    const handle = uniq('r9h').slice(0, 15);
    const holder = await person({ main: key, claimed: handle, projects: [{ key, name: 'Earnkit', confirmed: true }] });
    const [before] = await sql()<{ identity: unknown; reported: string | null; n: number }[]>`
      SELECT identity, reported_github AS reported, (SELECT count(*)::int FROM builder_sources WHERE builder_id = ${holder}) AS n FROM builder_profiles WHERE builder_id = ${holder}`;
    const cand = await install();
    const gh = fakeGitHub();
    gh.repos[key] = { owner: { login: key.split('/')[0], type: 'Organization' } };
    const r = await find(cand, { agent_can_build: true, github_user: login, local_repos: [{ name: 'earnkit', url: `https://github.com/${key}` }] }, { ...NO_MATCH, proofBranchFetch: gh.f });
    const [rep] = await sql()<{ n: number; reported: string | null }[]>`
      SELECT (SELECT count(*)::int FROM builder_sources WHERE builder_id = ${cand} AND state = 'proposed') AS n, reported_github AS reported FROM builder_profiles WHERE builder_id = ${cand}`;
    assert.ok(rep.n > 0 && rep.reported === login, 'the agent reported a project and a login');
    const s = await signIn(r.claim!.link, { id: `x${holder}`, username: handle, name: 'Maya', avatar: null });
    const t = offerOf(s.body);
    assert.ok(t, `the one click: ${s.body}`);
    assert.equal((await confirmJoin(t!, s.cookie)).status, 200);
    assert.equal(await rootOf(cand), holder);
    const [after] = await sql()<{ identity: unknown; reported: string | null; n: number }[]>`
      SELECT identity, reported_github AS reported, (SELECT count(*)::int FROM builder_sources WHERE builder_id = ${holder}) AS n FROM builder_profiles WHERE builder_id = ${holder}`;
    assert.deepEqual(after, before, 'nothing it reported reached the page');
    assert.equal((await sql()`SELECT 1 FROM builder_sources WHERE builder_id = ${cand}`).length, 0, 'its reports are discarded');
    assert.equal((await sql()`SELECT 1 FROM claim_codes WHERE builder_id = ${cand}`).length, 0);
    const f = await findAs(cand, { agent_can_build: true, github_user: login, local_repos: [{ name: 'earnkit', url: `https://github.com/${key}` }] }, { proofBranchFetch: gh.f });
    assert.match(f.show_to_builder, /Linked to your page: /, f.show_to_builder);
    assert.match(f.show_to_builder, /^Earnkit is on the Bench/m, f.show_to_builder);
    assert.doesNotMatch(f.show_to_builder, /can't change your project/, 'the same project is no change');
  }));

// ---- TOCTOU (scan): each check and its write in one transaction, with locks --------------------

test('C.1 two concurrent yeses to the same notice: exactly one detaches', dbTest, () =>
  on(async () => {
    const second = await install();
    const j = await joinedPage({ extra: second });
    const pk = (await noticeFind(j, j.holder)).move_up!.project_key!;
    const [a, b] = await Promise.all([answer(j, j.holder, pk, 'yes'), answer(j, second, pk, 'yes')]);
    const done = [a, b].filter((r) => r.show_to_builder.startsWith('Done.'));
    assert.equal(done.length, 1, `${a.show_to_builder}\n---\n${b.show_to_builder}`);
    const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events WHERE type = 'page_detached' AND installation_id = ${j.holder}`;
    assert.ok(n <= 1);
  }));

test('C.2 the emptiness check and the link are one locked step: data the newcomer gains while the click waits refuses the join', dbTest, () =>
  on(async () => {
    const t = await pageAndCandidate(async () => undefined);
    const tok = offerOf(t.s.body)!;
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    // Another transaction gives the newcomer a wallet and holds it open while the click runs.
    const writer = sql().begin(async (tx) => {
      await tx`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${t.cand}, ${W('d')})`;
      await hold;
    });
    await new Promise((r) => setTimeout(r, 50));
    const click = confirmJoin(tok, t.s.cookie);
    await new Promise((r) => setTimeout(r, 150));
    release();
    await writer;
    assert.notEqual((await click).status, 200);
    assert.notEqual(await rootOf(t.cand), t.holder);
    assert.equal((await sql()`SELECT 1 FROM page_joins WHERE ${t.cand}::int = ANY(members)`).length, 0);
  }));

// ---- Stale consent (scan on identity.ts): a pending join's yes is bound to what it was given for ----

/** A page and a non-empty installation that asked to join it with the same X (the two-agent yes). */
async function tieAsk() {
  // R10: the two-agent yes is the GitHub-login tie (unchanged since v2.13.3); the X tie is gone under the Bench.
  const t = await pageAndCandidate((c) => sql()`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${c}, ${`0x${randomBytes(20).toString('hex')}`})`);
  const login = uniq('kt').toLowerCase();
  await sql()`UPDATE builder_profiles SET github_login = ${login}, github_basis = 'signin' WHERE builder_id = ${t.holder}`;
  assert.equal(await joinOnProvenTie(t.cand, { github_login: login }), 1);
  assert.ok(await pendingJoinOf(t.cand), 'asked');
  return t;
}

test('K.1 both yeses on unchanged facts link (the strong path still works)', dbTest, () =>
  on(async () => {
    const t = await tieAsk();
    assert.equal(await answerJoin(t.cand, true), 'waiting');
    assert.equal(await answerJoin(t.holder, true), 'linked');
    assert.equal(await rootOf(t.cand), t.holder);
  }));

test('K.2 the consent expires after 24 hours', dbTest, () =>
  on(async () => {
    const t = await tieAsk();
    await answerJoin(t.cand, true);
    await sql()`UPDATE pending_joins SET created_at = created_at - interval '25 hours' WHERE installation_id = ${t.cand}`;
    assert.equal(await answerJoin(t.holder, true), 'none', 'no longer asked');
    assert.notEqual(await rootOf(t.cand), t.holder);
  }));

test('K.3 void when the joining side gained data or a member after the ask', dbTest, () =>
  on(async () => {
    const t = await tieAsk();
    await answerJoin(t.cand, true);
    await sql()`INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose) VALUES (${`${uniq('k3')}/r`}, ${uniq('k3')}, ${t.cand}, now() - interval '2 years', 3, 'claim')`;
    assert.equal(await answerJoin(t.holder, true), 'expired');
    assert.notEqual(await rootOf(t.cand), t.holder);
    const u = await tieAsk();
    await answerJoin(u.cand, true);
    const m = await install();
    await sql()`UPDATE installations SET builder_id = ${u.cand} WHERE id = ${m}`;
    assert.equal(await answerJoin(u.holder, true), 'expired');
    assert.notEqual(await rootOf(u.cand), u.holder);
  }));

test('K.4 void when the page re-rooted, or had an R1 join or detach after the ask (no replay)', dbTest, () =>
  on(async () => {
    const t = await tieAsk();
    await answerJoin(t.cand, true);
    // An R1 join onto the page after the ask (a fresh installation, one click), then the owner answers it.
    const fresh = await install();
    const rf = await find(fresh, {}, NO_MATCH);
    const [h] = await sql()<{ handle: string }[]>`SELECT x_handle AS handle FROM builder_profiles WHERE builder_id = ${t.holder}`;
    const sf = await signIn(rf.claim!.link, { id: `x${t.holder}`, username: h.handle, name: 'Maya', avatar: null });
    assert.equal((await confirmJoin(offerOf(sf.body)!, sf.cookie)).status, 200);
    await answer({ holder: t.holder }, t.holder, (await noticeFind({ holder: t.holder }, t.holder)).move_up!.project_key!, 'no');
    assert.equal(await answerJoin(t.holder, true), 'expired');
    assert.notEqual(await rootOf(t.cand), t.holder);
    // Re-rooted page.
    const v = await tieAsk();
    await answerJoin(v.cand, true);
    const older = await install();
    await sql()`UPDATE installations SET builder_id = ${older} WHERE id = ${v.holder} OR builder_id = ${v.holder}`;
    await sql()`UPDATE builder_profiles SET builder_id = ${older} WHERE builder_id = ${v.holder}`;
    assert.notEqual(await answerJoin(older, true), 'linked');
    assert.notEqual(await rootOf(v.cand), older);
  }));

test('E.1 (scan on page-joins.ts) eligibility needs the join-time snapshot AND still being on the page', dbTest, () =>
  on(async () => {
    const second = await install();
    const j = await joinedPage({ extra: second });
    const pk = (await noticeFind(j, second)).move_up!.project_key!;
    await sql()`UPDATE installations SET builder_id = NULL WHERE id = ${second}`; // it left the page
    const r = await answer(j, second, pk, 'yes');
    assert.ok(!r.show_to_builder.startsWith('Done.'), r.show_to_builder);
    assert.equal(await rootOf(j.joiner), j.holder);
  }));

// ---- R10 and the table registry (final review) ---------------------------------------------------

test('R10.1 the review\'s exploit: a non-empty attacker agent, the victim\'s X sign-in, both yeses: nothing is linked or merged', dbTest, () =>
  on(async () => {
    const t = await pageAndCandidate((c) => sql()`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${c}, ${`0x${randomBytes(20).toString('hex')}`})`);
    assert.equal(CLAIM_TEXT.needsFresh, "This agent already has its own data, so it can't join your page. Reconnect EarnKit in this agent (a fresh connection) and sign in with X again.");
    assert.ok(t.s.body.includes(CLAIM_TEXT.needsFresh), t.s.body);
    assert.equal(offerOf(t.s.body), null);
    assert.equal(await pendingJoinOf(t.cand), null);
    assert.equal(await pendingJoinOf(t.holder), null);
    assert.equal(await answerJoin(t.cand, true), 'none');
    assert.equal(await answerJoin(t.holder, true), 'none');
    assert.notEqual(await rootOf(t.cand), t.holder);
    const [n] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM installation_wallets WHERE installation_id = ${t.holder}`;
    assert.equal(n.n, 0);
  }));

test('REG.1 every table keyed by an installation or person (installation_id, builder_id, posted_by, minted_by, or an FK to installations) is in the join registry', dbTest, async () => {
  const cols = await sql()<{ k: string }[]>`
    SELECT table_name || '.' || column_name AS k FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name IN ('installation_id', 'builder_id', 'posted_by', 'minted_by')
    UNION SELECT conrelid::regclass::text || '.' || a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'installations'::regclass`;
  const known = new Set(JOIN_TABLES.map((t) => `${t.table}.${t.column}`));
  const missing = cols.map((c) => c.k).filter((k) => !known.has(k));
  assert.deepEqual(missing, [], 'unclassified tables');
  for (const t of JOIN_TABLES) assert.ok(['blocks', 'discard', 'stays'].includes(t.rule), t.table);
});

test('REG.2 the one click deletes the newcomer\'s harmless leftovers too (answers, match log, declines, program status)', dbTest, () =>
  on(async () => {
    const t = await pageAndCandidate(async (c) => {
      await sql()`INSERT INTO answer_bank (installation_id, project_key, kind, answer, program_id) VALUES (${c}, 'a/b', 'pitch', 'x', 'earnkit-coin')`;
      await sql()`INSERT INTO token_declines (installation_id, repo_key) VALUES (${c}, 'a/b')`;
      await sql()`INSERT INTO builder_program_status (installation_id, program_id, status) VALUES (${c}, 'earnkit-coin', 'working')`.catch(() => undefined);
    });
    const tok = offerOf(t.s.body);
    assert.ok(tok, t.s.body);
    assert.equal((await confirmJoin(tok!, t.s.cookie)).status, 200);
    for (const table of ['answer_bank', 'token_declines', 'builder_program_status'])
      assert.equal((await sql().unsafe(`SELECT 1 FROM ${table} WHERE installation_id = $1`, [t.cand])).length, 0, table);
  }));

// ---- Production follow-up: the old fields' local_repos entry carries its live link and name ------

test('P.1 through the real MCP layer (the find tool\'s input schema): old fields with local_repos[{ remote, live_url }] name the project "EarnKit" and nothing says "once it\'s live", on the first and second find', dbTest, () =>
  on(async () => {
    const was = liveDefaults.probe;
    liveDefaults.probe = async () => '<html><head><title>EarnKit | Where agents earn</title></head><body>Builders ship and get funded.</body></html>';
    const id = await install();
    const gh = fakeGitHub();
    gh.repos['earnkitai/earnkit'] = { owner: { login: 'earnkitai', type: 'Organization' } };
    const server = createMcpServer({ installationId: id, ...NO_MATCH, proofBranchFetch: gh.f } as never);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'p1', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const args = { github_user: 'jenil04', repos: ['earnkitai/earnkit'], local_repos: [{ remote: 'https://github.com/earnkitai/earnkit', live_url: 'https://earnkit.com' }] };
      for (const n of [1, 2]) {
        const res = (await client.callTool({ name: 'find', arguments: args })) as { content: { text: string }[]; isError?: boolean };
        assert.ok(!res.isError, res.content[0]?.text);
        const r = JSON.parse(res.content[0].text) as { show_to_builder: string };
        assert.match(r.show_to_builder, /\bEarnKit\b/, `find ${n}: ${r.show_to_builder}`);
        assert.doesNotMatch(r.show_to_builder, /\bEarnkit\b/, `find ${n}`);
        assert.doesNotMatch(r.show_to_builder, /once it's live|once your app is live/, `find ${n}: ${r.show_to_builder}`);
      }
      const [p] = await sql()<{ identity: { projects?: { repo: string | null; live_url: string | null }[] } }[]>`SELECT identity FROM builder_profiles WHERE builder_id = ${id}`;
      assert.deepEqual(p.identity.projects?.map((x) => [x.repo, x.live_url]), [['earnkitai/earnkit', 'https://earnkit.com']]);
    } finally {
      await client.close();
      liveDefaults.probe = was;
    }
  }));

test('P.2 the mapping (pure): an entry\'s live link is used when it names the repo (url, remote, repo), or has no repo and is the only entry or carries the repo\'s name; never from an entry naming another repo', () => {
  const map = (local_repos: unknown) =>
    benchIdentity({ identity: identityInput({}), project: null, local_git: localGitInput(undefined), repos: ['a/b'], local_repos }).project;
  assert.deepEqual([map([{ name: 'My App', remote: 'git@github.com:a/b.git', live_url: 'https://b.app' }])?.name, map([{ remote: 'a/b', live_url: 'https://b.app' }])?.live_url], ['My App', 'https://b.app']);
  assert.equal(map([{ live_url: 'https://b.app' }])?.live_url, 'https://b.app', 'the only entry, no repo named');
  assert.equal(map([{ name: 'other', live_url: 'https://o.app' }, { name: 'B', live_url: 'https://b.app' }])?.live_url, 'https://b.app', 'by name');
  assert.equal(map([{ name: 'x', live_url: 'https://x.app' }, { name: 'y', live_url: 'https://y.app' }])?.live_url, null, 'ambiguous: none');
  assert.equal(map([{ url: 'https://github.com/c/d', live_url: 'https://d.app' }])?.live_url, null, 'never another repo\'s link');
});

test('P.3 flag off: the registered find input schema is byte for byte the same as before (score off and on)', async () => {
  const { createHash } = await import('node:crypto');
  const BEFORE = { off: '8e320cdb23addf10597862899cda73d89664337f15942f090b26d205d4c3dec7', on: 'e1df22a1cb00fc7a47f35ec5a597593b7c4b91af59d128d9f7114f4b60c761be' };
  await withEnv({ EARNKIT_BENCH: undefined, EARNKIT_BUILDER_SCORE: undefined }, async () => {
    for (const score of ['off', 'on'] as const) {
      if (score === 'on') process.env.EARNKIT_BUILDER_SCORE = 'on';
      const server = createMcpServer({ installationId: 1 });
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'p3', version: '0' });
      await Promise.all([server.connect(a), client.connect(b)]);
      const find = (await client.listTools()).tools.find((t) => t.name === 'find')!;
      await client.close();
      assert.equal(createHash('sha256').update(JSON.stringify(find.inputSchema)).digest('hex'), BEFORE[score], score);
    }
  });
});
