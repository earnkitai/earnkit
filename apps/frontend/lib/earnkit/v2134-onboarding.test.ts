import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';
import { tools } from './tools';
import { CLAIM_TEXT, bindX, claimGet, claimJoinPost, claimPost, xCallback } from './claim';
import { joinOnProvenTie, pendingJoinOf, rootOf } from './identity';
import { X_ON, dropAvalanche, dropPrograms, find, install, withEnv, type Found } from './fixtures/find';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { committedProgram } from './fixtures/program-file';
import { fakeGitHub } from './fixtures/fake-github-branch';
import { APP, installApp, privateGitHub } from './fixtures/private-github';
import {
  BENCH_HEADS, claimAskLine, claimQuestion, checkingBranchLine, installAppAsk, linkedLine, onBenchLine, pageLine, privateLine,
} from './bench-reply';
import { CLAIM_NOTE, displayName } from './bench-find';
import { liveDefaults, parkedPage } from './live-check';
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
  if (liveId) await dropPrograms([liveId]);
  await sql().end();
});
/** This file's own open program that needs a live product, any chain, with the biggest prize (so it is named first). */
let liveId: string | null = null;
async function liveProgram() {
  if (liveId) return liveId;
  const id = `v2134-live-${randomBytes(4).toString('hex')}`;
  const p = { ...committedProgram('avalanche-team1-mini-grants'), id, title: `Live Fund ${id.slice(-4)}`, status: 'active', chains: [], any_chain: true,
    min_product_score: 5, tag: 'needs a live product', needs_repo: true, max_award_usd: 9_000_000 };
  await upsertProgram(ProgramFile.parse(p));
  liveId = id;
  return id;
}

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
    assert.equal(r3.show_to_builder.split('\n')[1], onBenchLine('Recipe planner', null, 0), r3.show_to_builder);
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

test('e.1 pure: a parked or placeholder page is never live; a real page is; the display name', () => {
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
    await liveProgram();
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
      assert.match(r1.show_to_builder, /Live Fund \w+: up to \$9M for any live app\./, r1.show_to_builder);
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
    await liveProgram();
    const was = liveDefaults.probe;
    liveDefaults.probe = async () => '<html><body>This domain is parked free, courtesy of the registrar. Buy this domain.</body></html>';
    try {
      const login = uniq('lee').toLowerCase();
      const id = await install();
      const r = await find(id, { agent_can_build: true, identity: { github_login: login, project: { name: 'tips', repo: `${login}/tips`, live_url: 'https://tips.example.app' } } }, { ...NO_MATCH, proofBranchFetch: fakeGitHub().f });
      const fund = r.show_to_builder.split('\n\n').find((p) => p.startsWith(BENCH_HEADS.fund)) ?? '';
      assert.match(fund, /once your app is live/, r.show_to_builder);
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
