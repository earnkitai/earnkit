import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { tools } from './tools';
import { EVENT_LOG_FLAG } from './events';
import { TESTED_STARTERS } from './fixtures/fresh-build';
import { X_ON, avalanche, claimX, dropAvalanche, find, fitsFor, install, person, withEnv } from './fixtures/find';
import {
  GRANTS_LATER_ASK, claimQuestion, START_ASK, UPDATES_ASK_JOINING, grantsAsk, privateLine, shipAsk,
} from './bench-reply';
import { GRANTS_QUIET_MS, noGrantLine } from './bench-find';
import { GitHubError } from './match-projects';
import { RateLimitError } from './rate-limit';
import { mondayOf } from './weeks';
import { TWIST_QUESTION, WALLET_ASK, buildingLine, twistQuestion } from './fresh-build';
import { STARTERS } from './starters';
import { readPersonLive, rescorePerson } from './person-score';
import { safeNames } from './page-data';
import { EARN_NOTE } from './stand-text';
import { toolDescriptions } from './mcp';
import { CLAIM_TEXT, claimDonePage, claimGet, claimLink } from './claim';
import { UPDATE_LINES } from './updates';
import { rankLines } from './bench-rank';
import { benchLine } from '../../app/bench/BenchView';
import BenchTop, { BENCH_TOP_EMPTY } from '../../app/components/sections/BenchTop';
import ProgramCards from '../../app/components/sections/ProgramCards';
import type { ReaderDeps } from './source-readers';

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
      assert.equal(r.show_to_builder.split('\n')[1], privateLine('Next.js'), r.show_to_builder);
      assert.equal(links(r.show_to_builder).length, 1);
      assert.ok(r.show_to_builder.endsWith('?'));
      assert.equal(r.proof, undefined);
      const t2 = Date.now();
      const r2 = await find(id, {});
      assert.ok(Date.now() - t2 < 3000, `the second find took ${Date.now() - t2} ms`);
      assert.equal(r2.show_to_builder.split('\n')[1], privateLine('Next.js'));
      const t1 = Date.now();
      const s = (await tools.score({}, { installationId: id } as never)) as R;
      assert.ok(Date.now() - t1 < 3000, `score took ${Date.now() - t1} ms`);
      assert.equal(s.show_to_builder.split('\n')[1], privateLine('Next.js'));
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

// ---- N5: a grants yes that finds nothing ---------------------------------------------------------

test('O5 N5 a grants yes that finds nothing: the next reply asks the next step, not grants, for 7 days; then grants again', dbTest, () =>
  on(async () => {
    const key = `${uniq('gq')}/hello-world`;
    const id = await person({ main: key, claimed: uniq('gq'), seen: { declined: { [`updates:${key}`]: new Date().toISOString() } }, projects: [{ key, name: 'Hello-World', confirmed: true }] });
    const r = await find(id, {}, NO_MATCH);
    assert.ok(r.show_to_builder.endsWith(grantsAsk('Hello-World')), r.show_to_builder);
    const g = (await tools.tell({ move_up: { kind: 'grants', project_key: key, answer: 'yes' } }, { installationId: id } as never)) as R;
    // O5 fix round 1 (ruling): a tell reply the builder sees ends on one question too: the next ask.
    assert.equal(g.show_to_builder, `${noGrantLine('Hello-World')}\n${shipAsk('Hello-World')}`);
    assert.equal(questions(g.show_to_builder), 1);
    assert.equal(g.move_up?.kind, 'suggest');
    // The quiet survives find's own bookkeeping of what the builder was shown (takeNews).
    for (let i = 0; i < 2; i++) assert.ok((await find(id, {}, NO_MATCH)).show_to_builder.endsWith(shipAsk('Hello-World')), `find ${i}`);
    const s = (await tools.score({}, { installationId: id } as never)) as R;
    assert.ok(s.show_to_builder.endsWith(shipAsk('Hello-World')), s.show_to_builder);
    assert.equal(questions(s.show_to_builder), 1);
    const y = (await tools.tell({ move_up: { kind: 'suggest', project_key: key, answer: 'yes' } }, { installationId: id } as never)) as R;
    assert.match(y.agent_note ?? '', /one small thing/);
    await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, ${['quiet', `grants:${key}`]}::text[], to_jsonb(${new Date(Date.now() - GRANTS_QUIET_MS - 1000).toISOString()}::text)) WHERE builder_id = ${id}`;
    assert.ok((await find(id, {}, NO_MATCH)).show_to_builder.endsWith(grantsAsk('Hello-World')), 'after 7 days');
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
    // v2.13.4 (spec 2): X first; once claimed, existing work.
    assert.ok(r.show_to_builder.endsWith(claimQuestion(null)), r.show_to_builder);
    await claimX(id);
    const r1 = await find(id, { agent_can_build: true }, { freshDeps: OWN_FRESH });
    assert.ok(r1.show_to_builder.endsWith(START_ASK), r1.show_to_builder);
    assert.equal(r1.build_offer, undefined);
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

test('O5 N13 confirmed but not claimed: the updates yes never says "on the Bench" yet', dbTest, () =>
  on(async () => {
    const key = `${uniq('nc')}/hello-world`;
    // v2.13.4: unclaimed, the claim is the ask; with it declined, the next ask still never says "on the Bench".
    const id = await person({ main: key, seen: { declined: { 'claim:*': new Date().toISOString() } }, projects: [{ key, name: 'Hello-World', confirmed: true }] });
    const r = await find(id, {}, NO_MATCH);
    assert.ok(r.show_to_builder.endsWith(UPDATES_ASK_JOINING), r.show_to_builder);
  }),
);

test('O5 N15, v2.14: a chat-only agent with a project: not counted yet (the App proves it, not a push), and no weekly-posting ask', dbTest, () =>
  on(async () => {
    const key = `${uniq('ch')}/earny`;
    const id = await install();
    const r = await find(id, { ...named(key), agent_can_build: false }, NO_MATCH);
    assert.equal(r.show_to_builder.split('\n')[1], privateLine('Earny'), r.show_to_builder);
    assert.notEqual(r.move_up?.kind, 'updates');
    assert.ok(r.show_to_builder.endsWith('?'), r.show_to_builder);
    assert.equal(questions(r.show_to_builder), 1);
  }),
);

test('O5 P2 (reversed in v2.13.4): the reply names the Bench rank from 1 ranked ("#1 of 1 builder"), in the stand line, plain words; P8 the earn note only with a lead', dbTest, () =>
  on(async () => {
    const key = `${uniq('rk')}/hello-world`;
    const id = await person({ main: key, claimed: uniq('rk'), ranked: true, score: 100, projects: [{ key, name: 'Hello-World', confirmed: true }] });
    assert.equal((await rankLines(id, { only: [id] })).phrase, '#1 of 1 builder');
    const r = await find(id, {}, NO_MATCH);
    // The stand line carries the rank (the spec's rule: "#N of M" under 20 ranked, top half; "Top P%" from 20).
    assert.match(r.show_to_builder, /^Hello-World is on the Bench: (#1 of \d+ builders?|top [\d.]+% of builders)\.$/m, r.show_to_builder);
    assert.equal((r.show_to_builder.match(/https?:\/\//g) ?? []).length, 1, 'no second link');
    assert.equal((r.show_to_builder.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length, 1, 'no second question');
    assert.ok(!(r.note ?? '').includes(EARN_NOTE), r.note);
    assert.equal(r.lead, undefined);
  }),
);

// ---- N14, P3, P4: the updates replies ------------------------------------------------------------

test('O5 N14 (F15), P3, P4 the update replies carry the full page link; the scheduled call shows nothing new; a change says so with the link', dbTest, () =>
  on(async () => {
    const key = `${uniq('up')}/hello-world`;
    const handle = uniq('up');
    const id = await person({ main: key, claimed: handle, projects: [{ key, name: 'Hello-World', confirmed: true }] });
    const ctx = { installationId: id } as never;
    const yes = (await tools.tell({ updates: { on: true } }, ctx)) as R;
    assert.equal(yes.show_to_builder, UPDATE_LINES.on);
    const again = (await tools.tell({ updates: { on: true, scheduled: true } }, ctx)) as R;
    assert.equal(again.show_to_builder, '', 'said once');
    const p = (await tools.tell({ update: { text: 'Shipped a faster onboarding flow this week.' } }, ctx)) as R;
    assert.equal(p.show_to_builder, `Posted this week's update: https://earnkit.com/${handle}`);
    const c = (await tools.tell({ update: { text: 'Shipped a faster onboarding flow and a new page.' } }, ctx)) as R;
    assert.equal(c.show_to_builder, `Updated this week's post: https://earnkit.com/${handle}`);
  }),
);

// ---- N9, N11, P7: what the agent and the claim pages say ---------------------------------------------

test('O5 N9 prepare\'s description never teaches the earnkit.txt line', () =>
  withEnv(ON, async () => {
    const bench = toolDescriptions(true, true).prepare;
    assert.doesNotMatch(bench, /earnkit\.txt|token: <code>/);
    assert.match(bench, /A token needs a repo proven yours; EarnKit gives you the install link when it needs one\./);
    assert.ok(bench.length < 800, `${bench.length}`);
  }),
);

test('O5 N11, P7 the claim page says what the Bench page is; the done page offers no GitHub sign-in under the Bench', dbTest, () =>
  withEnv({ ...ON, GITHUB_OAUTH_CLIENT_ID: 'o5-gh', GITHUB_OAUTH_CLIENT_SECRET: 'o5-gh-secret' }, async () => {
    const id = await install();
    await find(id, {}, NO_MATCH);
    const link = await claimLink(id);
    const code = link!.split('/').pop()!;
    const page = await (await claimGet(new Request(`https://earnkit.com/claim/${code}`), code)).text();
    assert.ok(page.includes(CLAIM_TEXT.public), page);
    assert.equal(CLAIM_TEXT.public, 'Your page puts your project on the Bench and shows what you ship each week, under your X name.');
    const done = await (await claimDonePage('maya_makes', id, {})).text();
    assert.ok(!done.includes('Sign in with GitHub'), 'no GitHub sign-in');
    assert.ok(done.includes(CLAIM_TEXT.wallet));
  }),
);

// ---- N16, P1, P10: the pages ---------------------------------------------------------------------

(globalThis as { React?: typeof React }).React = React;
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'");

test('O5 N16, P1, P10 the landing Bench with nobody on it says so; "1 builder who ships"; the money heading includes investments', () => {
  assert.ok(html(React.createElement(BenchTop, { rows: [], chips: [], raising: false })).includes(BENCH_TOP_EMPTY));
  assert.equal(BENCH_TOP_EMPTY, 'Nobody on the Bench yet. Add EarnKit to your agent and be first.');
  // v2.13.2 (3): "1 builder who ships" (v2132-followups.test.ts covers 0, 1 and many).
  assert.equal(benchLine(1), '1 builder who ships, ranked by what they shipped and who uses it.');
  assert.equal(benchLine(2), '2 builders who ship, ranked by what they shipped and who uses it.');
  const cards = html(React.createElement(ProgramCards, { tiles: [], bench: true }));
  assert.ok(cards.includes('Money open now'), cards);
  assert.ok(!cards.includes('Grants open now'));
});

// ---- O5 fix round 1, item 6: a late match is remembered for the next reply ---------------------------

test('O5 fix round 1: matching cut by the reply wait still lands: the next reply shows Ways to get funded for a big repo', dbTest, () =>
  on(async () => {
    const ava = await avalanche();
    const key = `${uniq('big')}/monorepo`;
    const slow = { matchProjects: async () => { await sleep(2500); return { checked: 1, scored: 1, fits: fitsFor(ava.id, key) }; } };
    const id = await install();
    const r1 = await find(id, named(key), { ...slow, proofBranchFetch: repoFake().f });
    // v2.13.3 (2): the money section always shows; the first reply just has no fit yet.
    assert.doesNotMatch(r1.show_to_builder, /and fits Monorepo/, 'the first reply did not wait');
    await sleep(1500);
    const r2 = await find(id, {}, { ...slow, proofBranchFetch: repoFake().f });
    assert.match(r2.show_to_builder, /Ways to get funded/, r2.show_to_builder);
    assert.ok(r2.show_to_builder.includes(`${ava.title} pays up to $10K and fits Monorepo`), r2.show_to_builder);
    await sleep(1200);
  }),
);

// ---- O5 fix round 2 --------------------------------------------------------------------------------

test('O5 fix round 2: GitHubError and RateLimitError carry their class names (every log prints err.name)', () => {
  assert.equal(new GitHubError('x', 404).name, 'GitHubError');
  assert.equal(new RateLimitError('Too many.', 60).name, 'RateLimitError');
});

test('O5 fix round 2: a grants yes that finds nothing always ends on a question: posting, the week\'s post, else "check again next week" (its yes keeps grants quiet)', dbTest, () =>
  on(async () => {
    const key = `${uniq('gl')}/hello-world`;
    const now = new Date().toISOString();
    const id = await person({ main: key, claimed: uniq('gl'), seen: { declined: { [`suggest:${key}`]: now } }, projects: [{ key, name: 'Hello-World', confirmed: true }] });
    await sql()`UPDATE builder_profiles SET updates_on_at = now(), updates_scheduled_at = now() WHERE builder_id = ${id}`;
    await sql()`INSERT INTO project_updates (builder_id, project_key, week, text, facts) VALUES (${id}, ${key}, ${mondayOf(new Date())}, 'Shipped it.', '{}'::jsonb)`;
    const r = await find(id, {}, NO_MATCH);
    assert.ok(r.show_to_builder.endsWith(grantsAsk('Hello-World')), r.show_to_builder);
    const g = (await tools.tell({ move_up: { kind: 'grants', project_key: key, answer: 'yes' } }, { installationId: id } as never)) as R;
    assert.equal(g.show_to_builder, `${noGrantLine('Hello-World')}\n${GRANTS_LATER_ASK}`);
    assert.equal(GRANTS_LATER_ASK, 'Want me to check again for grants next week?');
    assert.equal(g.move_up?.kind, 'grants_later');
    const y = (await tools.tell({ move_up: { kind: 'grants_later', project_key: key, answer: 'yes' } }, { installationId: id } as never)) as R;
    assert.ok(y.show_to_builder.length > 0);
    const [q] = await sql()<{ at: string | null }[]>`SELECT standing_seen->'quiet'->>${`grants:${key}`} AS at FROM builder_profiles WHERE builder_id = ${id}`;
    assert.ok(q.at && Date.now() - Date.parse(q.at) < 60_000, 'the quiet window is set');
    // Posting off (declined suggest, nothing else): the weekly-posting ask.
    const k2 = `${uniq('gl')}/two`;
    const p2 = await person({ main: k2, claimed: uniq('gm'), seen: { declined: { [`suggest:${k2}`]: now, [`updates:${k2}`]: now } }, projects: [{ key: k2, name: 'Two', confirmed: true }] });
    await find(p2, {}, NO_MATCH);
    const g2 = (await tools.tell({ move_up: { kind: 'grants', project_key: k2, answer: 'yes' } }, { installationId: p2 } as never)) as R;
    assert.equal(questions(g2.show_to_builder), 1, g2.show_to_builder);
  }),
);
