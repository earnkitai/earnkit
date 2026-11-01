import './fixtures/no-network-checks';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  MONEY_SAID, SESSION_MS, bestMove, closeWords, moneyInvestor, moneyLine, pickHook, submitBy, submitNoRush, submitPointer, withMoneyLine,
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
import { codesSettled } from './bench-find';

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
  // The investor: soonest first, within INVESTOR_WINDOW_MS, never skipped, never the program the reply or path is on.
  const later = { ...A16Z, id: 'later', ends_at: inHours(100) };
  const far = { ...A16Z, id: 'far', ends_at: inHours(24 * 8) };
  const none = new Set<string | null>();
  assert.equal(moneyInvestor([later, A16Z, far], NOW, new Set(), none), A16Z);
  assert.equal(moneyInvestor([later, A16Z, far], NOW, new Set([A16Z.id]), none), later);
  assert.equal(moneyInvestor([later, A16Z, far], NOW, new Set(), new Set([A16Z.id, null])), later);
  assert.equal(moneyInvestor([far], NOW, new Set(), none), null);
  assert.equal(moneyInvestor([{ ...A16Z, ends_at: inHours(-1) }], NOW, new Set(), none), null);
  // Its own paragraph just before the last one; first in a one-paragraph reply.
  assert.equal(withMoneyLine('Hook.\n\nWant the steps?', 'Open now: $1K in grants.'), 'Hook.\n\nOpen now: $1K in grants.\n\nWant the steps?');
  assert.equal(withMoneyLine('Since Thursday: x.\n\nHook.\n\nGo?', 'M.'), 'Since Thursday: x.\n\nHook.\n\nM.\n\nGo?');
  assert.equal(withMoneyLine('Base is still your closest money. Want the steps?', 'M.'), 'M.\n\nBase is still your closest money. Want the steps?');
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
  await sql().end();
});
const RUN = String(process.pid % 100000);
let n = 0;
/**
 * The owner-like builder (v48-conversation.test.ts owner, its own copy as each test file keeps one): X name "Jenil T",
 * project EarnKit, its repo proven by the App, live and on Base, six weeks shipping, Builder Codes passed on today, the
 * connect weeks and setup step 3 done.
 */
async function ownerDb(tag: string) {
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
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  await mcpCall(ctx, 'find', { identity: { project: { name: 'EarnKit', repo: `https://github.com/${key}`, live_url: 'https://earnkit.com' } } });
  const gid = 81000 + n * 10 + (Number(RUN) % 7);
  const gh = fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  const weeks = Array.from({ length: 6 }, (_, k) => isoWeekOf(new Date(Date.now() - k * 7 * 86_400_000)));
  await sql()`UPDATE builder_projects SET commit_weeks = ${weeks}::text[], shipped = true, kind = 'app' WHERE builder_id = ${c.id} AND lower(project_key) = lower(${key})`;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text,
      'declined', jsonb_build_object(${`qualify:${key}`}::text, now()::text)) WHERE builder_id = ${c.id}`;
  return { ctx, id: c.id, key, handle };
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
