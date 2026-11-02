import './fixtures/no-network-checks';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODES_OFFER, MONEY_SAID, POINT_MORE, gapStillReply, SESSION_MS, bestMove, blanksAsk, closeWords, fitCell, pathReply, pointerReply, closingSoon, moneyLine, pickHook, submitBy, submitNoRush, submitPointer, withMoneyLine,
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
import { HELP_DONE_ASK } from './conversation';
import { READY_SET, helpDoneTail, MORE_ASK, NAME_ASK, alsoOpen, pathDrafted, readyStored, codesSettled, openMoneyNow, openNowInvestment, openerPrograms } from './bench-find';
import { moneyText } from './pool';
import { GitHubBudgetStop, type ReaderDeps } from './source-readers';
import { committedProgram } from './fixtures/program-file';
import { dropPrograms, dropRunPrograms } from './fixtures/programs-cleanup';
import { ProgramFile } from './program-file';
import { listPrograms, upsertProgram } from './programs';
import { cardSubmitBy, hoursLeft } from './deadline';
import { fundWhen } from './stand-view';
import { nextDeadline, standingParagraph } from './standing';
import { closesWhen, closingNudge } from './nudges';
import { deadlineLine } from './alerts';
import { alertBody } from './alert-mail';
import { digestBody, moneyTexts } from './digest';
import { programUpdates, type Card } from './present';
import { BUILDER_CODES_SUFFIX } from './builder-code';
import { qualifyGapSteps } from './bench-reply';

// v4.10 Task 4: this file pins the v4.8 path, which still answers a 0-program ready set, a builder mid-path and every
// later reply; the ready set that now opens a fresh session is v410-find.test.ts's (bench-find.ts READY_SET).
READY_SET.on = false;

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

test('v4.8.1 R3: the money line, its closing clause and its place', () => {
  // v4.8.2 Task 2: the investor clause became "Closing soon" (any category, within 48 hours, at most 2).
  assert.equal(moneyLine('$115K', [], NOW), 'Open now: $115K in grants.');
  assert.equal(moneyLine('$115K', [A16Z], NOW), 'Open now: $115K in grants. Closing soon: a16z speedrun SR008 (investor program, up to $1M, in 20 hours).');
  assert.equal(moneyLine('$115K', [{ ...A16Z, amount: null }], NOW), 'Open now: $115K in grants. Closing soon: a16z speedrun SR008 (investor program, in 20 hours).');
  // A total of 0 (moneyText null): the closing sentence only; with nothing closing, no line.
  assert.equal(moneyLine(null, [A16Z], NOW), 'Closing soon: a16z speedrun SR008 (investor program, up to $1M, in 20 hours).');
  assert.equal(moneyLine(null, [], NOW), null);
  // Fix round 1 (F5): a close already passed: no clause.
  assert.equal(moneyLine('$115K', [{ ...A16Z, ends_at: inHours(-1) }], NOW), 'Open now: $115K in grants.');
  // Soonest first, within CLOSING_SOON_MS (48 hours), never skipped, never the program the reply or path is on.
  const later = { ...A16Z, id: 'later', title: 'Later Runway', ends_at: inHours(40) };
  const far = { ...A16Z, id: 'far', ends_at: inHours(50) };
  const none = new Set<string | null>();
  assert.deepEqual(closingSoon([later, A16Z, far], NOW, new Set(), none), [A16Z, later]);
  assert.deepEqual(closingSoon([later, A16Z, far], NOW, new Set([A16Z.id]), none), [later]);
  assert.deepEqual(closingSoon([later, A16Z, far], NOW, new Set(), new Set([A16Z.id, null])), [later]);
  assert.deepEqual(closingSoon([far], NOW, new Set(), none), []);
  assert.deepEqual(closingSoon([{ ...A16Z, ends_at: inHours(-1) }], NOW, new Set(), none), []);
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
  assert.doesNotMatch(moneyLine('$115K', [A16Z], NOW)!, BAD);
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
  assert.match(ps.at(-2)!, /^Open now: \$[\d.,]+[KM]?\+? in grants\.( Closing soon: [^()]+ \([^)]*in (\d+ hours?|under an hour)\)( and [^()]+ \([^)]*in (\d+ hours?|under an hour)\))?\.)?$/, t);
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
  // v4.8.2 Task 2: the copy closes soonest, so "Closing soon" names it first (a second program may follow).
  assert.ok(moneyPara(hook.show)?.replace(/^Open now: \S+ in grants\. /, '').startsWith(`Closing soon: ${title} (investor program, up to $1M, in 1 hour)`), hook.show);
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
  assert.deepEqual(pointerReply(facts(), 'Go?', none, NOW), { text: 'Base Builder Grant is still your best move: up to $5,000, one step away. Go?', said: [`point:${BASE.id}`], more: false, ready: false, again: false });
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

test('v4.8.1 R4 (v4.8.2 R1): the second and later pointers offer every program', () => {
  const twice = new Set([`point:${BASE.id}`]);
  // Fix round 1 (important 2), v4.8.2 R1: the second is the quiet reply's MORE_ASK (no short "Reply no" pointer),
  // flagged so the caller stores the 'more' ask.
  assert.deepEqual(pointerReply(facts(), 'Go?', twice, NOW), { text: POINT_MORE, said: [`more:${BASE.id}`], more: true, ready: false, again: false });
  assert.equal(POINT_MORE, MORE_ASK);
  assert.equal(POINT_MORE, 'Reply "more" and I\'ll show every program open now.');
  // Keyed per program: another program's pointer starts at its first.
  assert.match(pointerReply(facts({ id: 'other', title: 'Other Grant' }), 'Go?', twice, NOW).text, /^Other Grant is still your best move/);
  // pathReply's hook said: the pointer, its parts said.
  const said = new Set([`hook:${BASE.id}`]);
  const r = pathReply({ now: NOW, first: null, project: { name: 'EarnKit', live: true }, streak: 6, move: { kind: 'one_step', program: BASE }, said });
  assert.equal(r.show_to_builder, 'Base Builder Grant is still your best move: up to $5,000, one step away. I can add Builder Codes and push the change, about 10 minutes. Go?');
  assert.deepEqual(r.said, [`point:${BASE.id}`]);
  for (const t of [r.show_to_builder, POINT_MORE]) assert.doesNotMatch(t, BAD);
});

test('v4.8.1 R5: a chain gap says what the program looks for', () => {
  assert.equal(fitCell(false, { kind: 'chain', chain: 'Arc' }), 'Not yet: they look for apps on Arc');
});

test('v4.8.1 R4 (v4.8.2 R1): five plain finds on the owner\'s shape: the hook, the pointer with its reason, then "more"; the gate passes', db, async () => {
  // The owner fixture (Builder Codes passed on today): the hook raises Base once with "Builder Codes are now the only gap".
  const b = await ownerDb('pt5');
  const replies = await converse(b.ctx as never, Array.from({ length: 5 }, () => ({ find: {} })), { builderId: b.id });
  const t = transcript(replies);
  assert.equal(replies.length, 5, t);
  assert.match(replies[0].show, /That's now the only gap to that money/, t);
  assert.ok(replies[0].hook, t);
  assert.equal(replies[1].show, 'Base Builder Grant is still your best move: up to $5,000, one step away. I can add Builder Codes and push the change, about 10 minutes. Go?', t);
  // v4.8.2 R1: the third and later are the "more" line (its one easy reply, which the gate lets repeat); the first
  // three are all different.
  for (const r of replies.slice(2)) assert.equal(r.show, POINT_MORE, t);
  assert.equal(new Set(replies.slice(0, 3).map((r) => r.show)).size, 3, t);
  // Only the hook raised the passed step.
  assert.equal(replies.filter((r) => /now the only gap to that money/.test(r.show)).length, 1, t);
  // Fix round 1 (important 2): the "more" pointer asks 'more', never the program's own step.
  for (const r of replies.slice(2)) assert.equal((r.reply?.move_up as { kind: string }).kind, 'more', t);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], t);
  for (const r of replies) assert.doesNotMatch(r.show, BAD, t);
});

test('v4.8.1 R4 (v4.8.2 R1): a no after the reasoned pointer parks the program and the path moves to the next one', db, async () => {
  const b = await ownerDb('ptn');
  const replies = await converse(b.ctx as never, [
    { find: {} }, { find: {} },
    { says: 'no', tell: { move_up: { kind: 'qualify', project_key: b.key, answer: 'no' } } },
    { find: {} },
  ], { builderId: b.id });
  const t = transcript(replies);
  assert.match(replies[1].show, /^Base Builder Grant is still your best move/, t);
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
    { find: {} }, { find: {} }, { find: {} },
    { says: 'more', tell: { move_up: { kind: 'more', project_key: b.key, answer: 'yes' } } },
  ], { builderId: b.id });
  const t = transcript(replies);
  assert.equal(replies[2].show, POINT_MORE, t);
  assert.match(String((replies[2].reply?.move_up as { agent_note?: string }).agent_note), /call find with ask: 'programs'/, t);
  const list = replies[3].show;
  assert.match(list, /^Grants open now:/, t);
  assert.match(list, /Base Builder Grant/, t);
  assert.doesNotMatch(list, /I can add Builder Codes|push the change/, t);
  assert.notEqual((replies[3].reply?.move_up as { kind?: string } | undefined)?.kind, 'qualify', t);
  // The list answers "more", so its step is never "more" again: a program's name is the one easy reply.
  assert.ok(list.endsWith(`\n\n${NAME_ASK}`), t);
  assert.equal((replies[3].reply?.move_up as { kind?: string } | undefined)?.kind, 'name', t);
  // Nothing ran Base's step: no Builder Codes push asked or stored.
  const [row] = await sql()<{ a: { kind?: string; gap?: boolean } | null }[]>`SELECT standing_seen->'bench_ask' AS a FROM builder_profiles WHERE builder_id = ${b.id}`;
  assert.notEqual(row.a?.gap, true, JSON.stringify(row.a));
  // The agent calling find { ask: 'programs' } itself gives the list too.
  const [direct] = await converse(b.ctx as never, [{ find: { ask: 'programs' } }], { builderId: b.id });
  assert.match(direct.show, /^(Grants open now:|Same list as earlier\.)/, direct.show);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], t);
  for (const r of replies) assert.doesNotMatch(r.show, BAD, t);
});

test('v4.8.1 fix round 1 (minor 4): the closed gap\'s draft offer again is the shared pointer, then "more"', db, async () => {
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
    { find: {} }, { find: {} }, { find: {} },
  ], { builderId: b.id });
  const t = transcript(replies);
  const closed = replies.findIndex((r) => r.show.includes('Builder Codes are in.'));
  assert.ok(closed >= 0, t);
  const [again, more] = replies.slice(closed + 1);
  assert.equal(again.show, 'Base Builder Grant is still your best move: up to $5,000. Want me to start?', t);
  assert.equal((again.reply?.move_up as { kind: string }).kind, 'apply', t);
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

/** No day word a builder could read wrong under 48 hours (R-3). */
const DAY_WORDS = /\b(today|tomorrow|tonight|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/;
/** a16z's real close: Nov 1, 11:59 PM PT (PST from Nov 1, so 2026-11-02T07:59:59Z); 10:30 UTC is 21.5 hours before. */
const A16Z_ENDS = new Date('2026-11-02T07:59:59Z');
const AT_1030 = new Date('2026-11-01T10:30:00Z');

test('v4.8.1 final fix (R-3): hoursLeft lives in deadline.ts; fundWhen says the hours left with a clock, the day without, "rolling" stays', () => {
  assert.equal(hoursLeft(A16Z_ENDS.toISOString(), AT_1030), 'in 21 hours');
  const card = { summary: 'up to $1M · closes Nov 1, 11:59 PM PT', ends_at: A16Z_ENDS };
  assert.equal(fundWhen(card), 'closes Nov 1');
  assert.equal(fundWhen(card, AT_1030), 'closes in 21 hours');
  assert.equal(fundWhen(card, new Date('2026-10-28T10:30:00Z')), 'closes Nov 1', '48 hours or more: the program-zone day');
  assert.equal(fundWhen({ summary: 'up to $5K · rolling', ends_at: null }, AT_1030), 'rolling');
  // The same words in India and California: nothing here reads a zone but the program's.
  assert.equal(fundWhen({ ...card, tz: 'Asia/Kolkata' }, AT_1030), 'closes in 21 hours');
});

test('v4.8.1 final fix (R-3): the opener list, also-open and the investor line say "in N hours" from live cards', db, async () => {
  const ends = new Date(Date.now() + 19.5 * H).toISOString();
  const inv = { ...committedProgram('a16z-speedrun'), id: `v481-${process.pid}-r3oi`, title: `Opener Runway ${RUN}` };
  const grant = { ...committedProgram('arc-microgrants'), id: `v481-${process.pid}-r3og`, title: `Opener Microgrant ${RUN}` };
  for (const f of [inv, grant]) await upsertProgram(ProgramFile.parse({ ...f, ends_at: ends, status: 'active', starts_at: null }));
  const now = new Date();
  // Only Base and the two copies, so no other test's program is the soonest.
  const live = ((await listPrograms()) as unknown as Card[]).filter((c) => [inv.id, grant.id, 'base-builder-grants'].includes(c.id));
  assert.equal(live.length, 3, JSON.stringify(live.map((c) => c.id)));
  const opener = openerPrograms(live, now, new Set());
  assert.equal(opener.find((p) => p.id === inv.id)?.when, 'closes in 19 hours', JSON.stringify(opener));
  assert.equal(opener.find((p) => p.id === grant.id)?.when, 'closes in 19 hours', JSON.stringify(opener));
  assert.equal(openNowInvestment(live, now, new Set())?.when, 'closes in 19 hours');
  const also = alsoOpen(live, now, new Set(), 'base-builder-grants');
  assert.equal(also.find((x) => x.title === grant.title)?.when, 'closes in 19 hours', JSON.stringify(also));
  for (const x of [...opener, ...also]) assert.doesNotMatch(x.when, DAY_WORDS);
  await dropPrograms([inv.id, grant.id]);
});

test('v4.8.1 final fix (R-3): the programs answer\'s grant and investor rows say "in 19 hours"', db, async () => {
  const ends = new Date(Date.now() + 19.5 * H).toISOString();
  const inv = { ...committedProgram('a16z-speedrun'), id: `v481-${process.pid}-r3i`, title: `Runway Hours ${RUN}` };
  const grant = { ...committedProgram('arc-microgrants'), id: `v481-${process.pid}-r3g`, title: `Microgrant Hours ${RUN}` };
  const open = async () => {
    for (const f of [inv, grant]) await upsertProgram(ProgramFile.parse({ ...f, ends_at: ends, status: 'active', starts_at: null }));
  };
  await open();
  const b = await ownerDb('r3p');
  await open();
  const [ans] = await converse(b.ctx as never, [{ find: { ask: 'programs' } }], { builderId: b.id });
  const line = (title: string) => ans.show.split('\n').find((l) => l.includes(title)) ?? '';
  assert.match(line(inv.title), /in 19 hours/, ans.show);
  assert.match(line(grant.title), /in 19 hours/, ans.show);
  assert.doesNotMatch(line(inv.title) + line(grant.title), DAY_WORDS, ans.show);
  await dropPrograms([inv.id, grant.id]);
});

test('v4.8.1 final fix (R-3): the closing nudge says the hours left, never a UTC weekday; past 48 hours the program-zone day', () => {
  const a16z = { ends_at: A16Z_ENDS, summary: 'up to $1M · closes Nov 1, 11:59 PM PT', tz: null };
  // The old closesOn read 2026-11-02 in UTC: "Monday", a day after a16z really closes.
  assert.equal(closingNudge('a16z speedrun SR008', closesWhen(a16z, AT_1030)), 'Heads up, a16z speedrun SR008 closes in 21 hours. Your draft is ready. Want to send it?');
  assert.equal(closesWhen(a16z, new Date('2026-10-30T10:30:00Z')), 'Nov 1');
  assert.doesNotMatch(closesWhen(a16z, new Date('2026-11-01T06:00:00Z')), DAY_WORDS);
});

test('v4.8.1 final fix (R-3): the standing Next line, the deadline line and the program updates say the hours left', () => {
  const cards = [{ id: 'a16z', title: 'a16z speedrun SR008', summary: 'up to $1M · closes Nov 1, 11:59 PM PT', ends_at: A16Z_ENDS }];
  const next = nextDeadline([{ program_id: 'a16z' }], cards, AT_1030);
  assert.deepEqual(next, { program: 'a16z speedrun SR008', day: 'in 21 hours' });
  const para = standingParagraph({ score: null, rank: null, streak: 0, wonUsd: null, applied: 0, drafts: 0, next });
  assert.equal(para, 'Next: a16z speedrun SR008 closes in 21 hours.');
  const entry = { id: 1, title: 'Arc Microgrants', ends_at: new Date(AT_1030.getTime() + 30 * H), submitted: false };
  assert.equal(deadlineLine([entry], {}, AT_1030)?.line, "Arc Microgrants closes in 30 hours; your entry isn't submitted.");
  assert.equal(deadlineLine([{ ...entry, ends_at: new Date(AT_1030.getTime() + 60 * H) }], {}, AT_1030)?.line, "Arc Microgrants closes in 2 days; your entry isn't submitted.");
  const card = { id: 'a16z', title: 'a16z speedrun SR008', summary: 'up to $1M', ends_at: A16Z_ENDS, closes_in_days: 0, sponsored: false } as unknown as Card;
  assert.deepEqual(programUpdates([card], false, AT_1030), [{ text: 'a16z speedrun SR008 closes in 21 hours', program_id: 'a16z' }]);
});

test('v4.8.1 final fix (R-3): emails say the close absolute, with the hours left as of sending', () => {
  const card = { summary: 'up to $1M · closes Nov 1, 11:59 PM PT', tz: null, ends_at: A16Z_ENDS };
  assert.equal(cardSubmitBy(card, AT_1030), 'Nov 1, 11:59 PM PT (in 21 hours)');
  assert.equal(cardSubmitBy(card, new Date('2026-10-28T10:30:00Z')), 'Nov 1, 11:59 PM PT');
  assert.equal(cardSubmitBy({ summary: 'up to $5K · rolling', ends_at: null }, AT_1030), null);
  const day = cardSubmitBy(card, AT_1030)!;
  const mail = alertBody({ kind: 'closing', key: 'closing:a16z', program: 'a16z speedrun SR008', day, amount: 'up to $1M', draft: false });
  assert.equal(mail.subject, 'a16z speedrun SR008 closes Nov 1, 11:59 PM PT (in 21 hours)');
  assert.ok(mail.text.startsWith('a16z speedrun SR008 closes Nov 1, 11:59 PM PT (in 21 hours), up to $1M.'), mail.text);
  // The Monday email's deadlines and new programs.
  const body = digestBody({
    now: AT_1030, week: null, handle: null, money: [], wins: [],
    newPrograms: [{ title: 'Arc Builders', repo: 'earnkit', prize_usd: 500, ends_at: A16Z_ENDS, summary: 'up to $500 · closes Nov 1, 11:59 PM PT' }],
    deadlines: [{ program: 'a16z speedrun SR008', what: 'closes', at: A16Z_ENDS, summary: card.summary }],
  })!;
  assert.match(body.text, /New: Arc Builders fits earnkit, \$500, closes Nov 1, 11:59 PM PT \(in 21 hours\)\./, body.text);
  assert.match(body.text, /Your a16z speedrun SR008: closes Nov 1, 11:59 PM PT \(in 21 hours\)\./, body.text);
  // The money line at 3 hours left: never "in 1 day".
  const three = new Date(AT_1030.getTime() + 3.5 * H);
  assert.deepEqual(moneyTexts({ title: 'Base Builder Grant', ends_at: three, zone: 'America/Los_Angeles' }, 0, AT_1030),
    ['Base Builder Grant closes Nov 1, 6:00 AM PT (in 3 hours). Your draft is one yes away.']);
  for (const t of [mail.subject, mail.text, body.text]) assert.doesNotMatch(t, DAY_WORDS, t);
});

test("v4.8.1 final fix (R-4): an unpicked hook left on an investor program doesn't hide it from the money line", db, async () => {
  // No earlier test's program (F6's copy closes sooner) is the clause here.
  await dropRunPrograms();
  const file = committedProgram('a16z-speedrun');
  const id = `v481-${process.pid}-r4`;
  const title = `Runway Left ${RUN}`;
  const ends = new Date(Date.now() + 90 * 60_000).toISOString();
  const open = () => upsertProgram(ProgramFile.parse({ ...file, id, title, ends_at: ends, status: 'active', starts_at: null }));
  await open();
  const b = await ownerDb('r4h');
  await open();
  // The owner's snapshot: a hook on the investor program from an older session, never picked.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('path', jsonb_build_object('stage', 'hook', 'program_id', ${id}::text, 'at', now()::text)) WHERE builder_id = ${b.id}`;
  const [r] = await converse(b.ctx as never, [{ find: {} }], { builderId: b.id });
  assert.match(r.show.split('\n\n')[0], /^Jenil, [^\n]*Base Builder Grant/, r.show);
  // v4.8.2 Task 2: the copy closes soonest, so "Closing soon" names it first (a second program may follow).
  assert.ok(moneyPara(r.show)?.replace(/^Open now: \S+ in grants\. /, '').startsWith(`Closing soon: ${title} (investor program, up to $1M, in 1 hour)`), r.show);
  // Picked, it is the reply's own program, so the clause never names it.
  const p = await ownerDb('r4p', { pick: id });
  await open();
  const [own] = await converse(p.ctx as never, [{ find: {} }], { builderId: p.id });
  assert.doesNotMatch(moneyPara(own.show) ?? '', new RegExp(title), own.show);
  assert.deepEqual(gateFailures([r], { names: ['EarnKit', b.handle] }), [], r.show);
  await dropPrograms([id]);
});

test('v4.8.1 final fix (6): a draft made through apply_yes stores the draft\'s own ask; a months-old yes is no draft in hand', () => {
  const key = 'jf/earnkit';
  const base = 'base-builder-grants';
  // bench_ask about another program (ownAsk null): the blanks ask with none left, never {}.
  assert.deepEqual(readyStored('draft', null, key, base), { kind: 'apply', key, program_id: base, path: true, draft: true, blanks: [] });
  const own = { kind: 'apply', key, program_id: base, path: true, draft: true, blanks: ['your team'] };
  assert.deepEqual(readyStored('draft', own, key, base), own);
  assert.deepEqual(readyStored('submit', null, key, base), { kind: 'apply', key, program_id: base, path: true, submit: true });
  assert.equal(blanksAsk([]), 'Want me to finish it?');
  // A draft yes counts within DECLINE_MS only (pathSkip's rule).
  assert.equal(pathDrafted({ apply_yes: { [base]: NOW.toISOString() } }, base, null, NOW), true);
  assert.equal(pathDrafted({ apply_yes: { [base]: new Date(NOW.getTime() - 60 * 86_400_000).toISOString() } }, base, null, NOW), false);
  assert.equal(pathDrafted({ apply_yes: { [base]: new Date(NOW.getTime() - 60 * 86_400_000).toISOString() } }, base, { draft: true }, NOW), true);
  assert.equal(pathDrafted({}, base, null, NOW), false);
});

test('v4.8.1 final fix (8): the gap step\'s guide link ends its line, so no sentence runs into the URL', () => {
  const steps = qualifyGapSteps(['codes']);
  const link = steps[0].link!;
  for (const r of [
    gapStillReply('Base Builder Grant Program', steps, false, "You're live on Base."),
    gapStillReply('Base Builder Grant Program', steps, false, null),
    gapStillReply('Base Builder Grant Program', steps, false, "You're live on Base.", { first: 'Jenil', amount: 'up to $5,000', closes: null }),
  ]) {
    const s = r.show_to_builder;
    assert.ok(s.includes(`Guide: ${link}\n`), s);
    assert.ok(!s.includes(`${link} `) && !s.includes(`${link}.`), s);
    assert.equal(s.split('\n\n').length, 1, s);
    // The money line still goes just before the easy reply, and the URL stays whole.
    const m = withMoneyLine(s, 'Open now: $1K in grants.');
    assert.ok(m.endsWith('\n\nOpen now: $1K in grants.\n\nWant me to do it now?'), m);
    assert.ok(m.includes(`Guide: ${link}\n`), m);
  }
  // A step with no link reads as before.
  assert.equal(gapStillReply('Arc Microgrants', [{ text: 'Put your app on Arc.', doable: false }], false, null).show_to_builder, 'Still on Arc Microgrants: put your app on Arc. Want help with it now?');
});

test('N1: a guide link then the ask on a new line leaves one question ending on the done ask', async () => {
  for (const sep of ['\n', ' ']) {
    const out = helpDoneTail(`Next step: is the contract verified? Guide: https://docs.base.org/x${sep}Want me to do it now?`);
    assert.equal(out.split('?').length - 1, 1);
    assert.ok(out.endsWith(HELP_DONE_ASK));
    assert.ok(!out.includes('Want me to do it'));
  }
});
