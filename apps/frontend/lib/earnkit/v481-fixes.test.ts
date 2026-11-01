import './fixtures/no-network-checks';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODES_OFFER, MONEY_SAID, POINT_MORE, POINT_NEXT, SESSION_MS, bestMove, blanksAsk, closeWords, fitCell, pathReply, pointerReply, moneyInvestor, moneyLine, pickHook, submitBy, submitNoRush, submitPointer, withMoneyLine,
  type GapGrant, type InvestorProgram, type MoveCtx, type MoveProgram,
} from './conversation';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { walletOffered } from './fixtures/wallet-step';
import { converse, gateFailures, transcript } from './fixtures/converse';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';
import { isoWeekOf } from './weeks';
import { MORE_ASK, NAME_ASK, codesSettled, openMoneyNow } from './bench-find';
import { moneyText } from './pool';
import { GitHubBudgetStop, type ReaderDeps } from './source-readers';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { BUILDER_CODES_SUFFIX } from './builder-code';
import { qualifyGapSteps } from './bench-reply';

/**
 * v4.8.1 Task 1 (R1): investor programs and long shots never lead on their own. They lead only when the builder picked
 * them, is past the hook on them, or there is no grant move at all.
 */
/** The owner's dogfood, 2026-11-01 4:01 PM IST. */
const NOW = new Date('2026-11-01T10:31:00Z');
const PT = 'America/Los_Angeles';
const H = 3_600_000;
const inHours = (h: number) => new Date(NOW.getTime() + h * H).toISOString();
const prog = (o: Partial<MoveProgram> & { id: string }): MoveProgram => ({
  title: o.id, amount: '$1,000', when: 'rolling', ends_at: null, zone: 'UTC', investment: false, longShot: false, ...o,
});
/** a16z speedrun: an investor program, tagged "long shot", closing in 20 hours. */
const A16Z: InvestorProgram = {
  ...prog({ id: 'a16z-speedrun', title: 'a16z speedrun SR008', amount: 'up to $1M', when: 'closes Nov 1', ends_at: inHours(20), zone: PT, investment: true, longShot: true }),
  odds: 'speedrun says fewer than 0.4% of applicants are accepted',
};
/** Base: one step (Builder Codes), the agent can do it. */
const BASE: GapGrant = {
  ...prog({ id: 'base-builder-grants', title: 'Base Builder Grant Program', amount: 'up to $5,000' }),
  gaps: ['codes'], gap: 'EarnKit is one step away: add Builder Codes.', passed: false, doable: true,
};
/** Arc Microgrants: closing in 17 hours, a chain gap the agent can't do. */
const ARC: GapGrant = {
  ...prog({ id: 'arc', title: 'Arc Microgrants: Built with Arc Studio', amount: '500 USDC × 8 grants', when: 'closes Nov 1', ends_at: inHours(17), zone: 'America/New_York' }),
  gaps: ['on Arc mainnet'], gap: 'Arc Microgrants needs EarnKit on Arc mainnet.', passed: false, doable: false,
};
/** Circle: rolling, a chain gap. */
const CIRCLE: GapGrant = {
  ...prog({ id: 'circle-grants', title: 'Circle Developer Grants', amount: 'up to $10,000' }),
  gaps: ['on Arc'], gap: 'Circle looks for apps on Arc.', passed: false, doable: false,
};
const gap = (id: string, gaps: string[], o: Partial<GapGrant> = {}): GapGrant => ({ ...prog({ id }), gaps, gap: 'x', passed: false, doable: false, ...o });
const ctx = (o: Partial<MoveCtx> = {}): MoveCtx => ({ now: NOW, fits: [], grants: [], investors: [], skip: new Set(), raised: new Set(), path: null, ...o });
const owner = (o: Partial<MoveCtx> = {}) => ctx({ grants: [ARC, BASE, CIRCLE], investors: [A16Z], ...o });
const at = NOW.toISOString();

test("v4.8.1 R1: the owner's 2026-11-01 shape leads with Base's one step, not a16z", () => {
  assert.deepEqual(bestMove(owner()), { kind: 'one_step', program: BASE });
});

test('v4.8.1 R1: a16z picked at the hook, or past it, keeps its place', () => {
  assert.deepEqual(bestMove(owner({ path: { stage: 'hook', program_id: A16Z.id, at, picked: true } })), { kind: 'investor', program: A16Z });
  assert.deepEqual(bestMove(owner({ path: { stage: 'draft', program_id: A16Z.id, at } })), { kind: 'investor', program: A16Z });
  // A hook EarnKit chose (not picked) is ranked again: Base leads.
  assert.deepEqual(bestMove(owner({ path: { stage: 'hook', program_id: A16Z.id, at } })), { kind: 'one_step', program: BASE });
});

test('v4.8.1 R1: with no grant move at all, a16z is the move, as an investor program', () => {
  assert.deepEqual(bestMove(ctx({ investors: [A16Z] })), { kind: 'investor', program: A16Z });
  // Arc (a chain gap closing within 48 hours) is no grant move, so a16z still leads.
  assert.deepEqual(bestMove(ctx({ grants: [ARC], investors: [A16Z] })), { kind: 'investor', program: A16Z });
  // A no-gap grant closing within 48 hours is a grant move: it is the only 'now'.
  const noGap = gap('nogap', [], { ends_at: inHours(30) });
  assert.deepEqual(bestMove(ctx({ grants: [noGap], investors: [A16Z] })), { kind: 'now', program: noGap });
});

test('v4.8.1 R1: a long-shot grant never leads over a non-long-shot grant', () => {
  const longOne = gap('long-one', ['codes'], { doable: true, longShot: true, ends_at: inHours(72) });
  const two = gap('two', ['a', 'b']);
  assert.deepEqual(bestMove(ctx({ grants: [longOne, two] })), { kind: 'closest', program: two, raise: false });
  // A long-shot no-gap grant closing soon is no 'now' while a grant move exists.
  const longNow = gap('long-now', [], { longShot: true, ends_at: inHours(10) });
  assert.deepEqual(bestMove(ctx({ grants: [longNow, two] })), { kind: 'closest', program: two, raise: false });
  // Alone, within 7 days, it leads with its own kind; past 7 days it is no move on its own.
  assert.deepEqual(bestMove(ctx({ grants: [longOne] })), { kind: 'one_step', program: longOne });
  const far = { ...longOne, ends_at: inHours(24 * 20) };
  assert.deepEqual(bestMove(ctx({ grants: [far] })), { kind: 'quiet' });
  // ... unless the builder picked it.
  assert.deepEqual(bestMove(ctx({ grants: [far, two], path: { stage: 'hook', program_id: far.id, at, picked: true } })), { kind: 'one_step', program: far });
  // Step 5 is soonest first across investor programs and long-shot grants.
  assert.deepEqual(bestMove(ctx({ grants: [longOne], investors: [A16Z] })), { kind: 'investor', program: A16Z });
});

test('v4.8.1 R1: a pick of a16z on the opener still hooks a16z', () => {
  const hook = pickHook(owner(), A16Z.id);
  assert.deepEqual(hook, { move: { kind: 'investor', program: A16Z }, pick: true, steps: false });
});

test('v4.8.1 fix round 1: a picked rolling long-shot grant is hooked on the reply after connecting, beside a closer grant', () => {
  const longShot = gap('monad', ['on Monad'], { longShot: true });
  const two = gap('two', ['a', 'b']);
  assert.deepEqual(pickHook(ctx({ grants: [longShot, two] }), 'monad'), { move: { kind: 'closest', program: longShot, raise: false }, pick: true, steps: false });
  // Unpicked, it never leads: the non-long-shot grant does.
  assert.deepEqual(bestMove(ctx({ grants: [longShot, two] })), { kind: 'closest', program: two, raise: false });
});

// ---------------------------------------------------------------------------------------------------------------------
// v4.8.1 Task 2: deadlines in hours left (R2) and the money total once a session (R3).

const BAD = /\u2014|\bcoins?\b|\bpoints?\b|\p{Extended_Pictographic}/iu;
const KOLKATA = 'Asia/Kolkata';

test('v4.8.1 R2: closeWords says the time left under 48 hours, the program-zone day after', () => {
  assert.equal(closeWords(inHours(20.5), PT, NOW), 'in 20 hours');
  assert.equal(closeWords(inHours(40 / 60), PT, NOW), 'in under an hour');
  assert.equal(closeWords(inHours(1.2), PT, NOW), 'in 1 hour');
  assert.equal(closeWords(inHours(47.9), PT, NOW), 'in 47 hours');
  assert.equal(closeWords(inHours(48), PT, NOW), 'Nov 3');
  assert.equal(closeWords(inHours(5 * 24), PT, NOW), 'Nov 6');
  // Under 48 hours the words are the clock's, the same in every zone (never "tonight" in PT and "tomorrow" in IST).
  for (const h of [0.5, 1.2, 20.5, 47.5]) assert.equal(closeWords(inHours(h), PT, NOW), closeWords(inHours(h), KOLKATA, NOW));
  // Every caller still reads right with "closes" before it.
  assert.equal(`closes ${closeWords(inHours(20.5), PT, NOW)}`, 'closes in 20 hours');
});

test("v4.8.1 R2: submitBy says the program-zone day and time, and the hours left under 48 hours", () => {
  const a16z = '2026-11-02T07:59:59Z';
  // a16z's Nov 1 11:59 PM PT (PST, the clocks went back on Nov 1) from 11:30 UTC: 20 hours and 29 minutes left.
  assert.equal(submitBy(a16z, PT, new Date('2026-11-01T11:30:00Z'), 'PT'), 'Nov 1, 11:59 PM PT (in 20 hours)');
  // From 10:30 UTC it is 21 hours and 29 minutes, rounded down.
  assert.equal(submitBy(a16z, PT, new Date('2026-11-01T10:30:00Z'), 'PT'), 'Nov 1, 11:59 PM PT (in 21 hours)');
  // 48 hours or more: the day and time only; never "today" or "tomorrow".
  assert.equal(submitBy(a16z, PT, new Date('2026-10-30T19:00:00Z'), 'PT'), 'Nov 1, 11:59 PM PT');
  // A zone with no short name: the day only, and the hours left under 48 hours.
  assert.equal(submitBy(a16z, KOLKATA, new Date('2026-11-01T11:30:00Z'), null), 'Nov 2 (in 20 hours)');
  assert.equal(submitBy('2026-11-06T07:59:59Z', KOLKATA, NOW, null), 'Nov 6');
  // Fix round 1 (F5): a close already passed says no time left (never "in under an hour").
  assert.equal(submitBy(a16z, PT, new Date('2026-11-02T09:00:00Z'), 'PT'), 'Nov 1, 11:59 PM PT');
  assert.equal(closeWords(inHours(-0.5), PT, NOW), 'Nov 1');
  // Its callers: the submit pointer and the no-rush line.
  const pr = { title: 'a16z speedrun SR008', when: 'closes Nov 1', ends_at: inHours(20.5), zone: PT };
  assert.equal(submitPointer(pr, NOW), 'Your a16z speedrun SR008 application is ready to submit, closes in 20 hours. Reply "sent" once it\'s in.');
  assert.equal(submitNoRush(pr, NOW), 'No rush, it stays ready until it closes in 20 hours. Reply "sent" once it\'s in.');
  assert.equal(submitNoRush({ ...pr, ends_at: inHours(5 * 24) }, NOW), 'No rush, it stays ready until Nov 6. Reply "sent" once it\'s in.');
});

test('v4.8.1 R3: the money line, its investor clause and its place', () => {
  assert.equal(moneyLine('$115K', null, NOW), 'Open now: $115K in grants.');
  assert.equal(moneyLine('$115K', A16Z, NOW), 'Open now: $115K in grants. a16z speedrun SR008 (investor program, up to $1M) closes in 20 hours.');
  assert.equal(moneyLine('$115K', { ...A16Z, amount: null }, NOW), 'Open now: $115K in grants. a16z speedrun SR008 (investor program) closes in 20 hours.');
  // A total of 0 (moneyText null): no line.
  assert.equal(moneyLine(null, A16Z, NOW), null);
  // Fix round 1 (F5): a close already passed: no clause.
  assert.equal(moneyLine('$115K', { ...A16Z, ends_at: inHours(-1) }, NOW), 'Open now: $115K in grants.');
  // The investor: soonest first, within INVESTOR_WINDOW_MS, never skipped, never the program the reply or path is on.
  const later = { ...A16Z, id: 'later', ends_at: inHours(100) };
  const far = { ...A16Z, id: 'far', ends_at: inHours(24 * 8) };
  const none = new Set<string | null>();
  assert.equal(moneyInvestor([later, A16Z, far], NOW, new Set(), none), A16Z);
  assert.equal(moneyInvestor([later, A16Z, far], NOW, new Set([A16Z.id]), none), later);
  assert.equal(moneyInvestor([later, A16Z, far], NOW, new Set(), new Set([A16Z.id, null])), later);
  assert.equal(moneyInvestor([far], NOW, new Set(), none), null);
  assert.equal(moneyInvestor([{ ...A16Z, ends_at: inHours(-1) }], NOW, new Set(), none), null);
  // Its own paragraph just before the last one.
  assert.equal(withMoneyLine('Hook.\n\nWant the steps?', 'Open now: $1K in grants.'), 'Hook.\n\nOpen now: $1K in grants.\n\nWant the steps?');
  assert.equal(withMoneyLine('Since Thursday: x.\n\nHook.\n\nGo?', 'M.'), 'Since Thursday: x.\n\nHook.\n\nM.\n\nGo?');
  // Fix round 1 (ruling a): never above the greeting; a one-paragraph reply is split before its easy reply.
  assert.equal(withMoneyLine('Base is still your closest money. Want the steps?', 'M.'), 'Base is still your closest money.\n\nM.\n\nWant the steps?');
  const guide = "Jenil, Base Builder Grant pays up to $5,000. Add Base's Builder Code. Guide: https://docs.base.org/base-chain/builder-codes/builder-codes You're live on Base. Want me to do it now?";
  assert.equal(withMoneyLine(guide, 'M.'),
    "Jenil, Base Builder Grant pays up to $5,000. Add Base's Builder Code. Guide: https://docs.base.org/base-chain/builder-codes/builder-codes You're live on Base.\n\nM.\n\nWant me to do it now?");
  // An amount, a URL or an abbreviation never ends the easy reply early; a bare "Go?" keeps its offer.
  assert.equal(withMoneyLine('Jenil, it pays up to $5,000. Want me to start?', 'M.'), 'Jenil, it pays up to $5,000.\n\nM.\n\nWant me to start?');
  assert.equal(withMoneyLine('Hi Jenil. It is open to U.S. Builders and e.g. Teams too.', 'M.'), 'Hi Jenil.\n\nM.\n\nIt is open to U.S. Builders and e.g. Teams too.');
  assert.equal(withMoneyLine('Builder Codes are still the one step to Base. I can add Builder Codes and push the change, about 10 minutes. Go?', 'M.'),
    'Builder Codes are still the one step to Base.\n\nM.\n\nI can add Builder Codes and push the change, about 10 minutes. Go?');
  // One sentence: the line first.
  assert.equal(withMoneyLine('Want me to start?', 'M.'), 'M.\n\nWant me to start?');
  assert.equal(withMoneyLine('Hook.', null), 'Hook.');
  assert.doesNotMatch(moneyLine('$115K', A16Z, NOW)!, BAD);
});

appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v481-fixes-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await codesSettled();
  await dropRunPrograms();
  await sql().end();
});
const RUN = String(process.pid % 100000);
let n = 0;
/**
 * Fix round 1 (F4): the on-demand refresh's readers stop as a spent budget (v31-builder-codes.test.ts QUIET), which
 * person-score.ts writes nothing for and logs nothing about: no "[refresh] read failed" noise.
 */
const QUIET = new Proxy({}, {
  get: (_t, k) => (k === 'now' ? new Date() : k === 'ghSpent' ? () => true : k === 'requests' ? { tick: null } : async () => { throw new GitHubBudgetStop(); }),
}) as ReaderDeps;
/**
 * The owner-like builder (v48-conversation.test.ts owner, its own copy as each test file keeps one): X name "Jenil T",
 * project EarnKit, its repo proven by the App, live and on Base, six weeks shipping, Builder Codes passed on today, the
 * connect weeks and setup step 3 done. `pick`: the builder picked that program (the path's program at the hook).
 */
async function ownerDb(tag: string, o: { pick?: string } = {}) {
  n++;
  const t = `ek_v481_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `jf${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `481${RUN}${n}${tag.length}`, username: handle, name: 'Jenil T', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  await walletOffered(c.id);
  const key = `jf${tag}${RUN}/earnkit`;
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'earnkit', url: `https://github.com/${key}`, homepage: 'https://earnkit.com', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{ repo: 'earnkit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true, verdicts: [] }];
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, readerDeps: QUIET, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  await mcpCall(ctx, 'find', { identity: { project: { name: 'EarnKit', repo: `https://github.com/${key}`, live_url: 'https://earnkit.com' } } });
  const gid = 81000 + n * 10 + (Number(RUN) % 7);
  const gh = fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  const weeks = Array.from({ length: 6 }, (_, k) => isoWeekOf(new Date(Date.now() - k * 7 * 86_400_000)));
  await sql()`UPDATE builder_projects SET commit_weeks = ${weeks}::text[], shipped = true, kind = 'app' WHERE builder_id = ${c.id} AND lower(project_key) = lower(${key})`;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text,
      'declined', jsonb_build_object(${`qualify:${key}`}::text, now()::text)) WHERE builder_id = ${c.id}`;
  if (o.pick) await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('path', jsonb_build_object('stage', 'hook', 'program_id', ${o.pick}::text, 'at', now()::text, 'picked', true)) WHERE builder_id = ${c.id}`;
  return { ctx, id: c.id, key, handle, gh };
}

test('v4.8.1 R3: the first find of a session says "Open now: $" once, just before the easy reply; the next find does not; a new session does again', db, async () => {
  const b = await ownerDb('mny');
  const replies = await converse(b.ctx as never, [{ find: {} }, { find: {} }, { wait: SESSION_MS + 1000 }, { find: {} }], { builderId: b.id });
  const [first, second, fresh] = replies;
  const t = transcript(replies);
  const count = (s: string) => s.split('Open now: $').length - 1;
  assert.equal(count(first.show), 1, t);
  const ps = first.show.split('\n\n');
  assert.ok(ps.length >= 2, t);
  assert.match(ps.at(-2)!, /^Open now: \$[\d.,]+[KM]?\+? in grants\.( .+ \(investor program(, [^)]+)?\) closes .+\.)?$/, t);
  assert.ok(first.said.includes(MONEY_SAID), t);
  assert.equal(count(second.show), 0, t);
  assert.equal(count(fresh.show), 1, t);
  for (const r of replies) assert.doesNotMatch(r.show, BAD, t);
  assert.deepEqual(gateFailures(replies.slice(0, 2), { names: ['EarnKit', b.handle] }), [], t);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], t);
});

/** The money paragraph of a reply ("Open now: ..."), or null. */
const moneyPara = (s: string) => s.split('\n\n').find((p) => p.startsWith('Open now: ')) ?? null;
const totalOf = (s: string) => /^Open now: (\S+) in grants\./.exec(moneyPara(s) ?? '')?.[1] ?? null;

test('v4.8.1 fix round 1 (F2, ruling b): a programs answer counts as the money said; a standing answer does not', db, async () => {
  const p = await ownerDb('pga');
  const [ans, next] = await converse(p.ctx as never, [{ find: { ask: 'programs' } }, { find: {} }], { builderId: p.id });
  const tp = transcript([ans, next]);
  assert.equal(moneyPara(ans.show), null, tp);
  assert.ok(ans.said.includes(MONEY_SAID), tp);
  assert.equal(moneyPara(next.show), null, tp);
  const st = await ownerDb('sta');
  const [sAns, sNext] = await converse(st.ctx as never, [{ find: { ask: 'standing' } }, { find: {} }], { builderId: st.id });
  const ts = transcript([sAns, sNext]);
  assert.equal(moneyPara(sAns.show), null, ts);
  assert.ok(!sAns.said.includes(MONEY_SAID), ts);
  assert.ok(moneyPara(sNext.show), ts);
  // No gate run here: a direct answer opening the session carries no record fact, which the gate's proof rule flags with
  // or without the money line (the money line's gate runs are the other DB tests).
  for (const r of [ans, next, sAns, sNext]) assert.doesNotMatch(r.show, BAD, r.show);
});

test("v4.8.1 fix round 1 (F3): the total is /api/stats' figure, a program the builder hid still counted", db, async () => {
  const b = await ownerDb('hid');
  // Circle's grant, told not interested: hidden from this builder's cards, still in the site's total.
  await mcpCall(b.ctx as never, 'tell', { program_status: [{ program_id: 'circle-developer-grants', status: 'not_interested' }] });
  const [r] = await converse(b.ctx as never, [{ find: {} }], { builderId: b.id });
  const stats = moneyText(await openMoneyNow(new Date(), []));
  assert.ok(stats, 'the test database has open grants');
  assert.equal(totalOf(r.show), stats, r.show);
});

test("v4.8.1 fix round 1 (F6): the investor clause names a controlled investor program, never the reply's own", db, async () => {
  const file = committedProgram('a16z-speedrun');
  const id = `v481-${process.pid}-sr`;
  const title = `Runway Copy ${RUN}`;
  // Closing in 90 minutes: sooner than any committed investor program, so it is the one the clause names.
  const ends = new Date(Date.now() + 90 * 60_000).toISOString();
  const open = () => upsertProgram(ProgramFile.parse({ ...file, id, title, ends_at: ends, status: 'active', starts_at: null }));
  await open();
  // Base leads (no pick): the clause names the copy.
  const b = await ownerDb('ivn');
  await open();
  const [hook] = await converse(b.ctx as never, [{ find: {} }], { builderId: b.id });
  assert.doesNotMatch(hook.show.split('\n\n')[0], new RegExp(title), hook.show);
  assert.equal(moneyPara(hook.show)?.replace(/^Open now: \S+ in grants\. /, ''), `${title} (investor program, up to $1M) closes in 1 hour.`, hook.show);
  // The builder picked the copy: the reply is about it, so the clause never names it.
  const p = await ownerDb('ivp', { pick: id });
  await open();
  const [own] = await converse(p.ctx as never, [{ find: {} }], { builderId: p.id });
  assert.match(own.show, new RegExp(`^Jenil, ${title} closes in 1 hour: up to \\$1M\\.`), own.show);
  assert.ok(moneyPara(own.show), own.show);
  assert.doesNotMatch(moneyPara(own.show)!, new RegExp(title), own.show);
  assert.deepEqual(gateFailures([hook], { names: ['EarnKit', b.handle] }), [], hook.show);
  assert.deepEqual(gateFailures([own], { names: ['EarnKit', p.handle] }), [], own.show);
});

// ---------------------------------------------------------------------------------------------------------------------
// v4.8.1 Task 3: a pointer with its reason, never twice (R4), and the fit copy (R5).

const facts = (o: Partial<Parameters<typeof pointerReply>[0]> = {}): Parameters<typeof pointerReply>[0] => ({
  id: BASE.id, title: BASE.title, amount: BASE.amount, when: 'rolling', ends_at: null, zone: 'UTC', gaps: 1, stage: 'hook', drafted: false, ...o,
});

test('v4.8.1 R4: the first pointer says the money and why, then the stage\'s own easy reply', () => {
  const none = new Set<string>();
  assert.deepEqual(pointerReply(facts(), 'Go?', none, NOW), { text: 'Base Builder Grant is still your best move: up to $5,000, one step away. Go?', said: [`point:${BASE.id}`], more: false, ready: false });
  assert.equal(pointerReply(facts({ gaps: 3 }), 'Want the steps?', none, NOW).text, 'Base Builder Grant is still your best move: up to $5,000, 3 steps away. Want the steps?');
  // The draft stage, drafted: "your draft is ready" (ahead of a close), then the stage's own ask (fix round 1, minor 1:
  // the blanks ask for a draft, "sent" at submit), never "Want me to start?".
  const blanks = blanksAsk(['a note on the founding team']);
  const ready = pointerReply(facts({ gaps: 0, stage: 'draft', drafted: true, when: 'closes Nov 1', ends_at: inHours(20.5), readyAsk: blanks }), 'Want me to start?', none, NOW);
  assert.equal(ready.text, "Base Builder Grant is still your best move: up to $5,000, your draft is ready. One blank only you can fill: a note on the founding team. Reply with it and I'll finish it.");
  assert.equal(ready.ready, true);
  assert.equal(pointerReply(facts({ gaps: 0, stage: 'submit', drafted: true, readyAsk: `Reply "sent" once it's in.` }), 'Want me to start?', none, NOW).text,
    `Base Builder Grant is still your best move: up to $5,000, your draft is ready. Reply "sent" once it's in.`);
  // A dated program with nothing above: its close, in hours left.
  assert.equal(pointerReply(facts({ ...A16Z, gaps: 0, stage: 'hook' }), 'Want me to start?', none, NOW).text,
    'a16z speedrun SR008 is still your best move: up to $1M, closes in 20 hours. Want me to start?');
  // The draft stage with no draft made yet (the gap just closed) never says it is ready.
  assert.equal(pointerReply(facts({ gaps: 0, stage: 'draft', drafted: false }), 'Want me to start?', none, NOW).text, 'Base Builder Grant is still your best move: up to $5,000. Want me to start?');
  // An unknown amount is left out with its comma; no amount and no reason: the name alone.
  assert.equal(pointerReply(facts({ amount: null }), 'Go?', none, NOW).text, 'Base Builder Grant is still your best move: one step away. Go?');
  assert.equal(pointerReply(facts({ amount: null, gaps: 0 }), 'Go?', none, NOW).text, 'Base Builder Grant is still your best move. Go?');
});

test('v4.8.1 R4: the second pointer is short with the way out; the third and later offer every program', () => {
  const once = new Set([`point:${BASE.id}`]);
  assert.deepEqual(pointerReply(facts(), 'Go?', once, NOW), { text: `Still Base Builder Grant. ${POINT_NEXT}`, said: [`point2:${BASE.id}`], more: false, ready: false });
  assert.equal(POINT_NEXT, `Reply "no" and I'll line up the next program.`);
  const twice = new Set([...once, `point2:${BASE.id}`]);
  // Fix round 1 (important 2): the third is the quiet reply's MORE_ASK, flagged so the caller stores the 'more' ask.
  assert.deepEqual(pointerReply(facts(), 'Go?', twice, NOW), { text: POINT_MORE, said: [], more: true, ready: false });
  assert.equal(POINT_MORE, MORE_ASK);
  assert.equal(POINT_MORE, 'Reply "more" and I\'ll show every program open now.');
  // Keyed per program: another program's pointer starts at its first.
  assert.match(pointerReply(facts({ id: 'other', title: 'Other Grant' }), 'Go?', twice, NOW).text, /^Other Grant is still your best move/);
  // pathReply's hook said: the pointer, its parts said.
  const said = new Set([`hook:${BASE.id}`]);
  const r = pathReply({ now: NOW, first: null, project: { name: 'EarnKit', live: true }, streak: 6, move: { kind: 'one_step', program: BASE }, said });
  assert.equal(r.show_to_builder, 'Base Builder Grant is still your best move: up to $5,000, one step away. I can add Builder Codes and push the change, about 10 minutes. Go?');
  assert.deepEqual(r.said, [`point:${BASE.id}`]);
  for (const t of [r.show_to_builder, POINT_NEXT, POINT_MORE]) assert.doesNotMatch(t, BAD);
});

test('v4.8.1 R5: a chain gap says what the program looks for', () => {
  assert.equal(fitCell(false, { kind: 'chain', chain: 'Arc' }), 'Not yet: they look for apps on Arc');
});

test('v4.8.1 R4: five plain finds on the owner\'s shape: the hook, the pointer with its reason, the short pointer, then "more"; the gate passes', db, async () => {
  // The owner fixture (Builder Codes passed on today): the hook raises Base once with "You passed on them".
  const b = await ownerDb('pt5');
  const replies = await converse(b.ctx as never, Array.from({ length: 5 }, () => ({ find: {} })), { builderId: b.id });
  const t = transcript(replies);
  assert.equal(replies.length, 5, t);
  assert.match(replies[0].show, /You passed on them earlier today/, t);
  assert.ok(replies[0].hook, t);
  assert.equal(replies[1].show, 'Base Builder Grant is still your best move: up to $5,000, one step away. I can add Builder Codes and push the change, about 10 minutes. Go?', t);
  assert.equal(replies[2].show, `Still Base Builder Grant. ${POINT_NEXT}`, t);
  assert.equal(replies[3].show, POINT_MORE, t);
  // The brief's "third and later showings": the fifth is the "more" line again (its one easy reply, which the gate lets
  // repeat); the first four are all different.
  assert.equal(replies[4].show, POINT_MORE, t);
  assert.equal(new Set(replies.slice(0, 4).map((r) => r.show)).size, 4, t);
  // Only the hook raised the passed step (no second "You passed on them").
  assert.equal(replies.filter((r) => /You passed on them/.test(r.show)).length, 1, t);
  // Fix round 1 (important 2): the "more" pointer asks 'more', never the program's own step.
  for (const r of replies.slice(3)) assert.equal((r.reply?.move_up as { kind: string }).kind, 'more', t);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], t);
  for (const r of replies) assert.doesNotMatch(r.show, BAD, t);
});

test('v4.8.1 R4: a no after the short pointer parks the program and the path moves to the next one', db, async () => {
  const b = await ownerDb('ptn');
  const replies = await converse(b.ctx as never, [
    { find: {} }, { find: {} }, { find: {} },
    { says: 'no', tell: { move_up: { kind: 'qualify', project_key: b.key, answer: 'no' } } },
    { find: {} },
  ], { builderId: b.id });
  const t = transcript(replies);
  assert.equal(replies[2].show, `Still Base Builder Grant. ${POINT_NEXT}`, t);
  const next = replies.at(-1)!;
  assert.ok(next.show.trim(), t);
  assert.doesNotMatch(next.show, /Base Builder Grant/, t);
  assert.notEqual(next.reply?.lead && (next.reply.lead as { program_id?: string }).program_id, BASE.id, t);
  // Fix round 1 (minor 5): the no parked Base (its path decline stored), not only a different reply.
  const [row] = await sql()<{ d: Record<string, string> | null }[]>`SELECT standing_seen->'declined' AS d FROM builder_profiles WHERE builder_id = ${b.id}`;
  assert.ok(row.d?.[`path:${BASE.id}`], JSON.stringify(row.d));
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], t);
});

test('v4.8.1 fix round 1: "more" (or a yes) after the "more" pointer is the program list, never Builder Codes', db, async () => {
  const b = await ownerDb('ptm');
  const replies = await converse(b.ctx as never, [
    { find: {} }, { find: {} }, { find: {} }, { find: {} },
    { says: 'more', tell: { move_up: { kind: 'more', project_key: b.key, answer: 'yes' } } },
  ], { builderId: b.id });
  const t = transcript(replies);
  assert.equal(replies[3].show, POINT_MORE, t);
  assert.match(String((replies[3].reply?.move_up as { agent_note?: string }).agent_note), /call find with ask: 'programs'/, t);
  const list = replies[4].show;
  assert.match(list, /^Grants open now:/, t);
  assert.match(list, /Base Builder Grant/, t);
  assert.doesNotMatch(list, /I can add Builder Codes|push the change/, t);
  assert.notEqual((replies[4].reply?.move_up as { kind?: string } | undefined)?.kind, 'qualify', t);
  // The list answers "more", so its step is never "more" again: a program's name is the one easy reply.
  assert.ok(list.endsWith(`\n\n${NAME_ASK}`), t);
  assert.equal((replies[4].reply?.move_up as { kind?: string } | undefined)?.kind, 'name', t);
  // Nothing ran Base's step: no Builder Codes push asked or stored.
  const [row] = await sql()<{ a: { kind?: string; gap?: boolean } | null }[]>`SELECT standing_seen->'bench_ask' AS a FROM builder_profiles WHERE builder_id = ${b.id}`;
  assert.notEqual(row.a?.gap, true, JSON.stringify(row.a));
  // The agent calling find { ask: 'programs' } itself gives the list too.
  const [direct] = await converse(b.ctx as never, [{ find: { ask: 'programs' } }], { builderId: b.id });
  assert.match(direct.show, /^(Grants open now:|Same list as earlier\.)/, direct.show);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], t);
  for (const r of replies) assert.doesNotMatch(r.show, BAD, t);
});

test('v4.8.1 fix round 1 (minor 4): the closed gap\'s draft offer again is the shared pointer, then short, then "more"', db, async () => {
  const b = await ownerDb('pcl');
  // Base's steps not passed on here, so the hook offers the Builder Codes step; the agent adds them (the fake GitHub).
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'declined' WHERE builder_id = ${b.id}`;
  const addCodes = () => {
    b.gh.repos[b.key].files = { 'src/codes.ts': `export const SUFFIX = '0x046d617961000a${BUILDER_CODES_SUFFIX}'; Attribution.toDataSuffix({ codes: ['bc_earnkit'] });` };
    (b.ctx as { codesFetch?: typeof fetch }).codesFetch = b.gh;
  };
  const replies = await converse(b.ctx as never, [
    { find: {} },
    { says: 'go', before: addCodes, tell: { move_up: { kind: 'qualify', project_key: b.key, answer: 'yes' } } },
    { find: {} }, { find: {} }, { find: {} }, { find: {} },
  ], { builderId: b.id });
  const t = transcript(replies);
  const closed = replies.findIndex((r) => r.show.includes('Builder Codes are in.'));
  assert.ok(closed >= 0, t);
  const [again, short, more] = replies.slice(closed + 1);
  assert.equal(again.show, 'Base Builder Grant is still your best move: up to $5,000. Want me to start?', t);
  assert.equal((again.reply?.move_up as { kind: string }).kind, 'apply', t);
  assert.equal(short.show, `Still Base Builder Grant. ${POINT_NEXT}`, t);
  assert.equal(more.show, POINT_MORE, t);
  assert.equal((more.reply?.move_up as { kind: string }).kind, 'more', t);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], t);
});

// ---------------------------------------------------------------------------------------------------------------------
// v4.8.1 final review fixes.

test('v4.8.1 final fix (R-2): the hook offer and the gap offer name Builder Codes; the brief pointer says "one step away"', () => {
  assert.equal(CODES_OFFER, 'I can add Builder Codes and push the change, about 10 minutes. Go?');
  const move = { kind: 'one_step', program: BASE } as const;
  const hook = pathReply({ now: NOW, first: 'Jenil', project: { name: 'EarnKit', live: true }, streak: 6, move, said: new Set() });
  assert.ok(hook.show_to_builder.endsWith(`\n\n${CODES_OFFER}`), hook.show_to_builder);
  assert.doesNotMatch(hook.show_to_builder, /\badd them\b/, hook.show_to_builder);
  // Behind the money line, the offer still names its step.
  assert.doesNotMatch(withMoneyLine(hook.show_to_builder, 'Open now: $1K in grants.').split('\n\n').at(-1)!, /\bthem\b/);
  const again = pathReply({ now: NOW, first: 'Jenil', project: { name: 'EarnKit', live: true }, streak: 6, move, said: new Set(hook.said) });
  assert.equal(again.show_to_builder, `Base Builder Grant is still your best move: up to $5,000, one step away. ${CODES_OFFER}`);
  const brief = pathReply({ now: NOW, first: 'Jenil', project: { name: 'EarnKit', live: true }, streak: 6, move, said: new Set(), brief: true });
  assert.equal(brief.show_to_builder, `Base Builder Grant is one step away. ${CODES_OFFER}`);
  assert.equal(qualifyGapSteps(['codes'])[0].offer, 'I can add Builder Codes and push the change, about 10 minutes.');
});
