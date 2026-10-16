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
import { X_ON, avalanche, dropAvalanche, find, fitsFor, install, person, withEnv } from './fixtures/find';
import {
  GRANTS_LATER_ASK, OTHER_PROJECT_ASK, UPDATES_ASK_JOINING, benchBuildAsk, benchReply, cantSeeLine, cantShowLine, copyLine, checkingBranchLine, foreignLine, grantsAsk, needsAgentLine, shipAsk, type BenchView,
} from './bench-reply';
import { GRANTS_QUIET_MS, noGrantLine } from './bench-find';
import { GitHubError } from './match-projects';
import { RateLimitError } from './rate-limit';
import { mondayOf } from './weeks';
import { takeNews } from './stand-view';
import { BENCH_BUILD_ID, BENCH_WALLET_ASK, TWIST_QUESTION, WALLET_ASK, twistQuestion } from './fresh-build';
import { PROOF_BRANCH_NOTE, REPO_PROBE_KEEP_MS, removeNote } from './proof-branch';
import { readPersonLive, rescorePerson } from './person-score';
import { safeNames } from './page-data';
import { EARN_NOTE } from './where-you-stand';
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

process.env.EARNKIT_BUILDER_SCORE = 'on';
process.env.EARNKIT_BENCH = 'on';
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
const ON = { EARNKIT_BUILDER_SCORE: 'on', EARNKIT_BENCH: 'on', EARNKIT_URL: undefined, [EVENT_LOG_FLAG]: 'on', ...X_ON };
const on = <T>(fn: () => Promise<T>) => withEnv(ON, fn);
const NO_MATCH = { matchProjects: async () => ({ checked: 1, scored: 0, fits: [] }) };
const STARTER_ID = `o5-tip-${RUN}`;
const OWN_FRESH = { deployOn: () => true, hostOn: true, canBuild: true, starters: { [STARTER_ID]: { ...TESTED_STARTERS['arc-tipjar'], id: STARTER_ID } } };
const named = (repo: string, login = repo.split('/')[0]) => ({ agent_can_build: true, identity: { github_login: login, project: { name: repo.split('/')[1], what: 'a thing', repo } } });
const links = (t: string) => t.match(/https?:\/\/\S+/g) ?? [];
const questions = (t: string) => (t.match(/\?/g) ?? []).length;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const openCodes = (id: number) => sql()`SELECT 1 FROM proof_branches WHERE builder_id = ${id} AND used_at IS NULL AND expires_at > now()`;
const codes = (id: number) => sql()<{ repo_key: string }[]>`SELECT repo_key FROM proof_branches WHERE builder_id = ${id}`;
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
      assert.equal(r.show_to_builder.split('\n')[1], checkingBranchLine('next.js'), r.show_to_builder);
      assert.equal(links(r.show_to_builder).length, 1);
      assert.ok(r.show_to_builder.endsWith('?'));
      // O5 fix round 1: a find with an open code (its check waits on GitHub too) stays under 3 s.
      assert.ok(r.proof, 'a code is open');
      const t2 = Date.now();
      const r2 = await find(id, {});
      assert.ok(Date.now() - t2 < 3000, `the find with an open code took ${Date.now() - t2} ms`);
      assert.ok(gh.calls.some((c) => c.includes('/git/ref/heads/earnkit-')), 'the proof check started');
      assert.equal(r2.show_to_builder.split('\n')[1], checkingBranchLine('next.js'));
      const t1 = Date.now();
      const s = (await tools.score({}, { installationId: id } as never)) as R;
      assert.ok(Date.now() - t1 < 3000, `score took ${Date.now() - t1} ms`);
      assert.equal(s.show_to_builder.split('\n')[1], checkingBranchLine('next.js'));
    } finally {
      gh.release();
      globalThis.fetch = was;
      await sleep(400);
    }
  }),
);

// ---- N2, N3, N8: a project the branch can't prove says so at once ----------------------------------

test('O5 N2 a User repo under another login: no code, the plain line and a different project at once; an org repo still gets its branch', dbTest, () =>
  on(async () => {
    const key = `${uniq('torvalds')}/linux`;
    const gh = repoFake();
    const id = await install();
    const r = await find(id, named(key, uniq('octocat')), { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.equal(r.show_to_builder.split('\n')[1], foreignLine('linux'), r.show_to_builder);
    assert.ok(r.show_to_builder.endsWith(OTHER_PROJECT_ASK), r.show_to_builder);
    assert.equal(r.proof, undefined, 'no branch to push');
    assert.equal((await codes(id)).length, 0, 'no code issued');
    assert.equal(r.move_up?.kind, 'other_project');
    // An organization's repo: any member may push, so the branch is given.
    const org = `${uniq('vercel')}/next.js`;
    const o = await install();
    const og = repoFake({ [org]: { owner: { login: org.split('/')[0], type: 'Organization' } } });
    const ro = await find(o, named(org, uniq('ravi')), { ...NO_MATCH, proofBranchFetch: og.f });
    assert.equal(ro.show_to_builder.split('\n')[1], checkingBranchLine('next.js'), ro.show_to_builder);
    assert.ok(ro.proof);
    // Their own repo (the login is the owner): the branch as before.
    const own = `${uniq('maya')}/recipes`;
    const m = await install();
    const rm = await find(m, named(own), { ...NO_MATCH, proofBranchFetch: repoFake().f });
    assert.equal(rm.show_to_builder.split('\n')[1], checkingBranchLine('recipes'));
  }),
);

test('O5 N2 a repo EarnKit cannot read (404): "EarnKit can\'t see" at once, no code; GitHub slow or down: the branch as before', dbTest, () =>
  on(async () => {
    const key = `${uniq('maya')}/secret`;
    const id = await install();
    const r = await find(id, named(key), { ...NO_MATCH, proofBranchFetch: repoFake({}, { [key]: 404 }).f });
    // O5 fix round 1: a 404 is often the builder's own private repo: never the push line.
    assert.equal(r.show_to_builder.split('\n')[1], cantSeeLine('secret'), r.show_to_builder);
    assert.equal(cantSeeLine('secret'), "EarnKit can't see secret. Use a public project.");
    assert.ok(r.show_to_builder.endsWith(OTHER_PROJECT_ASK));
    assert.equal((await codes(id)).length, 0);
    const down = `${uniq('maya')}/recipes`;
    const d = await install();
    const rd = await find(d, named(down), { ...NO_MATCH, proofBranchFetch: (async () => { throw new Error('down'); }) as typeof fetch });
    assert.equal(rd.show_to_builder.split('\n')[1], checkingBranchLine('recipes'), 'unknown: the branch is still given');
  }),
);

test('O5 N2 a refused push: tell proof { pushed: false } ends the wait at once with the plain line and a different project', dbTest, () =>
  on(async () => {
    const key = `${uniq('vercel')}/next.js`;
    const org = `${uniq('vercel')}/next.js`;
    const id = await install();
    const gh = repoFake({ [key]: { owner: { login: key.split('/')[0], type: 'Organization' } }, [org]: { owner: { login: org.split('/')[0], type: 'Organization' } } });
    const r = await find(id, named(key, uniq('ravi')), { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.ok(r.proof, 'the branch was given');
    const t = (await tools.tell({ proof: { pushed: false } }, { installationId: id } as never)) as R;
    assert.equal(t.show_to_builder, '');
    assert.match(t.agent_note ?? '', /call find/i);
    const next = await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.equal(next.show_to_builder.split('\n')[1], cantShowLine('next.js'), next.show_to_builder);
    assert.ok(next.show_to_builder.endsWith(OTHER_PROJECT_ASK));
    assert.equal(next.proof, undefined);
    // Flag off: tell drops proof; no open code is ended.
    {
      const o2 = await install();
      await find(o2, named(org, uniq('ravi')), { ...NO_MATCH, proofBranchFetch: gh.f });
      assert.equal((await openCodes(o2)).length, 1);
      await withEnv({ EARNKIT_BENCH: undefined }, () => tools.tell({ proof: { pushed: false } }, { installationId: o2 } as never).catch(() => null));
      assert.equal((await openCodes(o2)).length, 1, 'flag off: proof is dropped, no code is ended');
    }
  }),
);

test('O5 fix round 1: a fork or template gets no code and the copy line; each verdict is remembered a day (no GitHub read per find); a chat agent too', dbTest, () =>
  on(async () => {
    const fork = `${uniq('maya')}/forked`;
    const gf = repoFake({ [fork]: { fork: true } });
    const f = await install();
    const rf = await find(f, named(fork), { ...NO_MATCH, proofBranchFetch: gf.f });
    assert.equal(rf.show_to_builder.split('\n')[1], copyLine('forked'), rf.show_to_builder);
    assert.equal(copyLine('forked'), 'forked is a copy of another repo. Use your own project.');
    assert.ok(rf.show_to_builder.endsWith(OTHER_PROJECT_ASK));
    assert.equal((await codes(f)).length, 0);
    const tpl = `${uniq('maya')}/tpl`;
    const t = await install();
    const rt = await find(t, named(tpl), { ...NO_MATCH, proofBranchFetch: repoFake({ [tpl]: { is_template: true } }).f });
    assert.equal(rt.show_to_builder.split('\n')[1], copyLine('tpl'));
    // Remembered: the next finds read GitHub no more.
    const reads = () => gf.reads.filter((x) => x === `/repos/${fork}`).length;
    assert.equal(reads(), 1);
    await find(f, {}, { ...NO_MATCH, proofBranchFetch: gf.f });
    assert.equal(reads(), 1, `the copy verdict is remembered: ${gf.reads.join(' ')}`);
    for (const [kind, k, extra, fake] of [
      ['foreign', `${uniq('torvalds')}/linux`, { login: uniq('octocat') }, (k: string) => repoFake()],
      ['404', `${uniq('maya')}/private`, {}, (k: string) => repoFake({}, { [k]: 404 })],
      ['needs_agent', `${uniq('maya')}/chat`, { chat: true }, () => repoFake()],
    ] as const) {
      const gh = fake(k);
      const id = await install();
      const input = { ...named(k, (extra as { login?: string }).login), ...((extra as { chat?: boolean }).chat && { agent_can_build: false }) };
      await find(id, input, { ...NO_MATCH, proofBranchFetch: gh.f });
      await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
      await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
      assert.equal(gh.reads.filter((x) => x === `/repos/${k}`).length, 1, `${kind}: one read a day`);
    }
  }),
);

test('O5 N3, N8, N10 the agent note says what to do when a find still says checking, and how to report a refused push; the plain line and the remove note', () => {
  assert.match(PROOF_BRANCH_NOTE, /If the push is refused, call tell with proof: \{ pushed: false \} and don't retry\./);
  assert.match(PROOF_BRANCH_NOTE, /If it still says it's checking, wait a minute and call find once more; never show the same reply twice\./);
  assert.equal(cantShowLine('Next.js'), "I couldn't show Next.js is yours. It needs a project you can push to.");
  assert.equal(foreignLine('linux'), "linux is under someone else's GitHub account.");
  assert.equal(removeNote('git push origin :refs/heads/earnkit-x'), "Confirmed. Delete the branch now: git push origin :refs/heads/earnkit-x. Don't show this note.");
  for (const b of ['failed', 'foreign'] as const) {
    const v: BenchView = {
      project: { key: 'a/b', name: 'b', confirmed: false, live: false, weeks: 0 }, rank: null, claimed: false, handle: null, claimLink: 'https://earnkit.com/claim/abcdefghijkl',
      fund: [], ask: { kind: 'other_project', project_key: 'a/b', line: OTHER_PROJECT_ASK }, branch: b,
    };
    assert.equal(questions(benchReply(v)), 1);
  }
});

// ---- N4: the new project is read at once -------------------------------------------------------

test('O5 N4 a switch to a public repo names it at once (never "Private project"); a private or unreadable one stays unnamed; the refresh reads only the one project\'s proposed repo', dbTest, () =>
  on(async () => {
    const id = await install();
    const old = `${uniq('vercel')}/next.js`;
    const key = `${uniq('ravi')}/arc-usdc-tipjar`;
    const gh = repoFake({ [old]: { owner: { login: old.split('/')[0], type: 'Organization' } } });
    await find(id, named(old, key.split('/')[0]), { ...NO_MATCH, proofBranchFetch: gh.f });
    await find(id, named(key), { ...NO_MATCH, proofBranchFetch: gh.f });
    await rescorePerson(id, new Date());
    assert.equal((await safeNames([id]))(id, key), 'arc-usdc-tipjar', 'read public at the switch');
    // A private repo, and one EarnKit can't read: unnamed.
    for (const [why, fake] of [
      ['private', (k: string) => repoFake({ [k]: { private: true } })],
      ['404', (k: string) => repoFake({}, { [k]: 404 })],
    ] as const) {
      const p = await install();
      const k = `${uniq('maya')}/hidden`;
      await find(p, named(k), { ...NO_MATCH, proofBranchFetch: fake(k).f });
      await rescorePerson(p, new Date());
      assert.equal((await safeNames([p]))(p, k), 'Private project', why);
    }
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

test('O5 N6 (P5) no project: never a grant the offered starter can\'t enter, never "a small app"', dbTest, () =>
  on(async () => {
    const ava = await avalanche();
    const id = await install();
    const r = await find(id, { agent_can_build: true }, { freshDeps: OWN_FRESH });
    assert.ok(!r.show_to_builder.includes(ava.title), r.show_to_builder);
    assert.doesNotMatch(r.show_to_builder, /a small app/);
    assert.ok(r.show_to_builder.endsWith(benchBuildAsk('a tip jar')), r.show_to_builder);
    assert.equal(questions(r.show_to_builder), 1);
    // A chat-only agent with the same build offer: the same rule.
    const c = await install();
    const rc = await find(c, { agent_can_build: false }, { freshDeps: { ...OWN_FRESH, canBuild: false } });
    assert.ok(!rc.show_to_builder.includes(ava.title), rc.show_to_builder);
  }),
);

// ---- N7, N12: the wallet question has a way out; the building line in the builder's words ----------

test('O5 N7 (F11), N12 the twist asks for a wallet with a way out (one question); the building line drops the chain and says "your"', dbTest, () =>
  on(async () => {
    assert.equal(twistQuestion(false), `${TWIST_QUESTION} ${WALLET_ASK}`, 'flag off: today\'s');
    assert.equal(twistQuestion(false, true), `${TWIST_QUESTION} ${BENCH_WALLET_ASK}`);
    assert.equal(questions(twistQuestion(false, true)), 1);
    assert.match(BENCH_WALLET_ASK, /free/);
    const id = await install();
    const ctx = { installationId: id, freshDeps: OWN_FRESH } as never;
    await find(id, { agent_can_build: true }, { freshDeps: OWN_FRESH });
    await tools.tell({ move_up: { kind: 'build', project_key: null, answer: 'yes' } }, ctx);
    const start = (await tools.prepare({ program_id: BENCH_BUILD_ID, build: { start: true, program_id: BENCH_BUILD_ID } }, ctx)) as R;
    assert.equal(start.show_to_builder, `${TWIST_QUESTION} ${BENCH_WALLET_ASK}`);
    const twist = (await tools.prepare({
      program_id: BENCH_BUILD_ID,
      build: {
        program_id: BENCH_BUILD_ID, twist: 'tips for my podcast listeners', name: 'Podcast Tips', description: 'USDC tips for my podcast listeners.',
        feature: 'Listeners leave a note for the next podcast episode.', for_whom: 'for my podcast listeners', wallet: `0x${'1a'.repeat(20)}`,
      },
    }, ctx)) as R;
    assert.equal(twist.show_to_builder, "Building Podcast Tips: a USDC tip page for your podcast listeners. I'll be back with the live link.");
  }),
);

// ---- N13, N15, P2, P8 ----------------------------------------------------------------------------

test('O5 N13 confirmed but not claimed: the updates yes never says "on the Bench" yet', dbTest, () =>
  on(async () => {
    const key = `${uniq('nc')}/hello-world`;
    const id = await person({ main: key, projects: [{ key, name: 'Hello-World', confirmed: true }] });
    const r = await find(id, {}, NO_MATCH);
    assert.ok(r.show_to_builder.endsWith(UPDATES_ASK_JOINING), r.show_to_builder);
  }),
);

test('O5 N15 a chat-only agent with a project: "Open <project> in your coding agent", and no weekly-posting ask it can\'t schedule', dbTest, () =>
  on(async () => {
    const key = `${uniq('ch')}/earny`;
    const id = await install();
    const r = await find(id, { ...named(key), agent_can_build: false }, NO_MATCH);
    assert.equal(r.show_to_builder.split('\n')[1], needsAgentLine('earny'), r.show_to_builder);
    assert.equal(needsAgentLine('earny'), 'Open earny in your coding agent to put it on the Bench.');
    assert.notEqual(r.move_up?.kind, 'updates');
    assert.ok(r.show_to_builder.endsWith('?'), r.show_to_builder);
    assert.equal(questions(r.show_to_builder), 1);
  }),
);

test('O5 P2 under 5 ranked the reply names no rank ("#1 of 1 builder"); P8 the earn note only with a lead', dbTest, () =>
  on(async () => {
    const key = `${uniq('rk')}/hello-world`;
    const id = await person({ main: key, claimed: uniq('rk'), ranked: true, score: 30, projects: [{ key, name: 'Hello-World', confirmed: true }] });
    assert.equal((await rankLines(id, { only: [id] })).phrase, null);
    const r = await find(id, {}, NO_MATCH);
    assert.doesNotMatch(r.show_to_builder, /#\d+ of \d+/);
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

test('O5 N9 under the Bench, prepare\'s description never teaches the earnkit.txt line; flag off, today\'s', () =>
  withEnv(ON, async () => {
    const bench = toolDescriptions(true, true).prepare;
    assert.doesNotMatch(bench, /earnkit\.txt|token: <code>/);
    assert.match(bench, /A token needs a repo proven yours; EarnKit gives you the proof step when it needs one\./);
    assert.ok(bench.length < 800, `${bench.length}`);
    await withEnv({ EARNKIT_BENCH: undefined }, async () => assert.match(toolDescriptions(true, true).prepare, /earnkit\.txt/));
  }),
);

test('O5 N11, P7 the claim page says what the Bench page is; the done page offers no GitHub sign-in under the Bench', dbTest, () =>
  withEnv({ ...ON, GITHUB_OAUTH_CLIENT_ID: 'o5-gh', GITHUB_OAUTH_CLIENT_SECRET: 'o5-gh-secret' }, async () => {
    const id = await install();
    await find(id, {}, NO_MATCH);
    const link = await claimLink(id);
    const code = link!.split('/').pop()!;
    const page = await (await claimGet(new Request(`https://earnkit.com/claim/${code}`), code)).text();
    assert.ok(page.includes(CLAIM_TEXT.benchPublic), page);
    assert.equal(CLAIM_TEXT.benchPublic, 'Your page puts your project on the Bench and shows what you ship each week, under your X name.');
    const done = await (await claimDonePage('maya_makes', id, {})).text();
    assert.ok(!done.includes(CLAIM_TEXT.github), 'no GitHub sign-in');
    assert.ok(done.includes(CLAIM_TEXT.wallet));
    await withEnv({ EARNKIT_BENCH: undefined }, async () => {
      assert.ok((await (await claimDonePage('maya_makes', id, {})).text()).includes(CLAIM_TEXT.github), 'flag off: today\'s');
    });
  }),
);

// ---- N16, P1, P10: the pages ---------------------------------------------------------------------

(globalThis as { React?: typeof React }).React = React;
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'");

test('O5 N16, P1, P10 the landing Bench with nobody on it says so; "1 builder so far"; the money heading includes investments', () => {
  assert.ok(html(React.createElement(BenchTop, { rows: [], chips: [], raising: false })).includes(BENCH_TOP_EMPTY));
  assert.equal(BENCH_TOP_EMPTY, 'Nobody on the Bench yet. Add EarnKit to your agent and be first.');
  assert.equal(benchLine(1), '1 builder so far, ranked by what they shipped and who uses it.');
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
    assert.doesNotMatch(r1.show_to_builder, /Ways to get funded/, 'the first reply did not wait');
    await sleep(1500);
    const r2 = await find(id, {}, { ...slow, proofBranchFetch: repoFake().f });
    assert.match(r2.show_to_builder, /Ways to get funded/, r2.show_to_builder);
    assert.ok(r2.show_to_builder.includes(ava.title), r2.show_to_builder);
    await sleep(1200);
  }),
);

// ---- O5 fix round 2 --------------------------------------------------------------------------------

test('O5 fix round 2: GitHubError and RateLimitError carry their class names (every log prints err.name)', () => {
  assert.equal(new GitHubError('x', 404).name, 'GitHubError');
  assert.equal(new RateLimitError('Too many.', 60).name, 'RateLimitError');
});

test('O5 fix round 2: a new repo read prunes kept reads older than a day; kept values keep their nulls through find', dbTest, () =>
  on(async () => {
    const id = await install();
    await find(id, {}, NO_MATCH);
    const old = new Date(Date.now() - REPO_PROBE_KEEP_MS - 60_000).toISOString();
    await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || ${sql().json({
      repo_probe: { 'old/gone': { kind: 'missing', at: old } },
      bench_match: { key: 'x/y', at: new Date().toISOString(), checked: 1, scored: 0, fits: [{ repo: 'y', repo_url: null, verdicts: [] }] },
    } as never)}::jsonb - 'at' WHERE builder_id = ${id}`;
    const key = `${uniq('maya')}/fresh`;
    await find(id, named(key), { ...NO_MATCH, proofBranchFetch: repoFake({ [key]: { private: null } }).f });
    const [r] = await sql()<{ probe: Record<string, Record<string, unknown>> }[]>`
      SELECT standing_seen->'repo_probe' AS probe FROM builder_profiles WHERE builder_id = ${id}`;
    assert.deepEqual(Object.keys(r.probe), [key], 'the old read is pruned');
    assert.ok('private' in r.probe[key] && r.probe[key].private === null, JSON.stringify(r.probe));
    // The kept match keeps its nulls when find records what it showed (takeNews rewrites standing_seen).
    await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || ${sql().json({
      bench_match: { key: 'x/y', at: new Date().toISOString(), checked: 1, scored: 0, fits: [{ repo: 'y', repo_url: null, verdicts: [] }] },
    } as never)}::jsonb WHERE builder_id = ${id}`;
    await takeNews(id, {}, { standing: { ranked: false, rank: 0, total: 0 }, claimed: false, handle: null, claimLink: null, projects: [] }, new Date(), false);
    const [m] = await sql()<{ match: { fits: Record<string, unknown>[] } }[]>`SELECT standing_seen->'bench_match' AS match FROM builder_profiles WHERE builder_id = ${id}`;
    assert.ok('repo_url' in m.match.fits[0] && m.match.fits[0].repo_url === null, JSON.stringify(m.match));
  }),
);

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
