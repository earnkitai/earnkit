import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { checkFitsAsked } from './fixtures/wallet-step';
import { tools } from './tools';
import { EVENT_LOG_FLAG } from './events';
import { TESTED_STARTERS } from './fixtures/fresh-build';
import { X_ON, avalanche, dropAvalanche, find, fitsFor, install, person, withEnv } from './fixtures/find';
import { INTRO_LINE, SHIP_ASK } from './bench-reply';
import { GitHubError } from './match-projects';
import { RateLimitError } from './rate-limit';
import { TWIST_QUESTION, WALLET_ASK, buildingLine, twistQuestion } from './fresh-build';
import { STARTERS } from './starters';
import { readPersonLive, rescorePerson } from './person-score';
import { safeNames } from './page-data';
import { EARN_NOTE } from './stand-text';
import { toolDescriptions } from './mcp';
import { UPDATE_LINES } from './updates';
import { rankLines } from './bench-rank';
import BenchView from '../../app/leaderboard/BenchView';
import { BENCH_TOP_EMPTY, EARN_FOOT, EARN_TITLE, leaderboardLine } from './site-copy';
import ProgramCards from '../../app/components/sections/ProgramCards';
import type { ReaderDeps } from './source-readers';
import { endsOnRankedStep } from './fixtures/ranked-step';
import { padPool } from './fixtures/rank-pool';

/**
 * v2.13.1 O5 (the second first-run audit, N1 to N16, and round 1's open F11, F15, F16, P1 to P5, P7,
 * P8, P10): the last friction and polish of onboarding, through the real tools under the Bench flag.
 */

process.env.EARNKIT_AUTH_SECRET ||= 'v2131-o5-secret';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropAvalanche();
  await sql().end();
});

const RUN = randomBytes(3).toString('hex');
let seq = 0;
const uniq = (p: string) => `${p}${RUN}${++seq}`;
const ON = { EARNKIT_URL: undefined, [EVENT_LOG_FLAG]: 'on', ...X_ON };
const on = <T>(fn: () => Promise<T>) => withEnv(ON, fn);
const NO_MATCH = { matchProjects: async () => ({ checked: 1, scored: 0, fits: [] }) };
const STARTER_ID = `o5-tip-${RUN}`;
const OWN_FRESH = { deployOn: () => true, hostOn: true, canBuild: true, starters: { [STARTER_ID]: { ...TESTED_STARTERS['arc-tipjar'], id: STARTER_ID } } };
const named = (repo: string, login = repo.split('/')[0]) => ({ agent_can_build: true, identity: { github_login: login, project: { name: repo.split('/')[1], what: 'a thing', repo } } });
const links = (t: string) => t.match(/https?:\/\/\S+/g) ?? [];
const questions = (t: string) => (t.match(/\?/g) ?? []).length;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type R = { show_to_builder: string; agent_note?: string; proof?: unknown; move_up?: { kind: string }; note?: string; kit?: unknown };

/**
 * A fake GitHub REST answer for `/repos/{key}` (default: a User's public repo, not a fork) and 404 for
 * everything else; `status` per key answers that status instead.
 */
function repoFake(meta: Record<string, Record<string, unknown>> = {}, status: Record<string, number> = {}) {
  const reads: string[] = [];
  const f = (async (u: RequestInfo | URL) => {
    const url = new URL(String(u));
    reads.push(url.pathname);
    const m = /^\/repos\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (!m) return new Response('{}', { status: 404 });
    const key = `${m[1]}/${m[2]}`.toLowerCase();
    if (status[key]) return new Response('{"message":"Not Found"}', { status: status[key] });
    return new Response(JSON.stringify({ id: 77, full_name: `${m[1]}/${m[2]}`, private: false, fork: false, is_template: false, owner: { login: m[1], type: 'User' }, ...meta[key] }), { status: 200 });
  }) as typeof fetch;
  return { f, reads };
}

// ---- N1: the first find never waits for GitHub ----------------------------------------------------

/**
 * GitHub that never answers until released (an aborted read throws, as fetch does): every call to a
 * github.com host is held; anything else goes to the guarded fetch underneath.
 */
function slowGitHub(under: typeof fetch) {
  const held: (() => void)[] = [];
  const calls: string[] = [];
  let open = false;
  let answered = 0;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!/(^|\.)github\.com$/.test(url.hostname)) return under(input, init);
    calls.push(url.pathname);
    if (!open)
      await new Promise<void>((resolve, reject) => {
        held.push(resolve);
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    answered++;
    return new Response('{"message":"Not Found"}', { status: 404 });
  }) as typeof fetch;
  return { f, calls, answered: () => answered, release: () => { open = true; for (const r of held.splice(0)) r(); } };
}

test('O5 N1 (F16) the first find and score answer in under 3 s while GitHub has not answered a single read; the reply uses what is known', dbTest, () =>
  on(async () => {
    const was = globalThis.fetch;
    const gh = slowGitHub(was);
    globalThis.fetch = gh.f;
    try {
      const id = await install();
      const key = `${uniq('vercel')}/next.js`;
      const t0 = Date.now();
      const r = await find(id, named(key));
      const ms = Date.now() - t0;
      assert.ok(ms < 3000, `the first find took ${ms} ms`);
      assert.ok(gh.calls.length > 0, 'GitHub reads were started');
      assert.equal(gh.answered(), 0, 'none had answered when the reply went out');
      // v2.14 spec 2: not counted until the App is installed (no proof branch, no GitHub read for it).
      // v2.14 T9: unsigned: not on the Bench yet, and the sign-in link is the one link (no App link: it needs a page).
      assert.equal(r.show_to_builder.split('\n')[0], INTRO_LINE, r.show_to_builder);
      assert.equal(links(r.show_to_builder).length, 1);
      assert.match(links(r.show_to_builder)[0]!, /\/signin\//);
      assert.ok(r.show_to_builder.endsWith('Done with step 1?'));
      assert.equal(r.proof, undefined);
      const t2 = Date.now();
      const r2 = await find(id, {});
      assert.ok(Date.now() - t2 < 3000, `the second find took ${Date.now() - t2} ms`);
      assert.equal(r2.show_to_builder.split('\n')[0], INTRO_LINE);
      const t1 = Date.now();
      const s = (await tools.score({}, { installationId: id } as never)) as R;
      assert.ok(Date.now() - t1 < 3000, `score took ${Date.now() - t1} ms`);
      assert.equal(s.show_to_builder.split('\n')[0], INTRO_LINE);
    } finally {
      gh.release();
      globalThis.fetch = was;
      await sleep(400);
    }
  }),
);

// ---- N2, N3, N8: a project the branch can't prove says so at once ----------------------------------

// ---- N4: the new project is read at once -------------------------------------------------------

test('O5 N4 a repo never read public stays unnamed ("Private project"); the refresh reads only the one project\'s proposed repo', dbTest, () =>
  on(async () => {
    const id = await install();
    const old = `${uniq('vercel')}/next.js`;
    const key = `${uniq('ravi')}/arc-usdc-tipjar`;
    await find(id, named(old, key.split('/')[0]), NO_MATCH);
    await find(id, named(key), NO_MATCH);
    // v2.14 spec 2: no cheap read marks it public any more (the readings or the App's install do).
    const p = await install();
    const k = `${uniq('maya')}/hidden`;
    await find(p, named(k), NO_MATCH);
    await rescorePerson(p, new Date());
    assert.equal((await safeNames([p]))(p, k), 'Private project');
    // The refresh reads the one project's proposed repo, never the replaced one.
    const asked: string[] = [];
    const reader = {
      now: new Date(),
      ghGraphql: async (_q: string, v: Record<string, unknown>) => {
        for (const [k, x] of Object.entries(v)) if (/^n\d+$/.test(k)) asked.push(`${v[`o${k.slice(1)}`]}/${x}`);
        return { data: {} };
      },
    } as unknown as ReaderDeps;
    await sql()`DELETE FROM source_live WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id = ${id})`;
    await readPersonLive(id, new Date(), { deadline: Date.now() + 5000, reader });
    assert.deepEqual(asked, [key]);
  }),
);

// ---- N5, v2.14 A16: nothing pending: one small thing to ship, never kept away ------------------------

test('O5 N5, v2.14 A16, R8: a confirmed project moves up by shipping (Task 16: the ship question and its points line), never a community round; a no never silences it', dbTest, () =>
  on(async () => {
    const key = `${uniq('gq')}/hello-world`;
    const id = await person({ main: key, claimed: uniq('gq'), projects: [{ key, name: 'Hello-World', confirmed: true }] });
    // 2026-10-22: with no fit, Base's grant steps first; a no to them brings the ship step back.
    const q = await find(id, {}, NO_MATCH);
    assert.ok(endsOnRankedStep(q.show_to_builder), q.show_to_builder);
    assert.equal(q.move_up?.kind, 'qualify');
    await tools.tell({ move_up: { kind: 'qualify', project_key: key, answer: 'no' } }, { installationId: id } as never);
    // v4.7.1 T1 (money always shows): the next find leads with the open grants and asks check_fits once; then the ship step.
    const cf = await find(id, {}, NO_MATCH);
    assert.equal(cf.move_up?.kind, 'check_fits', cf.show_to_builder);
    assert.match(cf.show_to_builder, /^Open now: /);
    // v4.7.2 T2: the needs ask is per open program; every one answered, the ship step.
    await checkFitsAsked(id);
    const r = await find(id, {}, NO_MATCH);
    assert.match(r.show_to_builder, /^Open now: /);
    // v3.1 cold read: the points line was this week's already (at most once an ISO week): the reply ends on the question.
    assert.ok(r.show_to_builder.endsWith(SHIP_ASK), r.show_to_builder);
    assert.doesNotMatch(r.show_to_builder, /community round|coin|token/i);
    assert.equal(r.move_up?.kind, 'ship');
    await tools.tell({ move_up: { kind: 'ship', project_key: key, answer: 'no' } }, { installationId: id } as never);
    // GTM W2: within 7 days of the ship question the quiet reply asks nothing; after, a no never silences it.
    const quiet = (await tools.score({}, { installationId: id } as never)) as R;
    assert.ok(!quiet.show_to_builder.includes('?'), quiet.show_to_builder);
    await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('ship_asked', (now() - interval '8 days')::text) WHERE builder_id = ${id}`;
    const s = (await tools.score({}, { installationId: id } as never)) as R;
    assert.ok(s.show_to_builder.endsWith(SHIP_ASK), s.show_to_builder);
    assert.equal(questions(s.show_to_builder.replace(/https?:\/\/\S+/g, '')), 1, 'one question');
    const y = (await tools.tell({ move_up: { kind: 'ship', project_key: key, answer: 'yes' } }, { installationId: id } as never)) as R;
    assert.match(y.agent_note ?? '', /one small thing/);
  }),
);

// ---- N6: the money line matches the build offer ----------------------------------------------------

test('O5 N6 (P5) no project: never a grant claimed for a build that can\'t enter it, never "a small app"; v2.13.3 ruling A: never the generic tip jar', dbTest, () =>
  on(async () => {
    const ava = await avalanche();
    const id = await install();
    const r = await find(id, { agent_can_build: true }, { freshDeps: OWN_FRESH });
    // v2.13.3 (2): an open program may be named with what it needs, never as an idea it pays for.
    assert.ok(!r.show_to_builder.includes(`${ava.title} pays`), r.show_to_builder);
    assert.doesNotMatch(r.show_to_builder, /a small app|tip jar/);
    // v2.14 T9: signed out: the sign-in question.
    assert.ok(r.show_to_builder.endsWith('Done with step 1?'), r.show_to_builder);
    assert.equal(r.build_offer, undefined);
    // A chat-only agent: the same rule.
    const c = await install();
    const rc = await find(c, { agent_can_build: false }, { freshDeps: { ...OWN_FRESH, canBuild: false } });
    assert.ok(!rc.show_to_builder.includes(`${ava.title} pays`), rc.show_to_builder);
  }),
);

// ---- N7, N12: the wallet question has a way out; the building line in the builder's words ----------

test('O5 N7 (F11), N12 the twist asks for a wallet with a way out (one question); the building line drops the chain and says "your"', () => {
  assert.equal(twistQuestion(false), `${TWIST_QUESTION} ${WALLET_ASK}`);
  assert.equal(questions(twistQuestion(false)), 1);
  assert.match(WALLET_ASK, /free/);
  assert.equal(buildingLine('Podcast Tips', STARTERS['arc-tipjar'], 'for my podcast listeners'), "Building Podcast Tips: a USDC tip page for your podcast listeners. I'll be back with the live link.");
});

// ---- N13, N15, P2, P8 ----------------------------------------------------------------------------

test('O5 N13 confirmed but not claimed: the last line never says "on the Bench" yet (v2.14 spec 3: never an updates yes)', dbTest, () =>
  on(async () => {
    const key = `${uniq('nc')}/hello-world`;
    // Unclaimed (v2.14 T7: no claim ask), the ask never says "on the Bench".
    const id = await person({ main: key, projects: [{ key, name: 'Hello-World', confirmed: true }] });
    const r = await find(id, {}, NO_MATCH);
    // v2.14 T9: signed out, it is not on the Bench yet (the stand line), and the question is the sign-in.
    assert.equal(r.show_to_builder.split('\n')[0], INTRO_LINE, r.show_to_builder);
    assert.doesNotMatch(r.show_to_builder, /is on the leaderboard|post what you ship/, r.show_to_builder);
    assert.equal(r.move_up?.kind, 'sign_in');
    assert.notEqual(r.move_up?.kind, 'updates');
  }),
);

test('O5 N15, v2.14: a chat-only agent with a project: not counted yet (the App proves it, not a push), and no weekly-posting ask', dbTest, () =>
  on(async () => {
    const key = `${uniq('ch')}/earny`;
    const id = await install();
    const r = await find(id, { ...named(key), agent_can_build: false }, NO_MATCH);
    assert.equal(r.show_to_builder.split('\n')[0], INTRO_LINE, r.show_to_builder);
    assert.notEqual(r.move_up?.kind, 'updates');
    assert.ok(r.show_to_builder.endsWith('Done with step 1?'), r.show_to_builder);
    assert.equal(questions(r.show_to_builder), 1);
  }),
);

test('O5 P2 (reversed in v2.13.4, v3.1 F3): the reply names the rank from RANK_MIN_POOL ranked (never "#1 of 1 builder"), in the stand line with the score (R16c), plain words; P8 the earn note only with a lead', dbTest, () =>
  on(async () => {
    const key = `${uniq('rk')}/hello-world`;
    const id = await person({ main: key, claimed: uniq('rk'), ranked: true, score: 100, projects: [{ key, name: 'Hello-World', confirmed: true }] });
    const alone = await rankLines(id, { only: [id] });
    assert.deepEqual([alone.bench, alone.line], [null, 'Shipping 100'], 'one ranked: the score alone');
    await padPool(9);
    const r = await find(id, {}, NO_MATCH);
    // Task 16: the standing line names the rank ("#N of M" under 20 ranked; "Top P%" in the top half from 20).
    // v4.7.1 T1: the standing paragraph names the rank (never "Hello-World · #1 of 10 builders").
    assert.match(r.show_to_builder, /^Score \d+ · (#\d+ of \d+ builders?|Top [\d.]+% of builders)\. /m, r.show_to_builder);
    assert.ok((r.show_to_builder.match(/https?:\/\//g) ?? []).length <= 1, 'no second link');
    assert.equal((r.show_to_builder.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length, 1, 'one question');
    assert.ok(endsOnRankedStep(r.show_to_builder), r.show_to_builder);
    assert.ok(!(r.note ?? '').includes(EARN_NOTE), r.note);
    assert.equal(r.lead, undefined);
  }),
);

// ---- N14, P3, P4: the updates replies ------------------------------------------------------------

test('O5 N14 (F15), P3, P4 the update replies carry the full page link; an older agent\'s updates { on } gets the ship log line; a change says so with the link', dbTest, () =>
  on(async () => {
    const key = `${uniq('up')}/hello-world`;
    const handle = uniq('up');
    const id = await person({ main: key, claimed: handle, projects: [{ key, name: 'Hello-World', confirmed: true }] });
    const ctx = { installationId: id } as never;
    const yes = (await tools.tell({ updates: { on: true, scheduled: true } }, ctx)) as R;
    assert.equal(yes.show_to_builder, UPDATE_LINES.auto);
    const p = (await tools.tell({ update: { text: 'Shipped a faster onboarding flow this week.' } }, ctx)) as R;
    // v3.1 one-tap posts: the first is the builder's news, their post for X (its one-tap link); a change within 24 hours
    // (the news cooldown) says so with the page link.
    assert.match(String(p.show_to_builder), new RegExp(`^Added to your page\\.\\n[\\s\\S]*Post it in one tap: https://earnkit\\.com/${handle}/post/[a-z2-7]{10}\\n`));
    const c = (await tools.tell({ update: { text: 'Shipped a faster onboarding flow and a new page.' } }, ctx)) as R;
    assert.equal(c.show_to_builder, `Updated this week's post: https://earnkit.com/${handle}`);
  }),
);

// ---- N9: what the agent says (v2.14 T7: the claim pages are gone) ---------------------------------

test('O5 N9 prepare\'s description never teaches the earnkit.txt line', () =>
  withEnv(ON, async () => {
    const bench = toolDescriptions(true, true).prepare;
    assert.doesNotMatch(bench, /earnkit\.txt|token: <code>/);
    // v3.1 (spec 3.4): prepare only drafts, so it says nothing of a token.
    assert.doesNotMatch(bench, /token/i);
    assert.ok(bench.length < 800, `${bench.length}`);
  }),
);

// ---- N16, P1, P10: the pages ---------------------------------------------------------------------

(globalThis as { React?: typeof React }).React = React;
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'");

test('O5 N16, P1, P10 the leaderboard with nobody on it says so; "1 builder"; the money heading includes investments', () => {
  assert.ok(html(React.createElement(BenchView, { rows: [], count: 0, chips: [], filter: { chain: null, weekly: false }, page: 1 })).includes(BENCH_TOP_EMPTY));
  assert.equal(BENCH_TOP_EMPTY, 'Nobody on the leaderboard yet. Add EarnKit to your agent and be first.');
  // v2.13.2 (3), v3.1: "1 builder" (v2132-followups.test.ts covers 0, 1 and many).
  assert.equal(leaderboardLine(1), '1 builder, ranked by how often they ship');
  assert.equal(leaderboardLine(2), '2 builders, ranked by how often they ship');
  // v3.1 Task 6: the landing's money heading is "Earning opportunities" (investments included), never "Grants open now".
  const cards = html(React.createElement(ProgramCards, { tiles: [] }));
  assert.ok(cards.includes(EARN_TITLE) && cards.includes(EARN_FOOT), cards);
  assert.ok(!cards.includes('Grants open now'));
});

// ---- O5 fix round 1, item 6: a late match is remembered for the next reply ---------------------------

test('O5 fix round 1: matching cut by the reply wait still lands: the next reply has the fit for a big repo (its lead)', dbTest, () =>
  on(async () => {
    const ava = await avalanche();
    const key = `${uniq('big')}/monorepo`;
    const slow = { matchProjects: async () => { await sleep(2500); return { checked: 1, scored: 1, fits: fitsFor(ava.id, key) }; } };
    const id = await install();
    const r1 = await find(id, named(key), { ...slow, proofBranchFetch: repoFake().f });
    // Task 16: a signed-out reply names no fit; the lead (the fit the agent prepares) carries it.
    assert.equal(r1.lead, undefined, 'the first reply did not wait');
    await sleep(1500);
    const r2 = await find(id, {}, { ...slow, proofBranchFetch: repoFake().f });
    assert.equal((r2.lead as { program_id?: string } | undefined)?.program_id, ava.id, JSON.stringify(r2.lead));
    await sleep(1200);
  }),
);

// ---- O5 fix round 2 --------------------------------------------------------------------------------

test('O5 fix round 2: GitHubError and RateLimitError carry their class names (every log prints err.name)', () => {
  assert.equal(new GitHubError('x', 404).name, 'GitHubError');
  assert.equal(new RateLimitError('Too many.', 60).name, 'RateLimitError');
});

