import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';
import { tools } from './tools';
import { CLAIM_TEXT, bindX, claimGet, claimJoinPost, claimPost, xCallback } from './claim';
import { answerJoin, joinOnProvenTie, pendingJoinOf, rootOf } from './identity';
import { X_ON, dropAvalanche, find, install, person, withEnv, type Found } from './fixtures/find';
import { DETACH_LINES, PROBATION_LINES, joinNoticeLine } from './page-joins';
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

process.env.EARNKIT_BUILDER_SCORE = 'on';
process.env.EARNKIT_BENCH = 'on';
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
const ON = { EARNKIT_BUILDER_SCORE: 'on', EARNKIT_BENCH: 'on', EARNKIT_URL: undefined, ...X_ON };
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
    assert.ok(!body.includes(CLAIM_TEXT.joinPending));
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
    // An X pending join from before v2.13.4 is never asked under the Bench.
    await sql()`INSERT INTO pending_joins (installation_id, target, tie) VALUES (${b}, ${await rootOf(a)}, 'x_user_id') ON CONFLICT DO NOTHING`;
    const rb = await findAs(b);
    assert.doesNotMatch(rb.show_to_builder, /Your X is already on an EarnKit page/);
    assert.equal(await pendingJoinOf(b), null);
    await withEnv({ EARNKIT_BENCH: undefined }, async () => assert.notEqual(await pendingJoinOf(b), null));
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
    // An old X pending join (both yeses) never merges under the Bench.
    await sql()`INSERT INTO pending_joins (installation_id, target, tie, target_yes, joiner_yes) VALUES (${joiner}, ${await rootOf(holder)}, 'x_user_id', true, null) ON CONFLICT DO NOTHING`;
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
async function joinedPage(o: { clientName?: string } = {}) {
  const key = `${uniq('r6')}/recipes`;
  const handle = uniq('r6h').slice(0, 15);
  const holder = await person({ main: key, claimed: handle, projects: [{ key, name: 'Recipe planner', confirmed: true }] });
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
    const s2 = await signIn(r.claim!.link, { id: `x${holder}`, username: handle, name: 'Maya', avatar: null });
    assert.ok(s2.body.includes(CLAIM_TEXT.joinAgent('Cursor', 'just now')), s2.body);
    assert.ok(!s2.body.includes('Root Client'));
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
    const j2 = await joinedPage();
    const second = await install();
    await linkInstallations(second, [j2.holder]);
    await sql()`UPDATE page_joins SET joined_at = now() WHERE root = ${j2.holder}`; // the join came after both
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
    // The joining side is a group of two installations (root + member).
    const key = `${uniq('r7d')}/recipes`;
    const handle = uniq('r7d').slice(0, 15);
    const holder = await person({ main: key, claimed: handle, projects: [{ key, name: 'Recipe planner', confirmed: true }] });
    const a = await install();
    const b = await install();
    await find(a, {}, NO_MATCH);
    await linkInstallations(b, [a]);
    const r = await find(a, {}, { ownInstallationId: a, ...NO_MATCH });
    const s2 = await signIn(r.claim!.link, { id: `x${holder}`, username: handle, name: 'Maya', avatar: null });
    assert.equal((await confirmJoin(offerOf(s2.body)!, s2.cookie)).status, 200);
    assert.equal(await rootOf(b), holder);
    const j = { holder, joiner: a };
    const posted = await tell({ update: { text: 'Added the fridge photo import.' } }, asJoiner(j));
    assert.ok(posted.show_to_builder.length > 0, JSON.stringify(posted));
    const pk = (await noticeFind(j, holder)).move_up!.project_key!;
    const yes = await answer(j, holder, pk, 'yes');
    assert.ok(yes.show_to_builder.startsWith(DETACH_LINES.done), yes.show_to_builder);
    assert.equal(DETACH_LINES.done, "Done. That agent is off your page, and its updates since it joined are hidden.");
    endsOnOne(yes.show_to_builder, 'detach');
    assert.equal(await rootOf(a), a, 'its own former root again');
    assert.equal(await rootOf(b), a, 'its group is whole again, not scattered');
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
    // The owner's own yes still works.
    await tell({ pickup: 'yes' }, asHolder(j));
    assert.equal(await rootOf(third), j.holder);
  }));
