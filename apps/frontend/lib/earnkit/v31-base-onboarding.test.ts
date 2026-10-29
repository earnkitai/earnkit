import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { padPool } from './fixtures/rank-pool';
import { walletOffered } from './fixtures/wallet-step';
import { productOdds, productScore, traction } from './match';
import type { RepoFit } from './present';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { appSetup, PICK_PAGE } from './github-app';
import { csrfCookieName } from './github-verify';
import {
  BASE_START_ASK, LOVABLE_PROMPT_ASK, NEW_REPO_ASK, NEXT_STEP_ASK, NEXT_STEP_LATER, TEMPLATE_NOTICE, TITLES_ASK, baseStartSteps, benchReply, stateAsk, walletOffer,
  type BenchProject, type BenchView,
} from './bench-reply';
import { walletSetupAsk } from './bench-reply';
import { BASE_START_NOTE, BASE_STEPS_NOTE, LOVABLE_PROMPT_NOTE, NEW_REPO_NOTE, NEW_REPO_YES_NOTE, NEXT_STEP_NOTE, PICK_REPO_NOTE, staleRepo } from './bench-find';
import { WALLET_NOTE } from './wallet-offer';
import { takeNews, type StandBase } from './stand-view';
import { NO_PROJECT_YET, STARTING_ON_BASE, highlights, profileSite } from './site-data';
import { profileData, type ProfileData } from './bench-data';
import { isoWeekOf } from './weeks';
import BenchProfileView, { noProjectLine, startingLine } from '../../app/[handle]/BenchProfileView';

/**
 * 2026-10-23 Base onboarding (owner-approved): a builder with no GitHub or no project. Step 2's no is remembered and
 * never repeated; the Base walk-through is asked once (a no remembered); its yes is the steps, and the page reads
 * "Getting started on Base"; the optional wallet step comes once after the GitHub no; the picker's fork-or-template-only
 * refusal is said once in the next reply; a main project quiet for 8 weeks gets one nudge. Every reply: at most one
 * https link, exactly one question, no em dash or emoji.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v31-base-onboarding-test-secret';
(globalThis as { React?: typeof React }).React = React;

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
/** v4.0 setup step 3 on the no-GitHub path (nothing connected, so no project line): once a person. */
const isStep3 = (s: string) => s === walletSetupAsk(null, links(s)[0] ?? '');
const rule = (s: string, asks = 1) => {
  assert.ok(links(s).length <= 1, s);
  assert.equal(questions(s), asks, s);
  assert.doesNotMatch(s, /—|\p{Extended_Pictographic}/u, s);
  return s;
};
const GUIDE = 'https://docs.base.org/base-chain/builder-codes/builder-codes';
const STEP2 = /^\*\*Step 2 of 3:\*\* connect your app's code on GitHub so I can match you to the right programs\. Read-only, one click: https:\/\/earnkit\.com\/github\/verify\?n=\S+\n\nDone\?$/;
/** v4.0 approved copy 2: step 2 for a builder with no GitHub (said so): the Lovable or Bolt hint, its own question. */
const STEP2_HINT = /^\*\*Step 2 of 3:\*\* connect your app's code on GitHub so I can match you to the right programs\. Read-only, one click: https:\/\/earnkit\.com\/github\/verify\?n=\S+\n\nBuilt it in Lovable or Bolt\? Connect GitHub there first \(Lovable: Project settings, then Git\. Bolt: the GitHub icon, top right\)\.\n\nDone\?$/;
/** v3.1 cold read: the first reply's welcome (once). */
const WELCOME = (u: string) => `You're in, @${u}. Really glad you're here.`;
/** v3.1 cold read: the walk-through for Base Builder Grants as listed ($5,000, on Base). */
const STEPS = baseStartSteps({ org: 'Base', amount: '$5,000', chain: 'Base', name: 'Base Builder Grants' });
const seen = async (id: number) => ((await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`)[0]?.s ?? {});

let nextX = 0;
/** A builder signed in with X at install (a page, no project yet). */
async function signedIn(tag: string) {
  const t = `ek_bo_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const username = `bo${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `97${RUN}${++nextX}`, username, name: 'Maya Chen', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const no = async () => { throw new Error('offline'); };
  const readerDeps = new Proxy({}, { get: (_t, k) => (k === 'now' ? new Date() : k === 'ghSpent' ? () => false : k === 'ghFetch' ? undefined : no) });
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }), readerDeps } as never;
  return { id: c.id, ctx, username, login: username.toLowerCase() };
}
/** A signed-in builder whose one project is ranked (its last commits 10 to 12 weeks ago), the wallet step done. */
async function rankedOld() {
  const p = await signedIn('o');
  await walletOffered(p.id);
  const key = `${p.login}/kit`;
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 0, live_ok: false, commits_90d: 3 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: null, created_at: '2025-01-01T00:00:00Z', chains: {}, commits_in_window: {}, product, tx_count: 0, commits_90d: 3 };
  const fits: RepoFit[] = [{ repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, verdicts: [] } as never];
  const commits = [70, 77, 84].map((d, i) => ({ sha: `o${i}`, message: `Ship feature ${i}`, date: new Date(Date.now() - d * 86_400_000).toISOString() }));
  const gh = fakeGitHub({ [key]: { id: Number(`77${RUN}`), owner: p.login, installation: Number(`64${RUN}`), commits } });
  const ctx = { ...(p.ctx as object), codesFetch: gh as typeof fetch, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  await mcpCall(ctx as never, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  await installApp({ builderId: p.id, repoKey: key, login: p.login, gh });
  // No week with code in the backfill, so no connect offer: the next reply is a quiet one.
  return { ctx, key, id: p.id };
}
const find = async (ctx: never) => mcpCall(ctx, 'find', {});
const tell = async (ctx: never, kind: string, answer: 'yes' | 'no') => mcpCall(ctx, 'tell', { move_up: { kind, project_key: null, answer } });
/** The page as a visitor sees it (hero line and Highlights). */
async function pageText(id: number): Promise<{ text: string; sub: string }> {
  const d = (await profileData(id, new Date())) as ProfileData;
  const site = await profileSite(id, d, new Date());
  const html = renderToStaticMarkup(React.createElement(BenchProfileView, { data: d, site, page: 1 })).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');
  const [h] = await highlights(id, d, new Date());
  return { text: html.replace(/<[^>]+>/g, ' '), sub: h.sub };
}

test('the copy, word for word, one question each', () => {
  assert.equal(BASE_START_ASK, "Want to start building on Base? I'll walk you through it.");
  assert.equal(STEPS, [
    "Here's the path to Base's $5,000 grant:",
    '1. Build your app in Lovable or Bolt. Describe the idea and they write the code.',
    '2. Connect it to GitHub inside Lovable or Bolt.',
    "3. Connect GitHub here and I'll tell you what's left.",
    'Want me to write your Lovable prompt?',
  ].join('\n'));
  assert.equal(LOVABLE_PROMPT_ASK, 'Want me to write your Lovable prompt?');
  assert.equal(links(STEPS).length, 0);
  assert.match(LOVABLE_PROMPT_NOTE, /short prompt to paste into Lovable, from the idea they described/);
  void GUIDE;
  assert.equal(NEXT_STEP_ASK, "Is your app's code on GitHub yet?");
  // Fix round: the notes tell the agent how a builder connects after all.
  for (const n of [BASE_START_NOTE, WALLET_NOTE]) assert.match(n, /connect after all, call tell with move_up: \{ kind: 'pick_repo', project_key: null, answer: 'yes' \}/, n);
  assert.equal(TEMPLATE_NOTICE, 'If you made your app from a template, make a copy in your own account, then connect that.');
  assert.equal(NEW_REPO_ASK, 'Working on something new? Connect that repo instead.');
  assert.equal(noProjectLine('Maya Chen'), 'Maya Chen has no project on the leaderboard yet.');
  assert.equal(startingLine('Maya Chen'), 'Maya Chen is getting started on Base.');
  assert.deepEqual([STARTING_ON_BASE, NO_PROJECT_YET], ['Getting started on Base', 'No project on the leaderboard yet']);
  for (const s of [BASE_START_ASK, STEPS, NEXT_STEP_ASK, NEW_REPO_ASK, `${TEMPLATE_NOTICE}\n${BASE_START_ASK}`]) rule(s);
});

test('the order: step 2 until a no; then the walk-through, the wallet step, the resting question; the nudge before titles', () => {
  const W = 'https://earnkit.com/claim/wallet?t=x';
  const v = { state: 'no_project' as const, variant: null, project: null, link: 'https://earnkit.com/github/verify?n=1', handle: 'maya' };
  assert.equal(stateAsk({ ...v, wallet: W, baseAsk: true }).kind, 'pick_repo', 'never before the GitHub no');
  assert.equal(stateAsk({ ...v, link: null, githubNo: true, baseAsk: true, wallet: W }).kind, 'base_start');
  assert.equal(stateAsk({ ...v, link: null, githubNo: true, wallet: W }).line, walletOffer(W));
  const rest = stateAsk({ ...v, link: null, githubNo: true });
  assert.deepEqual([rest.kind, rest.line], ['next_step', NEXT_STEP_ASK]);
  const view: BenchView = { ...v, link: null, rank: null, streak: 0, target: null, fund: [], due: [], held: null, ask: rest, notice: TEMPLATE_NOTICE };
  // v3.1 cold read: "You're in" only when this reply is the first after sign-in (welcome).
  assert.equal(rule(benchReply(view)), `${TEMPLATE_NOTICE}\n${NEXT_STEP_ASK}`);
  assert.equal(rule(benchReply({ ...view, welcome: true })), `${WELCOME('maya')}\n\n${TEMPLATE_NOTICE}\n${NEXT_STEP_ASK}`);

  const project: BenchProject = { key: 'kit/kit', name: 'Kit', confirmed: true, live: false, weeks: 4 };
  const r = { state: 'ranked' as const, variant: null, project, link: null, handle: 'kit' };
  assert.equal(stateAsk({ ...r, newRepo: true, wallet: W }).kind, 'wallet');
  assert.equal(stateAsk({ ...r, newRepo: true, titles: true }).line, NEW_REPO_ASK);
  assert.equal(stateAsk({ ...r, titles: true }).line, TITLES_ASK);
  const ask = stateAsk({ ...r, newRepo: true });
  const rv: BenchView = { ...r, rank: '#3 of 12 builders', streak: 0, target: null, fund: [{ kind: 'fits', title: 'P', amount: '$5,000', when: 'rolling' }], due: [], held: null, ask };
  assert.equal(rule(benchReply(rv)), `Kit · #3 of 12 builders\n${NEW_REPO_ASK}`, 'a light nudge: no money line, no points');
});

test('staleRepo: no commits in the last 8 weeks (this one included); no weeks known is never stale', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  const wk = (n: number) => isoWeekOf(new Date(now.getTime() - n * 7 * 86_400_000));
  assert.equal(staleRepo([], now), false);
  assert.equal(staleRepo([wk(8), wk(12)], now), true);
  assert.equal(staleRepo([wk(7), wk(12)], now), false);
  assert.equal(staleRepo([wk(0)], now), false);
});

test('GitHub no, then yes to Base: step 2 never repeats, the steps once, setup step 3 once (v4.0), the page reads Getting started on Base', db, async () => {
  const p = await signedIn('y');
  const first = await find(p.ctx);
  const s1 = rule(show(first));
  assert.equal(s1.split('\n')[0], WELCOME(p.username));
  // v4.0 approved copy 2: the welcome, then step 2 alone (the intro named the open grant).
  assert.equal(s1.split('\n')[1], '');
  assert.match(s1.split('\n').slice(2).join('\n'), STEP2);
  assert.deepEqual(first.reply?.move_up, { kind: 'pick_repo', project_key: null, agent_note: PICK_REPO_NOTE });
  assert.match(PICK_REPO_NOTE, /no GitHub yet, or not connecting it now, is a no/);
  assert.equal((await pageText(p.id)).sub, NO_PROJECT_YET);

  // The no: remembered; its reply is the walk-through question, once.
  const no = await tell(p.ctx, 'pick_repo', 'no');
  assert.equal(rule(show(no)), BASE_START_ASK);
  assert.deepEqual(no.reply?.move_up, { kind: 'base_start', project_key: null, agent_note: BASE_START_NOTE });
  assert.equal(typeof (await seen(p.id)).github_no, 'string');

  // A news line's rewrite of standing_seen keeps every onboarding key (stand-view.ts takeNews).
  const base: StandBase = { standing: { ranked: false, rank: 0, total: 0 }, claimed: true, handle: p.username, signInLink: null };
  await takeNews(p.id, {}, base, new Date(), false);
  const kept = await seen(p.id);
  for (const k of ['github_no', 'base_asked', 'bench_ask']) assert.ok(k in kept, k);

  // Yes: the path (no link, one question); remembered, and the page says so.
  const yes = await tell(p.ctx, 'base_start', 'yes');
  assert.equal(rule(show(yes)), STEPS);
  assert.equal(yes.reply?.agent_note, BASE_STEPS_NOTE);
  assert.equal((yes.reply?.move_up as { kind: string }).kind, 'base_help');
  assert.deepEqual(((await seen(p.id)).base_walk as { answer: string }).answer, 'yes');
  const pg = await pageText(p.id);
  assert.equal(pg.sub, STARTING_ON_BASE);
  assert.ok(pg.text.includes(startingLine('Maya Chen')), pg.text);
  assert.ok(!pg.text.includes('has no project on the leaderboard yet'));

  // Its yes ("write my Lovable prompt"): no EarnKit text, the agent writes it; never the block again.
  const help = await tell(p.ctx, 'base_help', 'yes');
  assert.equal(show(help), '');
  assert.equal(help.reply?.agent_note, LOVABLE_PROMPT_NOTE);

  // v4.0: setup step 3 is for everyone (the GitHub no answers step 2): once, on the next reply.
  const step3 = await find(p.ctx);
  assert.ok(isStep3(rule(show(step3))), show(step3));
  assert.equal((step3.reply?.move_up as { kind: string }).kind, 'wallet_setup');
  // v3.1 cold read round 2: once the prompt was written, every find and score
  // gives the next step (build it, then connect GitHub here, with the link), never "Is your app's code on GitHub yet?".
  for (const r of [await find(p.ctx), await find(p.ctx), await mcpCall(p.ctx, 'score', {})]) {
    const s = rule(show(r));
    assert.match(s, /^Next: build your app in Lovable or Bolt, then connect GitHub here: https:\/\/earnkit\.com\/github\/verify\?n=\S+\nDone\?$/, s);
    assert.notEqual(s, NEXT_STEP_ASK);
    assert.deepEqual(r.reply?.move_up, { kind: 'pick_repo', project_key: null, agent_note: PICK_REPO_NOTE });
  }
  // Its yes ("done") with nothing connected: the no is cleared and the connect step given again.
  const again = await tell(p.ctx, 'pick_repo', 'yes');
  assert.match(rule(show(again), 2), STEP2_HINT);
  assert.deepEqual(again.reply?.move_up, { kind: 'pick_repo', project_key: null, agent_note: PICK_REPO_NOTE });
  assert.equal((await seen(p.id)).github_no, undefined);
  assert.equal(((await seen(p.id)).bench_ask as { kind: string }).kind, 'pick_repo');
  // v3.1 answerable replies (spec 6): the same day, the short form.
  assert.match(show(await find(p.ctx)), /Connect your app's code (?:on GitHub )?so I can match it/);
});

test('GitHub no, then no to Base: setup step 3 (v4.0, once), both nos remembered, the page keeps today\'s wording', db, async () => {
  const p = await signedIn('n');
  await find(p.ctx);
  assert.equal(show(await tell(p.ctx, 'pick_repo', 'no')), BASE_START_ASK);
  // v4.0: the no's reply is setup step 3 (once a person; "No rush." was the reply when no wallet step was due).
  const no = await tell(p.ctx, 'base_start', 'no');
  assert.ok(isStep3(rule(show(no))), show(no));
  assert.equal((no.reply?.move_up as { kind: string }).kind, 'wallet_setup');
  assert.equal(((await seen(p.id)).base_walk as { answer: string }).answer, 'no');
  for (let i = 0; i < 2; i++) {
    const r = rule(show(await find(p.ctx)));
    assert.equal(r, NEXT_STEP_ASK);
    assert.doesNotMatch(r, /Step 2|start building on Base|wallet/);
  }
  // The builder asks to connect after all (the notes' path): step 2's link again.
  const again = await tell(p.ctx, 'pick_repo', 'yes');
  assert.match(rule(show(again), 2), STEP2_HINT);
  assert.equal((await seen(p.id)).github_no, undefined);
  await tell(p.ctx, 'pick_repo', 'no');
  const pg = await pageText(p.id);
  assert.equal(pg.sub, NO_PROJECT_YET);
  assert.ok(pg.text.includes(noProjectLine('Maya Chen')));
  // The builder asks for the walk-through later: the steps.
  assert.equal(show(await tell(p.ctx, 'base_start', 'yes')), STEPS);
  assert.equal((await pageText(p.id)).sub, STARTING_ON_BASE);
});

test('the GitHub no right away (find again before answering): the walk-through once, then the resting question', db, async () => {
  const p = await signedIn('f');
  await find(p.ctx);
  assert.equal(show(await tell(p.ctx, 'pick_repo', 'no')), BASE_START_ASK);
  // The agent calls find before the builder answers: the walk-through isn't asked twice; v4.0: setup step 3 once, then rest.
  assert.ok(isStep3(rule(show(await find(p.ctx)))));
  const w = rule(show(await find(p.ctx)));
  assert.equal(w, NEXT_STEP_ASK);
  void WALLET_NOTE;
  // A late yes still gets the steps (answered by its kind).
  assert.equal(show(await tell(p.ctx, 'base_start', 'yes')), STEPS);
});

test('kindless answers route by the stored question: a no to step 2, a yes to the walk-through', db, async () => {
  const p = await signedIn('k');
  await find(p.ctx);
  const kindless = (answer: 'yes' | 'no') => mcpCall(p.ctx, 'tell', { move_up: { project_key: null, answer } });
  assert.equal(rule(show(await kindless('no'))), BASE_START_ASK);
  assert.equal(typeof (await seen(p.id)).github_no, 'string');
  assert.equal(rule(show(await kindless('yes'))), STEPS);
  assert.equal(((await seen(p.id)).base_walk as { answer: string }).answer, 'yes');
});

test('Base Builder Grants entered or hidden: no walk-through (tell matches find); a GitHub no with nothing due rests on its one question', db, async () => {
  const p = await signedIn('h');
  await walletOffered(p.id);
  await sql()`INSERT INTO projects (program_id, name, installation_id) VALUES ('base-builder-grants', 'Kit', ${p.id})`;
  await find(p.ctx);
  const no = await tell(p.ctx, 'pick_repo', 'no');
  assert.equal(rule(show(no)), NEXT_STEP_ASK);
  assert.deepEqual(no.reply?.move_up, { kind: 'next_step', project_key: null, agent_note: NEXT_STEP_NOTE });
  // Asked for anyway: "Okay.", and base_walk is never saved without the steps (the page keeps today's words).
  assert.equal(show(await tell(p.ctx, 'base_start', 'yes')), 'Okay.');
  assert.equal((await seen(p.id)).base_walk, undefined);
  assert.equal((await pageText(p.id)).sub, NO_PROJECT_YET);
  assert.equal(show(await find(p.ctx)), NEXT_STEP_ASK);
});

test('the picker refused only forks or templates: the next reply says the way out in one line, once', db, async () => {
  const p = await signedIn('t');
  const link = links(show(await find(p.ctx)))[0]!;
  const inst = Number(`63${RUN}`);
  const gh = fakeGitHub({ [`${p.login}/forked`]: { id: Number(`76${RUN}`), owner: p.login, installation: inst, fork: true, commits: [] } });
  const nonce = new URL(link).searchParams.get('n')!;
  const hash = createHash('sha256').update(nonce).digest('hex');
  await sql()`UPDATE github_verify_nonces SET login = ${p.login}, account_created_at = '2020-01-01', public_repos = 3 WHERE nonce_hash = ${hash}`;
  const res = await appSetup(new Request(`https://earnkit.com/github/verify/app?installation_id=${inst}&state=${nonce}`, {
    headers: { cookie: `${csrfCookieName(nonce)}=x` } }), { fetch: gh, limit: async () => {} });
  assert.equal(res.status, 403);
  assert.ok((await res.text()).includes(PICK_PAGE.noneCounted.split(':')[0]));
  // A new day (v3.1 answerable replies, spec 6): the connect step's full pitch again, under the notice.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'pitch_day' WHERE builder_id = ${p.id}`;
  const r = rule(show(await find(p.ctx)));
  const lines = r.split('\n');
  // v3.1 cold read: the welcome was the first reply's; this one starts with the way out.
  assert.deepEqual(lines.slice(0, 1), [TEMPLATE_NOTICE]);
  assert.match(lines[1], / pays? up to \$[\d,]+ for apps/);
  lines.splice(0, 0, '');
  assert.match(lines.slice(3).join('\n'), STEP2);
  assert.doesNotMatch(show(await find(p.ctx)), /template/, 'once');
});

test('a ranked main project with no commits in 8 weeks: one light nudge, remembered; its yes asks for the new repo', db, async () => {
  await padPool(12);
  const { ctx, key, id } = await rankedOld();
  // Fix round: never within 14 days of connecting it.
  assert.doesNotMatch(show(await mcpCall(ctx as never, 'find', {})), /Working on something new/, 'just connected');
  assert.equal((await seen(id)).new_repo_asked, undefined, 'not claimed');
  await sql()`UPDATE builder_sources SET verified_at = now() - interval '15 days' WHERE builder_id = ${id} AND kind = 'repo'`;
  const r = await mcpCall(ctx as never, 'find', {});
  const s = rule(show(r));
  // v3.1 cold read: the standing line was shown by the reply before (unchanged since), so the nudge alone.
  assert.equal(s, NEW_REPO_ASK, 'a light nudge: no money line, no points');
  assert.deepEqual(r.reply?.move_up, { kind: 'new_repo', project_key: key, agent_note: NEW_REPO_NOTE });
  const yes = await mcpCall(ctx as never, 'tell', { move_up: { kind: 'new_repo', project_key: key, answer: 'yes' } });
  assert.equal(yes.reply?.agent_note, NEW_REPO_YES_NOTE);
  assert.equal(typeof (await seen(id)).new_repo_asked, 'string');
  assert.doesNotMatch(show(await mcpCall(ctx as never, 'find', {})), /Working on something new/, 'once');
});
