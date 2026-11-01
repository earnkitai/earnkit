import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { walletOffered } from './fixtures/wallet-step';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { serverInstructions } from './mcp';
import { walletSetupAsk } from './bench-reply';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';
import { isoWeekOf } from './weeks';
import { backfillMondays } from './week-facts';
import { X_ON, withEnv } from './fixtures/find';
import {
  CAN_DO, PREPARE_LINE, PROGRAMS_AGAIN, fitCell, programsAnswer, standingAgain, standingAnswer, connectedLine, investorLater, noFitWhy, pickHook, openerAgain, openerReply, pickedReply, resolvePick, FOUNDER_BLANKS, MENTOR_NOTE, PATH_ANSWER_FIRST, CODES_OFFER, blanksAgain, SESSION_MS, SENT_ASK, TRACK_ACK, agoWords, passedLine, sinceLine, submitBy, submitPointer, submitReply, trackLead, bestMove, blanksAsk, closeWords, draftBlanks, draftReply, gapClosedReply, gapProof, gapReply, gapStillReply, pathReply, programName, proofLine, readPath, sessionOf,
  type GapGrant, type InvestorProgram, type MoveCtx, type MoveProgram,
} from './conversation';
import { qualifyGapSteps, BUILDER_CODES_GUIDE } from './bench-reply';
import { BUILDER_CODES_SUFFIX } from './builder-code';
import { PUSHED_ASK, RECHECK_WAIT, codesSettled, founderBriefNote, openerPrograms, questionsDraftNote } from './bench-find';
import type { Card } from './present';
import { shipLogBlock, shipLogFacts } from './ship-log-facts';
import { rankWords } from './rank';
import { alertBody, runAlertMail, tellLine } from './alert-mail';

/**
 * v4.8 Task 1: the path, session memory and the agent note. The copy is the target conversation's (section A's
 * opener); the agent rewords it per MENTOR_NOTE, so show_to_builder carries the target text and these tests pin it.
 */
/** Fix round 3 (2): a find or score path reply's note: a short answer-first sentence, then the mentor note. */
const PATH_NOTE_OF = (m: string) => `If they asked a question, answer it first in one short line from the facts. ${m}`;
const BAD = /—|\bcoins?\b|\bpoints?\b|\p{Extended_Pictographic}/iu;
const NOW = new Date('2026-10-31T19:00:00Z');
const PT = 'America/Los_Angeles';
const prog = (o: Partial<MoveProgram> & { id: string }): MoveProgram => ({
  title: o.id, amount: '$1,000', when: 'rolling', ends_at: null, zone: 'UTC', investment: false, ...o,
});
const A16Z: InvestorProgram = {
  ...prog({ id: 'a16z-speedrun', title: 'a16z speedrun SR008', amount: 'up to $1M', when: 'closes Nov 1', ends_at: '2026-11-02T07:59:59Z', zone: PT, investment: true }),
  odds: 'speedrun says fewer than 0.4% of applicants are accepted',
};
const BASE: GapGrant = {
  ...prog({ id: 'base-builder-grants', title: 'Base Builder Grant Program', amount: 'up to $5,000' }),
  gaps: ['codes'], gap: 'EarnKit is one step away: add Builder Codes.', passed: true, doable: true,
};
/** Arc Microgrants' chain gap: never a step the agent does in the repo. */
const ARC: GapGrant = {
  ...prog({ id: 'arc', title: 'Arc Microgrants: Built with Arc Studio', amount: '500 USDC × 8 grants', when: 'closes Nov 1', ends_at: '2026-11-02T04:59:00Z', zone: 'America/New_York' }),
  gaps: ['on Arc mainnet'], gap: 'Arc Microgrants needs EarnKit on Arc mainnet.', passed: false, doable: false,
};
const gap = (id: string, gaps: string[], o: Partial<GapGrant> = {}): GapGrant => ({ ...prog({ id }), gaps, gap: 'x', passed: false, doable: false, ...o });
const ctx = (o: Partial<MoveCtx> = {}): MoveCtx => ({ now: NOW, fits: [], grants: [], investors: [], skip: new Set(), raised: new Set(), path: null, ...o });

test('bestMove (fix round 1, R1): fit; no gap closing in 48 hours; an agent-doable one step; investor in 7 days; closest; quiet', () => {
  const fitSoon = prog({ id: 'fit-soon', ends_at: '2026-11-05T00:00:00Z', when: 'closes Nov 5' });
  const fitRolling = prog({ id: 'fit-rolling' });
  const codes = gap('codes', ['codes'], { doable: true });
  const two = gap('two', ['a', 'b']);
  const three = gap('three', ['a', 'b', 'c']);
  // 5 days out: an investor program, not within 48 hours.
  const week = { ...A16Z, id: 'week', ends_at: '2026-11-05T19:00:00Z' };
  // 1. A real fit, closing first (rolling last), before anything else.
  assert.deepEqual(bestMove(ctx({ fits: [fitRolling, fitSoon], grants: [codes, ARC], investors: [A16Z] })), { kind: 'fit', program: fitSoon });
  // 2. A program closing within 48 hours with no gap: an investor program (a16z) or a grant with no gap known.
  assert.deepEqual(bestMove(ctx({ grants: [codes, ARC], investors: [A16Z, week] })), { kind: 'now', program: A16Z });
  const noGap = gap('nogap', [], { ends_at: '2026-11-01T12:00:00Z', when: 'closes Nov 1' });
  assert.deepEqual(bestMove(ctx({ grants: [noGap, codes] })), { kind: 'now', program: noGap });
  // ... a no-gap grant further out is never a move on its own.
  assert.deepEqual(bestMove(ctx({ grants: [gap('later', [], { ends_at: '2026-11-20T00:00:00Z' })] })), { kind: 'quiet' });
  // 3. A grant one step away, the step one the agent can do (Builder Codes), before an investor program in 7 days.
  assert.deepEqual(bestMove(ctx({ grants: [two, codes], investors: [week] })), { kind: 'one_step', program: codes });
  // 4. The investor program closing within 7 days, with the program file's odds.
  const inv = bestMove(ctx({ grants: [three, two], investors: [week] }));
  assert.equal(inv.kind, 'investor');
  assert.equal(inv.kind === 'investor' && inv.program.odds, A16Z.odds);
  // ... only within 7 days of its close.
  const later = { ...A16Z, id: 'later', ends_at: '2026-11-18T23:59:59Z' };
  // 5. The closest grant by number of gaps.
  const closest = bestMove(ctx({ grants: [three, two], investors: [later] }));
  assert.equal(closest.kind === 'closest' && closest.program.id, 'two');
  // 6. Nothing: quiet.
  assert.deepEqual(bestMove(ctx({ investors: [later] })), { kind: 'quiet' });
  // A closed program is never a move.
  assert.deepEqual(bestMove(ctx({ fits: [prog({ id: 'gone', ends_at: '2026-10-30T00:00:00Z' })] })), { kind: 'quiet' });
});

test("bestMove (fix round 1, R1): Arc's chain gap is never a one-step; it waits behind an investor program", () => {
  const week = { ...A16Z, id: 'week', ends_at: '2026-11-05T19:00:00Z' };
  // One gap, but a chain deployment: not step 3, so the investor program in 7 days leads.
  assert.equal(bestMove(ctx({ grants: [ARC], investors: [week] })).kind, 'investor');
  // Alone, it is only ever the closest grant (step 5), never a one_step.
  assert.equal(bestMove(ctx({ grants: [ARC] })).kind, 'closest');
  // The owner's real day: a16z closes within 48 hours with no gap, so it leads Arc (and Base, passed on).
  assert.deepEqual(bestMove(ctx({ grants: [ARC, BASE], investors: [A16Z] })), { kind: 'now', program: A16Z });
});

test('bestMove: a passed step is raised once, only when it is the one gap, never ahead of an investor program', () => {
  // A's opener: Base's one gap (Builder Codes) was passed on, so a16z leads.
  assert.equal(bestMove(ctx({ grants: [BASE], investors: [A16Z] })).kind, 'now');
  // After "sent" (a16z applied to), Base is raised as the closest, this once.
  const raised = bestMove(ctx({ grants: [BASE], investors: [A16Z], skip: new Set(['a16z-speedrun']) }));
  assert.deepEqual(raised, { kind: 'closest', program: BASE, raise: true });
  assert.deepEqual(bestMove(ctx({ grants: [BASE], raised: new Set([BASE.id]) })), { kind: 'quiet' });
  // A passed step that isn't the one gap is never raised.
  assert.deepEqual(bestMove(ctx({ grants: [{ ...BASE, gaps: ['codes', 'use'] }] })), { kind: 'quiet' });
});

test('bestMove (Review Focus 4): an investor program is never a fit; applied to or drafted is never the hook', () => {
  // An investment in the fits list is never a fit (it waits for its own step).
  assert.deepEqual(bestMove(ctx({ fits: [A16Z] })), { kind: 'quiet' });
  const fit = prog({ id: 'fit' });
  // Applied to or drafted (skip): never the hook, so the next move leads.
  assert.equal(bestMove(ctx({ fits: [fit], investors: [A16Z], skip: new Set(['fit']) })).kind, 'now');
  assert.deepEqual(bestMove(ctx({ fits: [fit], investors: [A16Z], skip: new Set(['fit', 'a16z-speedrun']) })), { kind: 'quiet' });
  // The stored path keeps its program while it is still a move and the builder is on it: picked (Task 4 stores a new
  // builder's pick before ranking) or past the hook.
  const one = gap('one', ['codes'], { doable: true });
  const at = NOW.toISOString();
  for (const path of [{ stage: 'hook' as const, program_id: 'one', at, picked: true as const }, { stage: 'gap' as const, program_id: 'one', at }]) {
    const kept = bestMove(ctx({ fits: [fit], grants: [one], path }));
    assert.equal(kept.kind === 'one_step' && kept.program.id, 'one');
    // ... and never once it is skipped.
    assert.equal(bestMove(ctx({ fits: [fit], grants: [one], skip: new Set(['one']), path })).kind, 'fit');
  }
  // A hook EarnKit chose is chosen again each reply (a better move, here a fit back from a no, leads).
  assert.equal(bestMove(ctx({ fits: [fit], grants: [one], path: { stage: 'hook', program_id: 'one', at } })).kind, 'fit');
});

test('readPath: a path may name a program before the builder is ranked; anything else is null', () => {
  assert.deepEqual(readPath({ path: { stage: 'hook', program_id: 'circle-developer-grants', at: NOW.toISOString() } }), { stage: 'hook', program_id: 'circle-developer-grants', at: NOW.toISOString() });
  assert.deepEqual(readPath({ path: { stage: 'hook', program_id: null, at: NOW.toISOString() } })?.program_id, null);
  assert.equal(readPath({ path: { stage: 'hook', program_id: 'x', at: NOW.toISOString(), picked: true } })?.picked, true);
  assert.equal(readPath({ path: { stage: 'hook', program_id: 'x', at: NOW.toISOString(), picked: 'yes' } })?.picked, undefined);
  for (const p of [undefined, null, 'hook', { stage: 'nope', at: NOW.toISOString() }, { stage: 'hook', program_id: 3, at: NOW.toISOString() }, { stage: 'hook' }])
    assert.equal(readPath({ path: p }), null);
});

test('sessionOf: fresh after 2 hours of quiet; within, the parts said', () => {
  const said = { at: NOW.toISOString(), keys: ['hook:a', 'proof:x'] };
  assert.deepEqual(sessionOf({}, NOW), { fresh: true, said: new Set() });
  const within = sessionOf({ said }, new Date(NOW.getTime() + SESSION_MS - 1));
  assert.equal(within.fresh, false);
  assert.deepEqual([...within.said], ['hook:a', 'proof:x']);
  assert.deepEqual(sessionOf({ said }, new Date(NOW.getTime() + SESSION_MS)), { fresh: true, said: new Set() });
  assert.equal(sessionOf({ said: { at: 'garbage', keys: ['x'] } }, NOW).fresh, true);
});

test('closeWords and programName', () => {
  assert.equal(closeWords('2026-11-02T07:59:59Z', PT, NOW), 'tomorrow night');
  assert.equal(closeWords('2026-11-01T06:59:59Z', PT, NOW), 'tonight');
  assert.equal(closeWords('2026-11-01T18:00:00Z', PT, NOW), 'tomorrow');
  assert.equal(closeWords('2026-11-06T07:59:59Z', PT, NOW), 'Nov 5');
  assert.equal(programName('Base Builder Grant Program'), 'Base Builder Grant');
  assert.equal(programName('Arc Microgrants: Built with Arc Studio'), 'Arc Microgrants');
  assert.equal(proofLine({ name: 'EarnKit', live: true }, 6, false), "You've shipped 6 weeks in a row and EarnKit is live.");
  assert.equal(proofLine({ name: 'EarnKit', live: false }, 1, false), "You've shipped 1 week in a row.");
  assert.equal(proofLine({ name: 'EarnKit', live: false }, 0, true), null);
});

/** Section A's opener, the facts filled from the owner's account (score 77, 6 weeks, live, a16z open). */
const A_OPENER =
  "Jenil, a16z speedrun SR008 closes tomorrow night: up to $1M. You've shipped 6 weeks in a row and EarnKit is live, which is the traction they ask about.\n\n" +
  'I can draft your application from your commits and live product in a few minutes. Want me to start?';

test("pathReply: the owner's opener is section A's, word for word; the same hook again is a one-line pointer", () => {
  const move = bestMove(ctx({ grants: [BASE], investors: [A16Z] }));
  assert.equal(move.kind, 'now');
  const r = pathReply({ now: NOW, first: 'Jenil', project: { name: 'EarnKit', live: true }, streak: 6, move: move as Exclude<typeof move, { kind: 'quiet' }>, said: new Set() });
  assert.equal(r.show_to_builder, A_OPENER);
  assert.equal(r.stage, 'hook');
  assert.equal(r.program_id, 'a16z-speedrun');
  assert.equal(r.reply, 'start');
  assert.doesNotMatch(r.show_to_builder, BAD);
  // An investor program is never called a fit, and never a grant.
  assert.doesNotMatch(r.show_to_builder, /\bfit\b|grant/i);
  const again = pathReply({ now: NOW, first: 'Jenil', project: { name: 'EarnKit', live: true }, streak: 6, move: move as never, said: new Set(r.said) });
  assert.equal(again.show_to_builder, 'Your a16z speedrun SR008 application is still the next move. Want me to start?');
  assert.deepEqual(again.said, []);
});

test('pathReply: a grant with a gap gives its money, the gap and "Want the steps?"; a proof said already is left out', () => {
  const one: GapGrant = { ...prog({ id: 'arc', title: 'Arc Microgrants: Built with Arc Studio', amount: '500 USDC × 8 grants', when: 'closes Nov 1', ends_at: '2026-11-02T03:59:00Z', zone: 'America/New_York' }), gaps: ['on Arc mainnet'], gap: 'Arc Microgrants needs EarnKit on Arc mainnet.', passed: false, doable: false };
  const r = pathReply({ now: NOW, first: 'Jenil', project: { name: 'EarnKit', live: true }, streak: 6, move: { kind: 'one_step', program: one }, said: new Set() });
  assert.equal(r.show_to_builder,
    "Jenil, Arc Microgrants pays 500 USDC × 8 grants, closing tomorrow night. Arc Microgrants needs EarnKit on Arc mainnet. You've shipped 6 weeks in a row and EarnKit is live.\n\nWant the steps?");
  const c = pathReply({ now: NOW, first: 'Jenil', project: { name: 'EarnKit', live: true }, streak: 6, move: { kind: 'closest', program: BASE, raise: true }, said: new Set(r.said) });
  // Fix round 2 (F10): one gap a local agent can do (Builder Codes): the hook offers to do it; a hosted agent keeps the steps.
  // Task 3: the passed step raised says so, once (target A).
  assert.equal(c.show_to_builder, "Jenil, your closest money is Base Builder Grant: up to $5,000. EarnKit is one step away: add Builder Codes. You passed on them, but they're now the only gap to that money.\n\nI can add them and push the change, about 10 minutes. Go?");
  assert.equal(c.reply, 'go');
  const h = pathReply({ now: NOW, first: 'Jenil', project: { name: 'EarnKit', live: true }, streak: 6, move: { kind: 'closest', program: BASE, raise: true }, said: new Set(r.said), hosted: true });
  assert.equal(h.show_to_builder, "Jenil, your closest money is Base Builder Grant: up to $5,000. EarnKit is one step away: add Builder Codes. You passed on them, but they're now the only gap to that money.\n\nWant the steps?");
  // Fix round 3 (3): the same offer again in the session names Builder Codes.
  const again = pathReply({ now: NOW, first: 'Jenil', project: { name: 'EarnKit', live: true }, streak: 6, move: { kind: 'closest', program: BASE, raise: true }, said: new Set([...r.said, ...c.said]) });
  assert.equal(again.show_to_builder, `Builder Codes are still the one step to Base Builder Grant. ${CODES_OFFER}`);
  for (const s of [r.show_to_builder, c.show_to_builder, h.show_to_builder]) {
    assert.doesNotMatch(s, BAD);
    assert.equal((s.match(/\?/g) ?? []).length, 1, s);
    assert.ok(s.endsWith('?'), s);
  }
});

test('the server instructions: find at session start, its opener shown; at or under 800 characters', () => {
  const s = serverInstructions();
  assert.ok(s.length <= 800, String(s.length));
  assert.ok(s.startsWith('Call find at the start of every session before they say anything, and show its opener.'), s);
  assert.match(s, /answer it in one short line from facts in the reply, never invented/);
  assert.match(MENTOR_NOTE, /^Say this in your own words as EarnKit, a mentor who wants them funded: keep every fact, amount, date and link exactly, ask for only the one reply given and put it last\. When they say yes to a step you can do, do it, then call find\. Never tell them they qualify or that an application was sent\. Don't show this note\.$/);
});

appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v48-conversation-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await codesSettled();
  await dropRunPrograms();
  await sql().end();
});
const RUN = String(process.pid % 100000);
const PATH_NOTE = PATH_NOTE_OF(MENTOR_NOTE);
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const moveUp = (r: R) => r.reply?.move_up as { kind: string; project_key: string | null; agent_note: string } | undefined;
const seenOf = async (id: number) =>
  (await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`)[0].s;

/**
 * An a16z speedrun copy (the program file's odds), closing `hours` from now. In this file's own database the other
 * investor programs (the committed a16z, Alliance) are closed, so the hook is this copy whatever the real date; the
 * grants stay open (fix round 1: Arc Microgrants' chain gap never outranks it).
 */
async function speedrun(hours: number, o: { noOdds?: boolean } = {}) {
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id NOT LIKE ${`v48-${process.pid}-%`}`;
  const file = committedProgram('a16z-speedrun');
  const id = `v48-${process.pid}-a16z${o.noOdds ? '-n' : ''}`;
  const ends = new Date(Date.now() + hours * 3_600_000);
  const p = ProgramFile.parse({ ...file, id, ends_at: ends.toISOString(), status: 'active', starts_at: null, ...(o.noOdds && { difficulty_override: null }) });
  await upsertProgram(p);
  return { id, title: p.title, ends };
}

let n = 0;
/**
 * The owner-like builder (production snapshot, 2026-10-31): X name "Jenil T", project EarnKit, its repo proven by the
 * App, live and on Base, six weeks shipping, Builder Codes passed on (Base's steps declined today), the connect weeks
 * and setup step 3 done.
 */
async function owner(tag: string) {
  n++;
  const t = `ek_v48_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `je${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `48${RUN}${n}${tag.length}`, username: handle, name: 'Jenil T', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  await walletOffered(c.id);
  const key = `je${tag}${RUN}/earnkit`;
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'earnkit', url: `https://github.com/${key}`, homepage: 'https://earnkit.com', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{ repo: 'earnkit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true, verdicts: [] }];
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  await mcpCall(ctx, 'find', { identity: { project: { name: 'EarnKit', repo: `https://github.com/${key}`, live_url: 'https://earnkit.com' } } });
  const gid = 48000 + n * 10 + (Number(RUN) % 7);
  const gh = fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  // Six weeks shipping in a row (this week and the five before), live as an app.
  const weeks = Array.from({ length: 6 }, (_, k) => isoWeekOf(new Date(Date.now() - k * 7 * 86_400_000)));
  await sql()`UPDATE builder_projects SET commit_weeks = ${weeks}::text[], shipped = true, kind = 'app' WHERE builder_id = ${c.id} AND lower(project_key) = lower(${key})`;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text,
      'declined', jsonb_build_object(${`qualify:${key}`}::text, now()::text)) WHERE builder_id = ${c.id}`;
  return { ctx, id: c.id, key, gh, handle };
}
const find = (b: { ctx: unknown }, args: Record<string, unknown> = {}) => mcpCall(b.ctx as never, 'find', args);

test("the owner-like builder's first find is A's opener; the next find in the session points back, never the same block", db, async () => {
  const sr = await speedrun(30);
  // Fix round 1 (R1): an open Arc Microgrants copy closing sooner, one chain gap away: never a one-step, so a16z leads.
  const arc = committedProgram('arc-microgrants-studio', { keepContract: true });
  await upsertProgram(ProgramFile.parse({ ...arc, id: `v48-${process.pid}-arc`, ends_at: new Date(Date.now() + 20 * 3_600_000).toISOString(), status: 'active', starts_at: null }));
  const b = await owner('a');
  const r = await find(b);
  const s = show(r);
  const [p1, p2] = s.split('\n\n');
  assert.match(p1, new RegExp(`^Jenil, ${sr.title} closes (tonight|today|tomorrow night|tomorrow|[A-Z][a-z]{2} \\d{1,2}): up to \\$1M\\. You've shipped \\d+ weeks? in a row and EarnKit is live, which is the traction they ask about\\.$`), s);
  assert.equal(p2, 'I can draft your application from your commits and live product in a few minutes. Want me to start?', s);
  assert.equal(s.split('\n\n').length, 2, s);
  assert.doesNotMatch(s, BAD);
  assert.doesNotMatch(s, /Open now|Ask me anytime/);
  // The agent note is the mentor note; a yes drafts it (the apply ask, stored for tell).
  assert.equal(r.reply?.note, PATH_NOTE);
  assert.equal(moveUp(r)?.kind, 'apply');
  assert.deepEqual((r.reply?.lead as { program_id: string }).program_id, sr.id);
  const seen = await seenOf(b.id);
  assert.equal((seen.bench_ask as { kind: string; program_id: string }).program_id, sr.id);
  assert.deepEqual({ ...(seen.path as object), at: undefined }, { stage: 'hook', program_id: sr.id, at: undefined });
  assert.ok((seen.said as { keys: string[] }).keys.includes(`hook:${sr.id}`));
  // Review Focus 5 (an older agent calling find again): a one-line pointer, never the opener again.
  const again = show(await find(b));
  assert.equal(again, `Your ${programName(sr.title)} application is still the next move. Want me to start?`);
  // After 2 hours of quiet, a new session: the opener again. (Task 3: the copy opened within this test, after the last
  // session began, so "Since earlier today: ... opened." may lead it.)
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{said,at}', to_jsonb(${new Date(Date.now() - SESSION_MS - 1000).toISOString()}::text)) WHERE builder_id = ${b.id}`;
  const fresh = show(await find(b)).split('\n\n');
  assert.deepEqual(fresh.slice(-2), [p1, p2]);
  // Fix round 1 (5): it was hooked last session, so it is not new to this builder: no "opened".
  assert.equal(fresh.length, 2, fresh.join('|'));
});

test('a no to the hook parks that program for DECLINE_MS and the path moves on', db, async () => {
  await speedrun(30);
  const b = await owner('no');
  assert.equal(moveUp(await find(b))?.kind, 'apply');
  await mcpCall(b.ctx as never, 'tell', { move_up: { kind: 'apply', project_key: b.key, answer: 'no' } });
  const next = show(await find(b));
  assert.doesNotMatch(next, /speedrun/, next);
});

test('a held submit question still comes before the path', db, async () => {
  await speedrun(30);
  const b = await owner('held');
  await sql()`INSERT INTO projects (program_id, name, installation_id, confirmed_at) VALUES ('base-builder-grants', 'EarnKit', ${b.id}, now())`;
  const r = await find(b);
  const s = show(r);
  assert.match(s, /The only step left: submit it on .+\. Did you submit it\?$/, s);
  assert.doesNotMatch(s, /speedrun|Want me to start\?/, s);
  assert.equal((await seenOf(b.id)).path, undefined);
});

test('setup step 3 still comes before the path, word for word', db, async () => {
  await speedrun(30);
  const b = await owner('s3');
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'wallet_asked' - 'wallet_link_at' - 'setup_asked' WHERE builder_id = ${b.id}`;
  const r = await find(b);
  const s = show(r);
  assert.equal(moveUp(r)?.kind, 'wallet_setup', s);
  const link = s.match(/no fee: (\S+)/)?.[1] ?? '';
  assert.equal(s, walletSetupAsk('EarnKit', link));
  assert.equal((await seenOf(b.id)).path, undefined);
});

test("a no to a grant's gap hook (Base's steps) parks it for the path; nothing asks it again this session", db, async () => {
  // Only Base's and Circle's rolling grants open (the earlier tests' a16z copies closed too).
  await sql()`UPDATE programs SET status = 'closed' WHERE id NOT IN ('base-builder-grants', 'circle-developer-grants')`;
  const b = await owner('gap');
  // Base's steps not passed on here: Builder Codes (unknown) is its one gap.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'declined' WHERE builder_id = ${b.id}`;
  const r = await find(b);
  const s = show(r);
  assert.match(s, /^Jenil, Base Builder Grant pays up to \$5,000\. [^\n]*Builder Codes[^\n]*\n\nI can add them and push the change, about 10 minutes\. Go\?$/, s);
  assert.equal(moveUp(r)?.kind, 'qualify');
  await mcpCall(b.ctx as never, 'tell', { move_up: { kind: 'qualify', project_key: b.key, answer: 'no' } });
  const declined = (await seenOf(b.id)).declined as Record<string, string>;
  assert.ok(declined['path:base-builder-grants'], JSON.stringify(declined));
  const next = show(await find(b));
  assert.doesNotMatch(next, /Base Builder Grant|Builder Codes/, next);
});

test('a shared client with no X of its own gets no path reply, and nothing is written to standing_seen', db, async () => {
  await speedrun(30);
  const b = await owner('sh');
  const before = await seenOf(b.id);
  const t = `ek_v48_shared_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const other = (await connectInstallation(t))!.own;
  const shared = { ...(b.ctx as object), sharedClient: true, ownInstallationId: other };
  // Through both tools, with X sign-in on and off. (benchView's o.personal gate is the backstop: today a shared client
  // with no X of its own is answered before benchView, signed out or by the shared reply.)
  const x = { id: process.env.X_CLIENT_ID, secret: process.env.X_CLIENT_SECRET };
  const replies: R[] = [];
  for (const off of [false, true]) {
    if (off) {
      delete process.env.X_CLIENT_ID;
      delete process.env.X_CLIENT_SECRET;
    }
    try {
      for (const tool of ['find', 'score'] as const) replies.push(await mcpCall(shared as never, tool, {}));
    } finally {
      process.env.X_CLIENT_ID = x.id;
      process.env.X_CLIENT_SECRET = x.secret;
    }
  }
  for (const r of replies) {
    assert.doesNotMatch(show(r), /speedrun|Want me to start\?|Want the steps\?/, show(r));
    assert.ok(!String(r.reply?.note).endsWith(MENTOR_NOTE));
  }
  const after = await seenOf(b.id);
  for (const k of ['path', 'said', 'path_raised']) assert.deepEqual(after[k], before[k], k);
  // (The signed-out reply stores its own sign-in ask, as before v4.8; never a path ask.)
  assert.notEqual((after.bench_ask as { path?: boolean } | undefined)?.path, true);
});

test('fix round 2 (F9): with no X name the reply greets no name, never the handle', () => {
  const move = bestMove(ctx({ investors: [A16Z] }));
  const r = pathReply({ now: NOW, first: null, project: { name: 'EarnKit', live: true }, streak: 6, move: move as never, said: new Set() });
  assert.ok(r.show_to_builder.startsWith('a16z speedrun SR008 closes tomorrow night: up to $1M. '), r.show_to_builder);
  const c = pathReply({ now: NOW, first: null, project: { name: 'EarnKit', live: false }, streak: 0, move: { kind: 'closest', program: BASE, raise: true }, said: new Set() });
  assert.equal(c.show_to_builder, "Your closest money is Base Builder Grant: up to $5,000. EarnKit is one step away: add Builder Codes. You passed on them, but they're now the only gap to that money.\n\nI can add them and push the change, about 10 minutes. Go?");
});

/** The connect weeks due again (v3-connect.test.ts's backfill): the older moment the closest grant waits behind. */
async function connectDueFor(b: { id: number; key: string }) {
  for (const [i, monday] of backfillMondays(new Date()).entries())
    await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${b.id}, ${b.key}, ${monday}, ${sql().json({ checked: true, shipped_code: { n: i + 2 } } as never)})
      ON CONFLICT (project_key, week) DO UPDATE SET facts = EXCLUDED.facts`;
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'connect_done' - 'connect_open' WHERE builder_id = ${b.id}`;
}

test('fix round 2 (F1): steps 1 to 4 lead even with the connect weeks due', db, async () => {
  const sr = await speedrun(30);
  const b = await owner('f1a');
  await connectDueFor(b);
  const s = show(await find(b));
  assert.ok(s.startsWith(`Jenil, ${sr.title} closes `) && s.endsWith('Want me to start?'), s);
  assert.doesNotMatch(s, /Make your shipping log public/, s);
});

test('fix round 2 (F1): with only the closest grant, the connect weeks go first, once a session; then the path', db, async () => {
  await sql()`UPDATE programs SET status = 'closed' WHERE id NOT LIKE ${`v48-${process.pid}-arcc`}`;
  const arc = committedProgram('arc-microgrants-studio', { keepContract: true });
  const p = ProgramFile.parse({ ...arc, id: `v48-${process.pid}-arcc`, title: `Arc Close ${RUN}`, ends_at: new Date(Date.now() + 20 * 86_400_000).toISOString(), status: 'active', starts_at: null });
  await upsertProgram(p);
  const b = await owner('f1b');
  await connectDueFor(b);
  const first = await find(b);
  assert.equal(moveUp(first)?.kind, 'connect', show(first));
  assert.match(show(first), /Make your shipping log public on /);
  assert.ok(((await seenOf(b.id)).said as { keys: string[] }).keys.includes('older'));
  // The next call in the session: the path's closest grant (one older moment a session).
  const second = show(await find(b));
  assert.ok(second.startsWith(`Jenil, your closest money is Arc Close ${RUN}: `), second);
  assert.ok(second.endsWith('Want the steps?'), second);
});

test('fix round 2 (F4): a v4.7 silence stand-aside never parks a program; an explicit no does', db, async () => {
  const sr = await speedrun(30);
  const b = await owner('f4');
  const at = new Date().toISOString();
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen
      || jsonb_build_object('apply_silent', jsonb_build_object(${sr.id}::text, ${at}::text))
      || jsonb_build_object('declined', COALESCE(standing_seen->'declined', '{}'::jsonb) || jsonb_build_object(${`apply:${sr.id}`}::text, ${at}::text))
    WHERE builder_id = ${b.id}`;
  assert.ok(show(await find(b)).includes(sr.title), 'silence: still the hook');
  await sql()`UPDATE builder_profiles SET standing_seen = (standing_seen - 'apply_silent' - 'said') WHERE builder_id = ${b.id}`;
  assert.ok(!show(await find(b)).includes(sr.title), 'an explicit no parks it');
});

test('fix round 3 (F2): a failed read of what the builder told EarnKit about makes no hook; the older reply answers', db, async () => {
  const sr = await speedrun(30);
  const b = await owner('f2');
  // builder_program_status unreadable for this one call (this file's own database).
  await sql()`ALTER TABLE builder_program_status RENAME TO builder_program_status_gone`;
  let r: R;
  try {
    r = await find(b);
  } finally {
    await sql()`ALTER TABLE builder_program_status_gone RENAME TO builder_program_status`;
  }
  const s = show(r);
  assert.ok(!s.includes(sr.title), s);
  assert.doesNotMatch(s, /Want me to start\?|Want the steps\?/, s);
  assert.ok(!String(r.reply?.note).endsWith(MENTOR_NOTE));
  const seen = await seenOf(b.id);
  assert.equal(seen.path, undefined);
  assert.notEqual((seen.bench_ask as { path?: boolean } | undefined)?.path, true);
});

test('fix round 3: the closest grant never waits for an older moment once the builder is on it', db, async () => {
  await sql()`UPDATE programs SET status = 'closed' WHERE id NOT LIKE ${`v48-${process.pid}-arcm`}`;
  const arc = committedProgram('arc-microgrants-studio', { keepContract: true });
  const p = ProgramFile.parse({ ...arc, id: `v48-${process.pid}-arcm`, title: `Arc Mid ${RUN}`, ends_at: new Date(Date.now() + 20 * 86_400_000).toISOString(), status: 'active', starts_at: null });
  await upsertProgram(p);
  const b = await owner('f3m');
  await connectDueFor(b);
  // Already on that program (its hook, a session ago): the path, not the connect weeks.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('path', jsonb_build_object('stage', 'hook', 'program_id', ${p.id}::text, 'at', now()::text)) WHERE builder_id = ${b.id}`;
  const s = show(await find(b));
  assert.ok(s.startsWith(`Jenil, your closest money is Arc Mid ${RUN}: `), s);
  assert.doesNotMatch(s, /Make your shipping log public/, s);
});

// ---------------------------------------------------------------------------------------------------------------------
// v4.8 Task 2: the gap and draft stages.

const GUIDE = `https://${BUILDER_CODES_GUIDE}`;
/** Target conversation A, exact: the draft's one easy reply for an investor program with no public questions. */
const A_BLANKS = "Two blanks only you can fill: who's on the team, and any money you've raised. Reply with both and I'll finish it.";
const A_CODES_IN = "Builder Codes are in. You now meet Base's first requirement. Want me to draft the Base application next?";
/** Fix round 1 (T2-2): the one-step offer covers the push. */
const OFFER = 'I can add them and push the change, about 10 minutes. Go?';
/** Fix round 1 (T2-6): the steps-done reply's proof line. */
const A_CODES_IN_PROOF = "Builder Codes are in. You now meet Base's first requirement. You're live on Base. Want me to draft the Base application next?";

test('gapReply: the steps, each one the agent can do marked and first; "Go?" for one, the first one for several, help when it can do none', () => {
  const one = gapReply('Base Builder Grant Program', qualifyGapSteps(['codes']), false);
  assert.equal(one.show_to_builder,
    `Your next step toward Base Builder Grant:\n1. Add Base's Builder Code to your app, a one-line tag Base uses to see your traffic. ${CAN_DO} Guide: ${GUIDE}\n\n${OFFER}`);
  assert.equal(one.reply, 'go');
  // Fix round 1 (T2-6): one proof line, before the easy reply.
  assert.ok(gapReply('Base Builder Grant Program', qualifyGapSteps(['codes']), false, "You're live on Base.").show_to_builder.endsWith(`\n\nYou're live on Base. ${OFFER}`));
  // F3: a hosted agent (no folder of the code) can do none: nothing is marked, the help ask.
  const hosted = gapReply('Base Builder Grant Program', qualifyGapSteps(['codes']), true);
  assert.doesNotMatch(hosted.show_to_builder, /I can do this/);
  assert.ok(hosted.show_to_builder.endsWith('\n\nWant help with it now?'), hosted.show_to_builder);
  assert.equal(hosted.reply, 'help');
  const three = gapReply('Base Builder Grant Program', qualifyGapSteps(['base', 'codes', 'use']), false);
  const lines = three.show_to_builder.split('\n');
  assert.equal(lines[0], 'Your next 3 steps toward Base Builder Grant:');
  assert.ok(lines[1].startsWith("1. Add Base's Builder Code") && lines[1].includes(CAN_DO), lines[1]);
  assert.equal(lines[2], '2. Put your app on Base.');
  assert.equal(lines[3], '3. Have a live product people use.');
  assert.equal(lines.at(-1), 'Want me to do the first one now?');
  const none = gapReply('Arc Microgrants: Built with Arc Studio', [{ text: 'Get EarnKit on Arc mainnet.', doable: false }, { text: 'Log in to DoraHacks.', doable: false }], false);
  assert.ok(none.show_to_builder.startsWith('Your next 2 steps toward Arc Microgrants:\n1. Get EarnKit on Arc mainnet.\n2. Log in to DoraHacks.'), none.show_to_builder);
  assert.ok(none.show_to_builder.endsWith('Want help with step 1 now?'));
  for (const r of [one, hosted, three, none]) {
    assert.doesNotMatch(r.show_to_builder, BAD);
    assert.equal((r.show_to_builder.match(/\?/g) ?? []).length, 1, r.show_to_builder);
  }
});

test('the gap closed and the draft: target A word for word', () => {
  assert.equal(gapClosedReply({ org: 'Base', title: 'Base Builder Grant Program', codes: true }), A_CODES_IN);
  assert.equal(gapClosedReply({ org: 'Base', title: 'Base Builder Grant Program', codes: true, proof: gapProof({ name: 'EarnKit', live: true }, 6, []) }), A_CODES_IN_PROOF);
  assert.equal(gapProof({ name: 'EarnKit', live: true }, 6, ['codes', 'use']), "You're on Base.");
  assert.equal(gapProof({ name: 'EarnKit', live: true }, 6, ['base', 'codes']), "You've shipped 6 weeks in a row and EarnKit is live.");
  // Fix round 1 (T2-4): mid-gap, the first remaining step, never "Want the steps?".
  assert.equal(gapStillReply('Base Builder Grant Program', qualifyGapSteps(['codes']), false, "You're live on Base.").show_to_builder,
    `Still on Base Builder Grant: add Base's Builder Code to your app, a one-line tag Base uses to see your traffic. Guide: ${GUIDE} You're live on Base. Want me to do it now?`);
  assert.ok(gapStillReply('Base Builder Grant Program', qualifyGapSteps(['codes']), true, null).show_to_builder.endsWith('Want help with it now?'));
  assert.equal(blanksAsk(FOUNDER_BLANKS), A_BLANKS);
  assert.equal(blanksAsk(['your Telegram username']), "One blank only you can fill: your Telegram username. Reply with it and I'll finish it.");
  const d = draftReply(['From your ship log:', '6 weeks in a row', 'Page: earnkit.com/jenilt'], FOUNDER_BLANKS);
  assert.equal(d, `Here's your draft:\n\nFrom your ship log:\n6 weeks in a row\nPage: earnkit.com/jenilt\n\n${A_BLANKS}`);
  assert.doesNotMatch(d, BAD);
});

test("draftBlanks (fix round 2, F1): a founder brief for a16z; Base's blanks are what neither EarnKit holds nor the agent drafts, at most 2", () => {
  const a16z = committedProgram('a16z-speedrun');
  assert.deepEqual(draftBlanks(a16z, {}), { brief: true, blanks: [...FOUNDER_BLANKS], later: [], drafted: [] });
  const base = { ...committedProgram('base-builder-grants'), investment: false };
  // Nothing held: the team and the usage numbers now, the demo and the Builder Code later; contact details never.
  const b = draftBlanks(base, {});
  assert.deepEqual(b.blanks, ['a note on the founding team', 'your key usage numbers']);
  assert.deepEqual(b.later, ['a Loom product demo', 'your Base Builder Code']);
  // The agent drafts the narrative fields, marked for the builder to check.
  assert.deepEqual(b.drafted, ['How does your product make money today?', "What's your GTM plan for the next 3 months?",
    'What is the primary challenge or bottleneck you are currently facing as you grow your project?', 'Which credits would be most useful for you as you build? (e.g. Privy, AWS, etc.)']);
  // EarnKit holds the confirmed Builder Code and verified usage: the team and the demo are the blanks.
  const held = draftBlanks(base, { builder_code: 'bc_abc', usage_numbers: 'Used by 40 people in the last 30 days, verified onchain' });
  assert.deepEqual(held.blanks, ['a note on the founding team', 'a Loom product demo']);
  assert.deepEqual(held.later, []);
  // Fix round 3 (4): "code" only as a code the builder supplies; a held payout wallet is no blank.
  const fields = (rs: { key: string; label: string; type?: string }[]) => ({ investment: false, submission_requirements: rs.map((r) => ({ ...r, required: true, from: 'builder' as const, kind: 'other', todo: r.label.toLowerCase() })) });
  const f = draftBlanks(fields([{ key: 'codebase', label: 'Describe your codebase and source code' }, { key: 'referral', label: 'Referral code' }, { key: 'payout_wallet', label: 'Payout wallet' }]), {});
  assert.deepEqual(f.blanks, ['referral code', 'payout wallet']);
  assert.deepEqual(f.drafted, ['Describe your codebase and source code']);
  assert.deepEqual(draftBlanks(fields([{ key: 'payout_wallet', label: 'Payout wallet' }]), { payout_wallet: '0xabc' }).blanks, []);
  // F9: one list style at any count; F5: the re-ask and the ready line.
  assert.equal(blanksAsk(['a', 'b', 'c']), "Three blanks only you can fill: a, b, and c. Reply with them and I'll finish it.");
  assert.equal(blanksAgain(['a note on the founding team', 'a Loom product demo']), 'I need a note on the founding team, and a Loom product demo to finish it. Reply with them.');
});

test('the draft notes (fix round 2, F7, F8): the guard always; with no verified record, never invented traction', () => {
  for (const n of [founderBriefNote('a16z speedrun SR008', 'k', { record: false }), questionsDraftNote('p', 'k', { record: false })]) {
    assert.match(n, /Never tell them they qualify or that an application was sent\./);
    assert.match(n, /no verified record for them yet, so leave traction out and never invent it/);
    assert.doesNotMatch(n, /verified record below/);
  }
  assert.match(founderBriefNote('a16z speedrun SR008', 'k', { record: true }), /from the verified record below/);
});

/** Only these programs open (and Base Builder Grants reopened when named): this file's tests close others. */
async function only(ids: string[]) {
  await sql()`UPDATE programs SET status = 'closed' WHERE NOT (id = ANY(${ids}::text[]))`;
  await sql()`UPDATE programs SET status = 'active' WHERE id = ANY(${ids}::text[])`;
}
const noteOf = (r: R) => String(r.reply?.agent_note ?? '');
const tell = (b: { ctx: unknown }, move_up: Record<string, unknown>) => mcpCall(b.ctx as never, 'tell', { move_up });

test('"sure" on the hook gives a draft with the verified record and A\'s two blanks; the path is at draft', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants']);
  const b = await owner('dr');
  assert.equal(moveUp(await find(b))?.kind, 'apply');
  const r = await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes' });
  const s = show(r);
  const parts = s.split('\n\n');
  assert.equal(parts[0], "Here's your draft:", s);
  // The verified record (ship-log-facts.ts shipLogBlock): the streak, the live link, the page link.
  assert.match(parts[1], /^From your ship log:\n/, s);
  assert.match(parts[1], /\n6 weeks in a row\n/, s);
  // Exactly the page's facts, nothing invented (a live link and revenue only when the page shows them).
  assert.equal(parts[1], shipLogBlock((await shipLogFacts(b.id, new Date()))!).join('\n'));
  assert.match(parts[1], new RegExp(`\\nPage: \\S*${b.handle}$`, 'i'), s);
  assert.equal(parts.at(-1), A_BLANKS);
  assert.equal(parts.length, 3, s);
  assert.doesNotMatch(s, BAD);
  // The agent writes the founder brief from the record (a16z's questions aren't public), then follows the mentor note.
  assert.match(noteOf(r), /founder brief/);
  assert.ok(noteOf(r).endsWith(MENTOR_NOTE), noteOf(r));
  assert.equal((r.reply?.lead as { program_id: string }).program_id, sr.id);
  const seen = await seenOf(b.id);
  assert.deepEqual({ ...(seen.path as object), at: undefined }, { stage: 'draft', program_id: sr.id, at: undefined });
  assert.ok((seen.apply_yes as Record<string, string>)[sr.id], 'drafted');
  // A no to the draft parks the program too (a no at any stage).
  assert.equal((seen.bench_ask as { kind: string; path: boolean }).path, true);
  assert.deepEqual((seen.bench_ask as { blanks: string[] }).blanks, [...FOUNDER_BLANKS]);
  assert.match(noteOf(r), /Never tell them they qualify or that an application was sent\./);
  // F5: a bare "ok" with the blanks still empty re-asks them, and the ask stays.
  const ok = await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes' });
  assert.equal(show(ok), "I need who's on the team, and any money you've raised to finish it. Reply with them.");
  // Fix round 3 (1): a yes carrying their answers never re-asks: the blanks are cleared (the words never stored).
  // Task 3: that same reply is the submit stage (target A, "just me, nothing raised").
  const answered = await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes', blanks: 'just me, nothing raised' });
  assert.match(show(answered), /^Done, it's ready to paste\. Submit at https:\/\/speedrun\.a16z\.com\/apply before /, show(answered));
  assert.match(noteOf(answered), /answered the blanks/);
  const after = (await seenOf(b.id)).bench_ask as { blanks?: string[]; submit: boolean };
  assert.equal(after.submit, true);
  assert.doesNotMatch(JSON.stringify(await seenOf(b.id)), /nothing raised/);
  assert.equal(((await seenOf(b.id)).path as { stage: string }).stage, 'submit');
});

test("the Base gap (fix round 2, F10): the hook offers to add Builder Codes; a yes is the agent's; mid-gap the step again; confirmed in the code, A's draft offer", db, async () => {
  await only(['base-builder-grants']);
  const b = await owner('bg');
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'declined' WHERE builder_id = ${b.id}`;
  // Claude Code has the folder and Builder Codes are the one gap: the hook offers to do it (no separate steps turn).
  const hook = await find(b);
  assert.match(show(hook), new RegExp(`^Jenil, Base Builder Grant pays up to \\$5,000\\. [^\\n]*Builder Codes[^\\n]*\\n\\n${OFFER.replace(/[.?]/g, '\\$&')}$`), show(hook));
  assert.equal(moveUp(hook)?.kind, 'qualify');
  // "Go?" yes: the agent adds them, pushes, then calls find (the mentor note's do-it-then-find).
  const go = await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' });
  assert.match(show(go), /^Adding Builder Codes to EarnKit/, show(go));
  // Fix round 0 (8): it ends in the path's next easy reply ("ok", stored as the re-check ask: its yes checks the code).
  assert.ok(show(go).endsWith(`\n\n${PUSHED_ASK}`), show(go));
  assert.equal(show(go).split('\n\n').length, 2, show(go));
  const ok = (await seenOf(b.id)).bench_ask as { kind: string; checking?: boolean; path?: boolean; program_id?: string };
  assert.deepEqual([ok.kind, ok.checking, ok.path, ok.program_id], ['qualify', true, true, 'base-builder-grants']);
  assert.match(noteOf(go), /commit and push it .* and call find/);
  assert.ok(noteOf(go).endsWith(MENTOR_NOTE), noteOf(go));
  assert.deepEqual({ ...((await seenOf(b.id)).path as object), at: undefined }, { stage: 'gap', program_id: 'base-builder-grants', at: undefined });
  // Not pushed yet: find re-checks (the stored answer is older than the yes), sees none: the step again (T2-4).
  b.gh.repos[b.key].files = { 'src/app.ts': 'export const x = 1;' };
  (b.ctx as { codesFetch?: typeof fetch }).codesFetch = b.gh;
  const still = await find(b);
  assert.equal(show(still), `Still on Base Builder Grant: add Base's Builder Code to your app, a one-line tag Base uses to see your traffic. Guide: ${GUIDE} You're live on Base. Want me to do it now?`);
  assert.equal(moveUp(still)?.kind, 'qualify');
  assert.equal(still.reply?.note, PATH_NOTE);
  // F2: no new yes, so no new check: still the step.
  assert.ok(show(await find(b)).startsWith('Still on Base Builder Grant: '));
  // Pushed now; its yes stamps a new yes, so find checks again and they're confirmed.
  b.gh.repos[b.key].files = { 'src/codes.ts': `export const SUFFIX = '0x046d617961000a${BUILDER_CODES_SUFFIX}'; Attribution.toDataSuffix({ codes: ['bc_earnkit'] });` };
  assert.match(show(await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' })), /^Adding Builder Codes to EarnKit/);
  const done = await find(b);
  assert.equal(show(done), A_CODES_IN_PROOF);
  assert.equal(moveUp(done)?.kind, 'apply');
  assert.equal(done.reply?.note, PATH_NOTE);
  const seen = await seenOf(b.id);
  assert.deepEqual({ ...(seen.path as object), at: undefined }, { stage: 'draft', program_id: 'base-builder-grants', at: undefined });
  // Its yes is the Base draft: EarnKit fills the confirmed Builder Code; contact details wait for submit; at most 2 blanks.
  const dr = await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes' });
  const draft = show(dr);
  assert.ok(draft.startsWith("Here's your draft:\n\nFrom your ship log:"), draft);
  assert.equal(draft.split('\n\n').at(-1), "Two blanks only you can fill: a note on the founding team, and your key usage numbers. Reply with both and I'll finish it.");
  assert.match(noteOf(dr), /EarnKit already holds these, use them as given: builder_code: bc_earnkit\./);
  assert.match(noteOf(dr), /mark these as drafted for them to check: How does your product make money today\?/);
  // Fix round 3 (1): prepare with their answers (coach_asked) answers the blanks: a yes after it never re-asks.
  await mcpCall(b.ctx as never, 'prepare', { program_id: 'base-builder-grants', project: { name: 'EarnKit', repo_url: `https://github.com/${b.key}` }, coach_asked: true });
  assert.deepEqual(((await seenOf(b.id)).bench_ask as { blanks: string[] }).blanks, []);
  assert.doesNotMatch(show(await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes' })), /^I need/);
});

test('fix round 2 (F3): a slow re-check answers "I\'m checking the code now..." and goes on in the background', db, async () => {
  await only(['base-builder-grants']);
  const b = await owner('bk');
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'declined' WHERE builder_id = ${b.id}`;
  await find(b);
  await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' });
  b.gh.repos[b.key].files = { 'src/codes.ts': `export const SUFFIX = '0x046d617961000a${BUILDER_CODES_SUFFIX}'; Attribution.toDataSuffix({ codes: ['bc_earnkit'] });` };
  const slow = (async (...a: Parameters<typeof fetch>) => {
    await new Promise((r) => setTimeout(r, 150));
    return b.gh(...a);
  }) as typeof fetch;
  (b.ctx as { codesFetch?: typeof fetch }).codesFetch = slow;
  const wait = RECHECK_WAIT.ms;
  RECHECK_WAIT.ms = 20;
  try {
    const r = await find(b);
    assert.equal(show(r), "I'm checking the code now. Give it a minute, then say ok.");
    assert.ok(String(r.reply?.note).startsWith(`${PATH_ANSWER_FIRST} When they say ok, call tell`), String(r.reply?.note));
    // Fix round 3 (5): its own ask: a no would park Base; an ok re-checks, never "add the codes" again.
    const ask = (await seenOf(b.id)).bench_ask as { kind: string; path: boolean; checking: boolean };
    assert.deepEqual([ask.kind, ask.path, ask.checking], ['qualify', true, true]);
    assert.equal(moveUp(r)?.kind, 'qualify');
  } finally {
    RECHECK_WAIT.ms = wait;
  }
  await codesSettled();
  // Task 4 fix round 1 (3): the ok runs find in the same tell: its reply, never an empty one.
  const ok = await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' });
  assert.doesNotMatch(show(ok) + noteOf(ok), /Adding Builder Codes|add Base's Builder Code/);
  assert.equal(show(ok), A_CODES_IN_PROOF);
});

test('fix round 2 (F4): another grant\'s steps are only its unmet gaps, never the program file\'s setup items', db, async () => {
  await only(['base-builder-grants']);
  const b = await owner('f4s');
  const ask = { kind: 'check_fits', key: b.key, program_id: 'arc-microgrants', program: 'Arc Microgrants: Built with Arc', needs: ['on Arc mainnet'], name: 'EarnKit', path: true };
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('bench_ask', ${sql().json(ask as never)}::jsonb) WHERE builder_id = ${b.id}`;
  const r = await tell(b, { kind: 'check_fits', project_key: b.key, answer: 'yes' });
  assert.match(show(r), /^Your next step toward Arc Microgrants:\n1\. Get EarnKit on Arc mainnet\.\n\n[^\n]+ Want help with it now\?$/, show(r));
});

test('F3: a hosted agent gets the steps to do itself, nothing marked; its no parks Base', db, async () => {
  await only(['base-builder-grants']);
  const b = await owner('bh');
  await sql()`UPDATE builder_profiles SET standing_seen = (standing_seen - 'declined') || '{"no_folder": true}'::jsonb WHERE builder_id = ${b.id}`;
  assert.equal(moveUp(await find(b))?.kind, 'qualify');
  const steps = await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' });
  assert.equal(show(steps), `Your next step toward Base Builder Grant:\n1. Add Base's Builder Code to your app, a one-line tag Base uses to see your traffic. Guide: ${GUIDE}\n\nYou're live on Base. Want help with it now?`);
  // Its yes: the agent walks them through it (never "here in this folder"), then calls find.
  const help = await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' });
  assert.match(noteOf(help), /in short plain steps they can do themselves.*then call find/);
  assert.doesNotMatch(noteOf(help), /this folder|in their code here/);
  // Fix round 3 (7): the hosted yes stamps gap_did too, so the next find re-checks the code.
  assert.ok(((await seenOf(b.id)).gap_did as Record<string, string>)['base-builder-grants']);
  // The next find mid-gap: the step again with the help ask (fix round 1, T2-4); a no to it parks Base.
  const still = await find(b);
  assert.match(show(still), /^Still on Base Builder Grant: add Base's Builder Code .* Want help with it now\?$/, show(still));
  assert.doesNotMatch(show(still), /I can do this|Want the steps\?/);
  await tell(b, { kind: 'qualify', project_key: b.key, answer: 'no' });
  assert.ok(((await seenOf(b.id)).declined as Record<string, string>)['path:base-builder-grants']);
  assert.doesNotMatch(show(await find(b)), /Base Builder Grant|Builder Codes/);
});

test('a no parks the program and the next find hooks the next program; a no at the gap parks that one too', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants']);
  const b = await owner('nx');
  // One older moment already said this session, so the closest grant is never put behind one (fix round 2, F1).
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('said', jsonb_build_object('at', now()::text, 'keys', '["older"]'::jsonb)) WHERE builder_id = ${b.id}`;
  assert.ok(show(await find(b)).includes(sr.title));
  await tell(b, { kind: 'apply', project_key: b.key, answer: 'no' });
  // The next bestMove program: Base, whose passed step is raised once as its one gap.
  const next = await find(b);
  assert.match(show(next), /^Jenil, your closest money is Base Builder Grant: up to \$5,000\. /, show(next));
  assert.equal(moveUp(next)?.kind, 'qualify');
  // F10: the hook offers to add them; its yes is the agent's; the next find is the step again, and a no to it parks Base.
  assert.ok(show(next).endsWith(OFFER), show(next));
  assert.match(show(await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' })), /^Adding Builder Codes/);
  assert.ok(show(await find(b)).startsWith('Still on Base Builder Grant: '));
  await tell(b, { kind: 'qualify', project_key: b.key, answer: 'no' });
  const declined = (await seenOf(b.id)).declined as Record<string, string>;
  assert.ok(declined[`path:${sr.id}`] && declined['path:base-builder-grants'], JSON.stringify(declined));
  const after = show(await find(b));
  assert.doesNotMatch(after, /speedrun|Base Builder Grant/, after);
});

// ---------------------------------------------------------------------------------------------------------------------
// v4.8 Task 3: submit, track and the next program; the fresh session's "Since {day}".

/** Target conversation A, exact (the facts filled from a16z's program file, the test clock at 2026-10-31 19:00Z). */
const A_SUBMIT = `Done, it's ready to paste. Submit at https://speedrun.a16z.com/apply before tomorrow 11:59 PM PT. The form also asks for your email.\n\n${SENT_ASK}`;

test('the submit stage, the pointer and the track lead (pure): target A word for word, the deadline in the program\'s zone', () => {
  assert.equal(SENT_ASK, 'Reply "sent" once it\'s in, and I\'ll keep track of it for you.');
  const by = submitBy('2026-11-02T07:59:59Z', PT, NOW, 'PT');
  assert.equal(by, 'tomorrow 11:59 PM PT');
  assert.equal(submitBy('2026-11-01T06:59:59Z', PT, NOW, 'PT'), 'today 11:59 PM PT');
  assert.equal(submitBy('2026-11-06T07:59:59Z', PT, NOW, 'PT'), 'Nov 5 11:59 PM PT');
  // A zone with no short name: the day only, never a time read in the wrong zone.
  assert.equal(submitBy('2026-11-06T07:59:59Z', 'Asia/Kolkata', NOW, null), 'Nov 6');
  assert.equal(submitReply({ link: 'https://speedrun.a16z.com/apply', by, contacts: ['your email'] }), A_SUBMIT);
  assert.equal(submitReply({ link: 'https://base.org/apply', by: null, contacts: [] }), `Done, it's ready to paste. Submit at https://base.org/apply.\n\n${SENT_ASK}`);
  assert.equal(submitPointer({ title: 'a16z speedrun SR008', when: 'closes Nov 1', ends_at: '2026-11-02T07:59:59Z', zone: PT }, NOW),
    'Your a16z speedrun SR008 application is ready to submit, closes tomorrow night. Reply "sent" once it\'s in.');
  assert.equal(submitPointer({ title: 'Base Builder Grant Program', when: 'rolling', ends_at: null, zone: 'UTC' }, NOW),
    'Your Base Builder Grant application is ready to submit. Reply "sent" once it\'s in.');
  // Odds only as the program file states them; none: the acknowledgement alone.
  assert.equal(trackLead(A16Z.odds, true), "Nice, I'm tracking it. Speedrun says fewer than 0.4% of applicants are accepted, so let's line up money that's closer.");
  assert.equal(trackLead(null, true), TRACK_ACK);
  assert.equal(trackLead(A16Z.odds, false), "Nice, I'm tracking it. Speedrun says fewer than 0.4% of applicants are accepted.");
  for (const t of [A_SUBMIT, trackLead(A16Z.odds, true)]) assert.doesNotMatch(t, BAD);
});

test('the passed-step line and "Since {day}" (pure): stored changes only; nothing changed, nothing said', () => {
  assert.equal(agoWords('2026-10-31T09:00:00Z', NOW), 'earlier today');
  assert.equal(agoWords('2026-10-30T09:00:00Z', NOW), 'yesterday');
  assert.equal(agoWords('2026-10-27T09:00:00Z', NOW), 'on Tuesday');
  assert.equal(agoWords('2026-10-22T09:00:00Z', NOW), 'last week');
  assert.equal(agoWords('2026-10-03T09:00:00Z', NOW), 'on Oct 3');
  assert.equal(passedLine('2026-10-22T09:00:00Z', NOW), "You passed on it last week, but it's now the only gap to that money.");
  assert.equal(passedLine('2026-10-22T09:00:00Z', NOW, true), "You passed on them last week, but they're now the only gap to that money.");
  const raised = pathReply({ now: NOW, first: null, project: { name: 'EarnKit', live: true }, streak: 6, move: { kind: 'closest', program: { ...BASE, passedAt: '2026-10-22T09:00:00Z' }, raise: true }, said: new Set() });
  assert.match(raised.show_to_builder, /add Builder Codes\. You passed on them last week, but they're now the only gap to that money\. /);
  // Not raised (a step not passed on): no such line.
  assert.doesNotMatch(pathReply({ now: NOW, first: null, project: { name: 'EarnKit', live: true }, streak: 6, move: { kind: 'one_step', program: { ...BASE, passed: false } }, said: new Set() }).show_to_builder, /passed/);
  const thu = '2026-10-29T15:00:00Z';
  assert.equal(sinceLine({ last: thu, streak: { before: 6, now: 7 }, score: { before: 77, now: 79 } }, NOW), 'Since Thursday: 1 more week shipped, so your streak is 7 weeks and your score is up to 79.');
  assert.equal(sinceLine({ last: thu, score: { before: 80, now: 79 } }, NOW), 'Since Thursday: your score is down to 79.');
  assert.equal(sinceLine({ last: '2026-10-20T15:00:00Z', opened: ['Base Batches'], closing: { program: 'a16z speedrun SR008', when: 'tomorrow 11:59 PM PT' } }, NOW),
    'Since Oct 20: Base Batches opened. a16z speedrun SR008 closes tomorrow 11:59 PM PT.');
  // Nothing changed (or a side not stored): no line.
  assert.equal(sinceLine({ last: thu, streak: { before: 6, now: 6 }, score: null, opened: [], closing: null }, NOW), null);
  assert.equal(sinceLine({ last: thu, streak: null, score: { before: 79, now: 79 } }, NOW), null);
});

test('"sent" records the program as applied and hooks Base in the same reply, with the passed-step line said once', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants']);
  const b = await owner('snt');
  assert.equal(moveUp(await find(b))?.kind, 'apply');
  await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes' });
  // "just me, nothing raised": the submit stage, the deadline in the program's own zone, the email typed on the form.
  const sub = await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes', blanks: 'just me, nothing raised' });
  const by = submitBy(sr.ends.toISOString(), PT, new Date(), 'PT');
  assert.equal(show(sub), `Done, it's ready to paste. Submit at https://speedrun.a16z.com/apply before ${by}. The form also asks for your email.\n\n${SENT_ASK}`);
  assert.match(noteOf(sub), /program_status: \[\{ program_id, status: 'applied' \}\]/);
  assert.ok(noteOf(sub).endsWith(MENTOR_NOTE));
  assert.deepEqual({ ...((await seenOf(b.id)).path as object), at: undefined }, { stage: 'submit', program_id: sr.id, at: undefined });
  // A find before "sent": one line pointing back, never the draft again.
  const point = await find(b);
  assert.match(show(point), new RegExp(`^Your ${sr.title} application is ready to submit, closes [^.]+\\. Reply "sent" once it's in\\.$`), show(point));
  assert.equal(moveUp(point)?.kind, 'apply');
  // "sent": told applied, and the same reply hooks the next program.
  const sent = await mcpCall(b.ctx as never, 'tell', { program_status: [{ program_id: sr.id, status: 'applied' }] });
  const s = show(sent);
  const [lead, hook, ask] = s.split('\n\n');
  assert.equal(lead, "Nice, I'm tracking it. Speedrun says fewer than 0.4% of applicants are accepted, so let's line up money that's closer.", s);
  assert.match(hook, /^Your closest money is Base Builder Grant: up to \$5,000\. [^\n]*Builder Codes[^\n]*\. You passed on them earlier today, but they're now the only gap to that money\./, s);
  assert.equal(ask, OFFER, s);
  assert.equal(s.split('\n\n').length, 3, s);
  assert.doesNotMatch(s, BAD);
  assert.equal(moveUp(sent)?.kind, 'qualify');
  assert.equal(sent.reply?.note, PATH_NOTE);
  const [row] = await sql()<{ status: string }[]>`SELECT status FROM builder_program_status WHERE installation_id = ${b.id} AND program_id = ${sr.id}`;
  assert.equal(row?.status, 'applied');
  const seen = await seenOf(b.id);
  assert.equal((seen.path as { program_id: string }).program_id, 'base-builder-grants');
  assert.ok((seen.path_raised as Record<string, string>)['base-builder-grants']);
  // Applied programs are never hooked again; the passed-step line is never said twice.
  // Fix round 1 (1): the same step again this session is its one-line pointer with its easy reply; the stored ask stays.
  for (let i = 0; i < 2; i++) {
    const again = await find(b);
    assert.equal(show(again), `Builder Codes are still the one step to Base Builder Grant. ${CODES_OFFER}`);
    assert.equal(moveUp(again)?.kind, 'qualify');
    const ask = (await seenOf(b.id)).bench_ask as { kind: string; program_id: string };
    assert.deepEqual([ask.kind, ask.program_id], ['qualify', 'base-builder-grants']);
  }
});

test('fix round 1 (2): a plain yes to the submit ask is never "sent"; answer "sent" is; a no parks the program and the pointer stops', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants']);
  const b = await owner('sny');
  await find(b);
  await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes' });
  await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes', blanks: 'just me, nothing raised' });
  const applied = async (id: number) => (await sql()<{ status: string }[]>`SELECT status FROM builder_program_status WHERE installation_id = ${id} AND program_id = ${sr.id}`)[0]?.status;
  const ok = await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes' });
  assert.equal(show(ok), 'Once it\'s submitted, reply "sent" and I\'ll keep track of it.');
  assert.equal(await applied(b.id), undefined);
  assert.equal(((await seenOf(b.id)).bench_ask as { submit?: boolean }).submit, true);
  const sent = await tell(b, { kind: 'apply', project_key: b.key, answer: 'sent' });
  assert.ok(show(sent).startsWith("Nice, I'm tracking it. Speedrun says"), show(sent));
  assert.equal(await applied(b.id), 'applied');
  // Another builder: a no to "sent" parks it; the next find never points back to it.
  const c = await owner('snn');
  await find(c);
  await tell(c, { kind: 'apply', project_key: c.key, answer: 'yes' });
  await tell(c, { kind: 'apply', project_key: c.key, answer: 'yes', blanks: 'just me, nothing raised' });
  await tell(c, { kind: 'apply', project_key: c.key, answer: 'no' });
  assert.doesNotMatch(show(await find(c)), /speedrun|ready to submit/);
});

/** A builder at submit on `sr` (hook, draft, the blanks answered). */
async function atSubmit(tag: string) {
  const b = await owner(tag);
  await find(b);
  await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes' });
  await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes', blanks: 'just me, nothing raised' });
  return b;
}
const backSession = (id: number, ms: number) =>
  sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('said', jsonb_build_object('at', ${new Date(Date.now() - ms).toISOString()}::text,
    'keys', COALESCE(standing_seen->'said'->'keys', '[]'::jsonb))) WHERE builder_id = ${id}`;

test('fix round 1 (3): "sent" keeps the other replies of the same tell; the path reply is last', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants']);
  const b = await atSubmit('snm');
  const r = await mcpCall(b.ctx as never, 'tell', { card: 'skip', program_status: [{ program_id: sr.id, status: 'applied' }] });
  const s = show(r);
  assert.ok(s.startsWith('Skipped.\n'), s);
  assert.match(s, /Nice, I'm tracking it\. Speedrun says/);
  assert.ok(s.endsWith(OFFER), s);
  assert.equal(moveUp(r)?.kind, 'qualify');
  assert.ok(String(r.reply?.agent_note ?? r.reply?.note).length > 0);
});

test('fix round 1 (10, 11): "sent" with no next program still ends in one easy reply; no stated odds: the acknowledgement alone', db, async () => {
  const sr = await speedrun(30, { noOdds: true });
  await only([sr.id]);
  const b = await atSubmit('snq');
  const r = await mcpCall(b.ctx as never, 'tell', { program_status: [{ program_id: sr.id, status: 'applied' }] });
  const s = show(r);
  assert.ok(s.startsWith(`${TRACK_ACK}\n\n`), s);
  assert.notEqual(s, TRACK_ACK);
  assert.ok(s.trim().endsWith('?'), s);
  assert.ok(moveUp(r)?.kind, JSON.stringify(r.reply));
  assert.doesNotMatch(s, BAD);
  // Fix round 1 (9): left at track with no next program, the path is no longer mid-path.
  assert.equal(((await seenOf(b.id)).path as { stage: string }).stage, 'track');
});

test('fix round 1 (11): "sent" in a fresh session: the lead, then the next hook (no invented change)', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants']);
  await sql()`UPDATE programs SET opened_at = now() WHERE id = 'base-builder-grants'`;
  const b = await atSubmit('snf');
  await backSession(b.id, SESSION_MS + 60_000);
  const s = show(await mcpCall(b.ctx as never, 'tell', { program_status: [{ program_id: sr.id, status: 'applied' }] }));
  const parts = s.split('\n\n');
  assert.ok(parts[0].startsWith("Nice, I'm tracking it."), s);
  assert.equal(parts.at(-1), OFFER, s);
  // Base was passed on before (seen), so its reopening is no news.
  assert.doesNotMatch(s, /opened/, s);
});

test('fix round 1 (5, 11): "Since" says "opened" only for a program new to this builder; a missing or bad last session says nothing', db, async () => {
  await only([]);
  const b = await owner('sno');
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'path' - 'bench_ask' - 'said' WHERE builder_id = ${b.id}`;
  // No last session: no "Since".
  const sr = await speedrun(30);
  assert.doesNotMatch(show(await find(b)), /^Since /);
  // A bad last session: none either.
  await sql()`UPDATE builder_profiles SET standing_seen = (standing_seen - 'path' - 'bench_ask') || '{"said": {"at": "garbage", "keys": []}}'::jsonb WHERE builder_id = ${b.id}`;
  assert.doesNotMatch(show(await find(b)), /^Since /);
  // A program that opened after the last session, never seen: it leads.
  const c = await owner('snp');
  await sql()`UPDATE programs SET status = 'closed' WHERE id = ${sr.id}`;
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'path' - 'bench_ask' - 'apply_asked' WHERE builder_id = ${c.id}`;
  await backSession(c.id, 3 * 3_600_000);
  await speedrun(30);
  const s = show(await find(c));
  assert.ok(s.startsWith(`Since earlier today: ${programName(sr.title)} opened.\n\nJenil, ${sr.title} closes `), s);
  // Reopened while the builder is on it (at submit): no "opened" (programs.opened_at alone is no news).
  const d = await atSubmit('snr');
  await backSession(d.id, 3 * 3_600_000);
  await sql()`UPDATE programs SET opened_at = now() WHERE id = ${sr.id}`;
  const p = show(await find(d));
  assert.match(p, new RegExp(`^Your ${sr.title} application is ready to submit`), p);
});

test('fix round 1 (6, 11): an announced result is said once (the alerts opener); a close within 48 hours as the submit step says it', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants']);
  const b = await owner('snw');
  await sql()`INSERT INTO projects (program_id, name, installation_id, confirmed_at, submitted_at) VALUES ('base-builder-grants', 'EarnKit', ${b.id}, now(), now() - interval '20 days')`;
  await sql()`INSERT INTO entry_outcomes (project_id, program_id, round_label, result, basis, captured_at)
    SELECT id, 'base-builder-grants', 'r1', 'won', 'announcement', now() FROM projects WHERE installation_id = ${b.id} AND program_id = 'base-builder-grants'`;
  await sql()`UPDATE programs SET status = 'closed' WHERE id = 'base-builder-grants'`;
  await backSession(b.id, 3 * 3_600_000);
  // The announced result leads find already (the alerts opener, "Since you last checked: ..."); the path's "Since"
  // never says it a second time.
  const s = show(await find(b));
  assert.match(s, /won in Base Builder Grant/, s);
  assert.equal(s.match(/won/g)?.length, 1, s);
  // A mid-gap program closing within 48 hours: the absolute close in its own zone.
  await sql()`UPDATE programs SET status = 'closed' WHERE id NOT LIKE ${`v48-${process.pid}-arcd`}`;
  const arc = committedProgram('arc-microgrants-studio', { keepContract: true });
  const ap = ProgramFile.parse({ ...arc, id: `v48-${process.pid}-arcd`, title: `Arc Due ${RUN}`, ends_at: new Date(Date.now() + 20 * 3_600_000).toISOString(), status: 'active', starts_at: null });
  await upsertProgram(ap);
  const c = await owner('snd');
  await find(c);
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('path', jsonb_build_object('stage', 'gap', 'program_id', ${ap.id}::text, 'at', now()::text)) WHERE builder_id = ${c.id}`;
  await backSession(c.id, 3 * 3_600_000);
  const g = show(await find(c));
  assert.match(g, new RegExp(`^Since earlier today: Arc Due ${RUN} closes (today|tomorrow) \\d{1,2}:\\d{2} (AM|PM) ET\\.\\n\\nStill on Arc Due ${RUN}: `), g);
});

test('a new session after more shipping opens with "Since ...", the streak and score change, then the Base draft offer', db, async () => {
  await only(['base-builder-grants']);
  // Open for a month (only() reopened it just now in this file's database).
  await sql()`UPDATE programs SET opened_at = now() - interval '30 days' WHERE id = 'base-builder-grants'`;
  const b = await owner('snc');
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'declined' WHERE builder_id = ${b.id}`;
  // The page's score now: 79 (a listed Shipping row).
  await sql()`UPDATE builder_live SET score = 79, ranked = true, calibration = ${'v2-shipping'}, parts = ${sql().json({ shipping: { points: 79, raw: { mask: 1, live_ships: 0 } } } as never)} WHERE builder_id = ${b.id}`;
  // Base's gap closed in the last session: Builder Codes added and confirmed, the draft offered (path at draft).
  await find(b);
  b.gh.repos[b.key].files = { 'src/codes.ts': `export const SUFFIX = '0x046d617961000a${BUILDER_CODES_SUFFIX}'; Attribution.toDataSuffix({ codes: ['bc_earnkit'] });` };
  (b.ctx as { codesFetch?: typeof fetch }).codesFetch = b.gh;
  await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' });
  assert.equal(show(await find(b)), A_CODES_IN_PROOF);
  // The builder said nothing; the last session was 8 days ago (the week before), when the score was 77 and the streak
  // one week shorter (this week's commits came since).
  const last = new Date(Date.now() - 8 * 86_400_000);
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{said,at}', to_jsonb(${last.toISOString()}::text)) WHERE builder_id = ${b.id}`;
  await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held, ranked)
    VALUES (${b.id}, ${last.toISOString().slice(0, 10)}::date, 77, 0, '{}'::jsonb, '{}'::jsonb, 'v2', 'v2-shipping', false, true) ON CONFLICT (builder_id, day) DO UPDATE SET score = 77`;
  const r = await find(b);
  const s = show(r);
  const day = last.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const standing = String(r.reply?.standing ?? '');
  const score = /^Score 79\b/.test(standing) ? ' and your score is up to 79' : '';
  assert.equal(s, `Since ${day}: 1 more week shipped, so your streak is 6 weeks${score}. Base Builder Grant is still open and you now meet its first requirement.\n\nDraft it now? It takes me a few minutes.`);
  assert.ok(score, `the page's score: ${standing}`);
  assert.equal(moveUp(r)?.kind, 'apply');
  assert.equal(r.reply?.note, PATH_NOTE);
  assert.doesNotMatch(s, BAD);
  // Said once: the next find in this session is the step's pointer, never "Since" again.
  assert.doesNotMatch(show(await find(b)), /^Since /);
  // Nothing changed since the last session: the step alone.
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{said,at}', to_jsonb(${new Date(Date.now() - SESSION_MS - 1000).toISOString()}::text)) WHERE builder_id = ${b.id}`;
  assert.equal(show(await find(b)), A_CODES_IN_PROOF);
});

/*
 * v4.8 Task 4: the new builder (target conversation B). Before GitHub is connected, the first reply names three open
 * programs (the top grant by money, the best rolling grant, the soonest investor program) with one link; a number or a
 * program name is stored as the path's program; the first reply after connecting is the profile and tracking line, then
 * the pick's fit (or why not, in one line, and the closest money).
 */
const OPENER_TAIL = (link: string) => `Reply with a number, and connect here so I can check if your work fits: ${link}`;
test('the opener, the pick and the connected line (pure): target B, one link, never a claim they qualify', () => {
  const list = [
    { id: 'circle-developer-grants', title: 'Circle Developer Grants', amount: '$5K to $100K', when: 'rolling', investment: false },
    { id: 'base-builder-grants', title: 'Base Builder Grant Program', amount: 'up to $5,000', when: 'rolling', investment: false },
    { id: 'a16z-speedrun', title: 'a16z speedrun SR008', amount: 'up to $1M', when: 'closes Nov 1', investment: true },
  ];
  const s = openerReply({ total: '$105K', programs: list, link: 'https://earnkit.com/signin/abc', github: false });
  assert.equal(s, [
    "I'm EarnKit. I get builders funded for what they ship, and there's $105K in grants open right now.",
    '',
    '1. Circle Developer Grants: $5K to $100K, rolling',
    '2. Base Builder Grant: up to $5,000, rolling',
    '3. a16z speedrun SR008 (investor program): up to $1M, closes Nov 1',
    '',
    OPENER_TAIL('https://earnkit.com/signin/abc'),
  ].join('\n'));
  // The repo picker's link (X sign-in off) says GitHub; with fewer programs, only those are numbered.
  const two = openerReply({ total: null, programs: list.slice(0, 2), link: 'L', github: true });
  assert.equal(two, "I'm EarnKit. I get builders funded for what they ship.\n\n1. Circle Developer Grants: $5K to $100K, rolling\n2. Base Builder Grant: up to $5,000, rolling\n\nReply with a number, and connect GitHub here so I can check if your work fits: L");
  for (const x of [s, two]) assert.doesNotMatch(x, BAD);
  // A number or a name resolves to the program shown; a number outside the list is 'outside'; anything else null.
  assert.equal(resolvePick('2', list), 'base-builder-grants');
  assert.equal(resolvePick(' #3. ', list), 'a16z-speedrun');
  assert.equal(resolvePick('circle', list), 'circle-developer-grants');
  assert.equal(resolvePick('The Base Builder Grant', list), 'base-builder-grants');
  assert.equal(resolvePick('7', list), 'outside');
  assert.equal(resolvePick('0', list), 'outside');
  assert.equal(resolvePick('something else', list), null);
  // Fix round 1 (6): a generic word, or a name more than one program holds, picks nothing (the list again).
  for (const w of ['grant', 'grants', 'Grant', 'the grant', 'program', 'investor program', 'builder', 'developer'])
    assert.equal(resolvePick(w, list), null, w);
  assert.equal(resolvePick('speedrun', list), 'a16z-speedrun');
  // The list again, in one short line, with the same one link.
  assert.equal(openerAgain(list, 'L', false), 'Reply 1 for Circle Developer Grants, 2 for Base Builder Grant or 3 for a16z speedrun SR008, and connect here so I can check if your work fits: L');
  assert.equal(pickedReply('Base Builder Grant Program', 'L', false), 'Got it: Base Builder Grant. Connect here so I can check if your work fits: L');
  // The connected line: the page, the score, "#N of M builders" only with M of 2 or more.
  const head = "Connected. I'll track every commit you push, so your profile stays current without you lifting a finger: ";
  assert.equal(connectedLine({ page: 'earnkit.com/maya', score: 54, rank: { n: 3, m: 40 } }), `${head}earnkit.com/maya, score 54, #3 of 40 builders.`);
  assert.equal(connectedLine({ page: 'earnkit.com/maya', score: 54, rank: { n: 1, m: 1 } }), `${head}earnkit.com/maya, score 54.`);
  // Fix round 0 (4): a score of 0 or none: no score and no rank, and the profile "fills in".
  const fills = "Connected. I'll track every commit you push, so your profile fills in without you lifting a finger: earnkit.com/maya.";
  assert.equal(connectedLine({ page: 'earnkit.com/maya', score: null, rank: null }), fills);
  assert.equal(connectedLine({ page: 'earnkit.com/maya', score: 0, rank: { n: 30, m: 30 } }), fills);
  assert.equal(connectedLine({ page: 'earnkit.com/maya', score: null, rank: { n: 3, m: 40 } }), fills);
  // Fix round 0 (7): a picked investor program not close yet, one line before the closest money.
  assert.equal(investorLater('a16z speedrun SR008'), "a16z speedrun SR008 is an investor program, so I'll help you prepare when it gets closer.");
  // Why a pick doesn't fit, in one line, from the program's own facts.
  assert.equal(noFitWhy('Circle Developer Grants', { chain: 'Arc', name: 'EarnKit' }), "For Circle Developer Grants: they fund apps on Arc, and EarnKit isn't on Arc yet.");
  assert.equal(noFitWhy('Arc Microgrants: Built with Arc Studio', { needs: ['on Arc mainnet', 'live at a link'], name: 'EarnKit' }), "For Arc Microgrants: EarnKit isn't on Arc mainnet, and live at a link yet.");
  assert.equal(noFitWhy('Base Builder Grant Program', { gap: 'EarnKit is one step away: add Builder Codes.', name: 'EarnKit' }), 'For Base Builder Grant: EarnKit is one step away: add Builder Codes.');
  // The closest money after a no-fit pick asks for the steps (never "Go?"), with the closest head.
  const c = pathReply({ now: NOW, first: null, project: { name: 'EarnKit', live: true }, streak: 0, move: { kind: 'closest', program: { ...BASE, passed: false }, raise: false }, said: new Set(), steps: true });
  assert.equal(c.reply, 'steps');
  assert.equal(c.show_to_builder, 'Your closest money is Base Builder Grant: up to $5,000. EarnKit is one step away: add Builder Codes. EarnKit is live.\n\nWant the steps?');
});

test('openerPrograms (pure, fix round 0 (1)): Base\'s grant (else the best rolling grant), the largest other open grant, the soonest investor program; fewer, numbered as they come', () => {
  const card = (o: Partial<Card> & { id: string }): Card => ({ title: o.id, summary: 'up to $1,000 · rolling', status: 'active', ...o } as Card);
  const circle = card({ id: 'circle', title: 'Circle Developer Grants', summary: '$5,000 to $100,000 USDC grants · rolling', max_award_usd: 100000, min_award_usd: 5000 });
  const base = card({ id: 'base', title: 'Base Builder Grant Program', summary: 'up to $5,000 · rolling', max_award_usd: 5000 });
  const dated = card({ id: 'dated', title: 'Big Grant', summary: 'up to $200,000 · closes Nov 20', max_award_usd: 200000, ends_at: new Date('2026-11-21T00:00:00Z') });
  const a16z = card({ id: 'a16z', title: 'a16z speedrun SR008', summary: 'up to $1M · closes Nov 1, 11:59 PM PT', max_award_usd: 1000000, investment: true, ends_at: new Date('2026-11-02T07:59:59Z') });
  const later = card({ id: 'later', title: 'Later Fund', summary: 'up to $500K · closes Dec 1', max_award_usd: 500000, investment: true, ends_at: new Date('2026-12-02T00:00:00Z') });
  const ids = (cs: Card[], skip: string[] = []) => openerPrograms(cs, NOW, new Set(skip)).map((p) => p.id);
  const baseId = { ...base, id: 'base-builder-grants' };
  // Target B's order: Base's grant first, then the largest other open grant (Circle), then the soonest investor program.
  assert.deepEqual(ids([circle, baseId, later, a16z]), ['base-builder-grants', 'circle', 'a16z']);
  // The largest other grant may be a dated one.
  assert.deepEqual(ids([baseId, circle, dated, a16z]), ['base-builder-grants', 'dated', 'a16z']);
  // Base's grant closed (or not shown): the best rolling grant first, then the largest other.
  assert.deepEqual(ids([circle, dated, a16z]), ['circle', 'dated', 'a16z']);
  assert.deepEqual(ids([baseId, circle, a16z], ['base-builder-grants']), ['circle', 'a16z']);
  // Fewer than three: what exists; an entered or hidden program is never numbered.
  assert.deepEqual(ids([circle, a16z]), ['circle', 'a16z']);
  assert.deepEqual(ids([]), []);
  const [b, c, a] = openerPrograms([baseId, circle, a16z], NOW, new Set());
  assert.deepEqual([c.amount, c.when, b.amount, a.amount, a.investment], ['$5K to $100K', 'rolling', 'up to $5,000', 'up to $1M', true]);
  assert.match(a.when, /^closes Nov 1$/);
});

test('pickHook (pure, fix round 1 (2)): a pick that is a move is hooked even when not first; otherwise the real top move, fits kept, investors left out', () => {
  const fitSoon = prog({ id: 'fit-soon', ends_at: '2026-11-05T00:00:00Z', when: 'closes Nov 5' });
  const fitPick = prog({ id: 'fit-pick' });
  const circle = gap('circle', []);
  const codes = gap('base', ['codes'], { doable: true, title: 'Base Builder Grant Program', amount: 'up to $5,000' });
  // (a) A real fit the builder picked, though another fit closes sooner: the pick, as a fit.
  assert.deepEqual(pickHook(ctx({ fits: [fitSoon, fitPick], grants: [codes] }), 'fit-pick'), { move: { kind: 'fit', program: fitPick }, pick: true, steps: false });
  // (b) Circle picked (no move) and a real fit exists: the fit leads (target A's order), never the gap grant.
  assert.deepEqual(pickHook(ctx({ fits: [fitSoon], grants: [circle, codes], investors: [A16Z] }), 'circle'), { move: { kind: 'fit', program: fitSoon }, pick: false, steps: false });
  // Target B: no fit; the investor program closing in 48 hours is left out (the closest money), Base's one step shown as closest.
  assert.deepEqual(pickHook(ctx({ grants: [circle, codes], investors: [A16Z] }), 'circle'), { move: { kind: 'closest', program: codes, raise: false }, pick: false, steps: true });
  // An investor program picked inside its window: the pick, its own kind.
  assert.deepEqual(pickHook(ctx({ grants: [codes], investors: [A16Z] }), A16Z.id), { move: { kind: 'now', program: A16Z }, pick: true, steps: false });
  // A grant with a gap picked: the pick (its gap hook); nothing at all: null.
  assert.equal(pickHook(ctx({ grants: [codes] }), 'base')?.pick, true);
  assert.equal(pickHook(ctx({ grants: [circle] }), 'circle'), null);
});

const X_SECRET = { ...X_ON, EARNKIT_AUTH_SECRET: process.env.EARNKIT_AUTH_SECRET || 'v48-b-secret' };
/** A new builder: installed in Claude Code, not signed in with X, no project connected (target B). */
async function newcomer(tag: string) {
  n++;
  const t = `ek_v48_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c = (await connectInstallation(t))!;
  const handle = `nb${tag}${RUN}`.slice(0, 15);
  const key = `${handle}/earnkit`;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 0, fits: [] })) as never };
  return { t, ctx, id: c.id, own: c.own, key, handle, gh: null as ReturnType<typeof fakeGitHub> | null };
}
type Newcomer = Awaited<ReturnType<typeof newcomer>>;
/** find while signed out (X sign-in on). */
const outFind = (b: Newcomer, args: Record<string, unknown> = {}) => withEnv(X_SECRET, () => mcpCall(b.ctx as never, 'find', args));
/**
 * The builder signs in with X and connects EarnKit's repo through the App (live, on Base, shipping this week), as
 * owner() does; `wallet`: setup step 3 answered already (else it is due).
 */
async function connectB(b: Newcomer, o: { wallet?: boolean } = {}) {
  assert.ok((await attachToX(b.own, { id: `49${RUN}${n}${b.handle.length}`, username: b.handle, name: 'Maya Lin', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(b.t))!;
  assert.equal(c.id, b.id, 'a new X account keeps the installation as its own root');
  if (o.wallet !== false) await walletOffered(c.id);
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'earnkit', url: `https://github.com/${b.key}`, homepage: 'https://earnkit.com', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{ repo: 'earnkit', repo_url: `https://github.com/${b.key}`, key: b.key, product, facts, live_verified: true, verdicts: [] }];
  b.ctx = { ...b.ctx, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  await mcpCall(b.ctx as never, 'find', { identity: { project: { name: 'EarnKit', repo: `https://github.com/${b.key}`, live_url: 'https://earnkit.com' } } });
  const gid = 49000 + n * 10 + (Number(RUN) % 7);
  b.gh = fakeGitHub({ [b.key]: { id: gid, owner: b.handle, installation: gid + 1 } });
  await installApp({ builderId: c.id, repoKey: b.key, login: b.handle, gh: b.gh });
  await sql()`UPDATE builder_projects SET commit_weeks = ${[isoWeekOf(new Date())]}::text[], shipped = true, kind = 'app' WHERE builder_id = ${c.id} AND lower(project_key) = lower(${b.key})`;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
}
/** Target B's world: Base's and Circle's rolling grants and an a16z speedrun copy closing in 30 hours, nothing else open. */
async function worldB() {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants', 'circle-developer-grants']);
  return sr;
}
const CONNECTED = "Connected. I'll track every commit you push, so your profile ";

test("B: a signed-out builder's first find is the opener: three numbered programs, the grants total and exactly one link", db, async () => {
  const sr = await worldB();
  const b = await newcomer('op');
  const r = await outFind(b);
  const s = show(r);
  const lines = s.split('\n');
  assert.equal(lines[0], "I'm EarnKit. I get builders funded for what they ship, and there's $105K in grants open right now.", s);
  assert.equal(lines[2], '1. Base Builder Grant: up to $5,000, rolling', s);
  assert.equal(lines[3], '2. Circle Developer Grants: $5K to $100K, rolling', s);
  assert.match(lines[4], new RegExp(`^3\\. ${sr.title} \\(investor program\\): up to \\$1M, closes [A-Z][a-z]{2} \\d{1,2}$`), s);
  const links = s.match(/https?:\/\/\S+/g) ?? [];
  assert.equal(links.length, 1, s);
  assert.match(links[0], /\/signin\//);
  assert.equal(lines.at(-1), OPENER_TAIL(links[0]));
  assert.equal(lines.length, 7, s);
  assert.doesNotMatch(s, BAD);
  assert.doesNotMatch(s, /Setup takes about a minute|EarnKit gets you paid/);
  assert.match(String(r.reply?.note), /call find with program/);
  // The numbered list is stored, so a number resolves later.
  assert.deepEqual(((await seenOf(b.id)).opener as { ids: string[] }).ids, ['base-builder-grants', 'circle-developer-grants', sr.id]);
  // The same session again (an older agent calling find): the list in one short line, never the whole opener.
  assert.equal(show(await outFind(b)), `Reply 1 for Base Builder Grant, 2 for Circle Developer Grants or 3 for ${sr.title}, and connect here so I can check if your work fits: ${links[0]}`);
});

test('B: "2" or a name is stored as the path\'s program; a number outside the list gets the list again', db, async () => {
  const sr = await worldB();
  const b = await newcomer('pk');
  const link = (show(await outFind(b)).match(/https?:\/\/\S+/) ?? [''])[0];
  const out = show(await outFind(b, { program: '7' }));
  assert.equal(out, `Reply 1 for Base Builder Grant, 2 for Circle Developer Grants or 3 for ${sr.title}, and connect here so I can check if your work fits: ${link}`);
  assert.equal((await seenOf(b.id)).path, undefined);
  assert.equal(show(await outFind(b, { program: '2' })), `Got it: Circle Developer Grants. Connect here so I can check if your work fits: ${link}`);
  assert.deepEqual({ ...((await seenOf(b.id)).path as object), at: undefined }, { stage: 'hook', program_id: 'circle-developer-grants', at: undefined, picked: true });
  // A name picks too (the builder changed their mind).
  assert.match(show(await outFind(b, { program: 'Base' })), /^Got it: Base Builder Grant\. /);
  assert.equal(((await seenOf(b.id)).path as { program_id: string }).program_id, 'base-builder-grants');
});

test('B: "2" (Circle) and connecting: the profile line, why Circle is not a fit, the Base hook; "yes" gives the steps', db, async () => {
  await worldB();
  const b = await newcomer('cn');
  await outFind(b);
  assert.match(show(await outFind(b, { program: '2' })), /^Got it: Circle Developer Grants\. /);
  await connectB(b);
  const r = await find(b);
  const s = show(r);
  const [p1, p2, p3, ...rest] = s.split('\n\n');
  // Fix round 0 (4): the page's score is 0 here, so neither the score nor the rank: the profile "fills in".
  assert.equal(p1, `Connected. I'll track every commit you push, so your profile fills in without you lifting a finger: earnkit.com/${b.handle.toLowerCase()}.`, s);
  assert.match(p2, /^For Circle Developer Grants: they fund apps on Arc, and EarnKit isn't on Arc yet\. Your closest money is Base Builder Grant: up to \$5,000\. [^\n]*Builder Codes[^\n]*$/, s);
  assert.equal(p3, 'Want the steps?', s);
  assert.equal(rest.length, 0, s);
  assert.doesNotMatch(s, BAD);
  assert.doesNotMatch(s, /qualify for|you qualify/i);
  assert.equal(r.reply?.note, PATH_NOTE);
  assert.equal(moveUp(r)?.kind, 'qualify');
  const seen = await seenOf(b.id);
  // The closest money offered stays the path's program (as a pick), so the next reply is still about it; its pointer
  // asks for the steps too (fix round 1 (8)).
  assert.deepEqual({ ...(seen.path as object), at: undefined }, { stage: 'hook', program_id: 'base-builder-grants', at: undefined, picked: true, steps: true });
  assert.ok(seen.connected_said);
  // "yes": the steps, each one the agent can do marked, then one easy reply.
  const y = show(await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' }));
  assert.match(y, /^Your next step toward Base Builder Grant:\n1\. [^\n]*Builder Code[^\n]*I can do this\./, y);
  assert.match(y, /(Go\?|Want me to do the first one now\?)$/, y);
  assert.doesNotMatch(y, BAD);
  // Said once: the next find in the session is the gap's step, never the connected line again.
  const again = show(await find(b));
  assert.match(again, /^Still on Base Builder Grant: /, again);
  // Fix round 0 (5): once a builder, whatever else writes the opener: a later opener record (a new signed-out agent of
  // theirs) and a new session never bring it back.
  assert.ok((await seenOf(b.id)).connected_said);
  await sql()`UPDATE builder_profiles SET standing_seen = (standing_seen - 'path') || jsonb_build_object('opener', jsonb_build_object('ids', '["base-builder-grants"]'::jsonb, 'at', now()::text)) WHERE builder_id = ${b.id}`;
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{said,at}', to_jsonb(${new Date(Date.now() - SESSION_MS - 1000).toISOString()}::text)) WHERE builder_id = ${b.id}`;
  const later = show(await find(b));
  assert.doesNotMatch(later, /Connected\./, later);
});

test('B: a pick that is a move (here the investor program in its window) is hooked for its draft right after the connected line', db, async () => {
  const sr = await worldB();
  const b = await newcomer('fit');
  await outFind(b);
  await outFind(b, { program: '3' });
  await connectB(b);
  const s = show(await find(b));
  const [p1, p2, p3] = s.split('\n\n');
  assert.ok(p1.startsWith(CONNECTED), s);
  assert.match(p2, new RegExp(`^Maya, ${sr.title} closes [^:]+: up to \\$1M\\.`), s);
  assert.equal(p3, 'I can draft your application from your commits and live product in a few minutes. Want me to start?');
  assert.equal(((await seenOf(b.id)).path as { program_id: string; picked?: boolean }).program_id, sr.id);
});

test('B: setup step 3 still comes first, word for word; the connected line waits for the next reply', db, async () => {
  await worldB();
  const b = await newcomer('s3');
  await outFind(b);
  await outFind(b, { program: '2' });
  await connectB(b, { wallet: false });
  const r = await find(b);
  const s = show(r);
  assert.equal(moveUp(r)?.kind, 'wallet_setup', s);
  const link = s.match(/no fee: (\S+)/)?.[1] ?? '';
  assert.equal(s, walletSetupAsk('EarnKit', link));
  const seen = await seenOf(b.id);
  assert.equal(seen.connected_said, undefined);
  assert.equal((seen.path as { program_id: string }).program_id, 'circle-developer-grants');
});

test('B fix round 0 (7): a picked investor program not close yet says so in one line, then the closest money', db, async () => {
  const sr = await speedrun(20 * 24);
  await only([sr.id, 'base-builder-grants', 'circle-developer-grants']);
  const b = await newcomer('inv');
  assert.match(show(await outFind(b)), new RegExp(`\\n3\\. ${sr.title} \\(investor program\\): `));
  await outFind(b, { program: '3' });
  await connectB(b);
  const s = show(await find(b));
  const [p1, p2, p3, ...rest] = s.split('\n\n');
  assert.ok(p1.startsWith(CONNECTED), s);
  assert.match(p2, new RegExp(`^${sr.title} is an investor program, so I'll help you prepare when it gets closer\\. Your closest money is Base Builder Grant: up to \\$5,000\\. `), s);
  assert.equal(p3, 'Want the steps?', s);
  assert.equal(rest.length, 0, s);
  assert.doesNotMatch(s, BAD);
});

test('B fix round 0 (6): sign-in that moves the installation to an existing page carries the pick and the opener list, unless that page has a path', db, async () => {
  await worldB();
  // A page this X account already holds (another agent of theirs, signed in before), with no path yet.
  const xid = `47${RUN}${Math.random().toString(10).slice(2, 8)}`;
  const user = { id: xid, username: `cv${RUN}${xid.slice(-3)}`.slice(0, 15), name: 'Maya Lin', avatar: null };
  const t1 = `ek_v48_cv1_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t1, undefined, false, 'Cursor');
  const first = (await connectInstallation(t1))!;
  assert.ok((await attachToX(first.own, user, new Date())).ok);
  const root = (await connectInstallation(t1))!.id;
  const b = await newcomer('cv');
  await outFind(b);
  await outFind(b, { program: '2' });
  assert.ok((await attachToX(b.own, user, new Date())).ok);
  assert.equal((await connectInstallation(b.t))!.id, root, 'the installation joined the existing page');
  const seen = await seenOf(root);
  assert.deepEqual({ ...(seen.path as object), at: undefined }, { stage: 'hook', program_id: 'circle-developer-grants', at: undefined, picked: true });
  assert.deepEqual((seen.opener as { ids: string[] }).ids, ['base-builder-grants', 'circle-developer-grants', (seen.opener as { ids: string[] }).ids[2]]);
  // Fix round 1 (7): the page has no project, so the connected line stays due there.
  assert.equal(seen.connected_said, undefined);
  // A page with a path of its own keeps it (nothing is carried).
  const c = await newcomer('cw');
  await outFind(c);
  await outFind(c, { program: '1' });
  assert.ok((await attachToX(c.own, user, new Date())).ok);
  assert.equal(((await seenOf(root)).path as { program_id: string }).program_id, 'circle-developer-grants');
  // Fix round 1 (7): only a pick (picked, at the hook) is carried; to an established page (a project) the connected
  // line is stamped said (a returning builder never hears "Connected." as if new).
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'path' - 'opener' WHERE builder_id = ${root}`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, chains) VALUES (${root}, ${`cv${RUN}/app`}, 'App', 'app', true, true, '{}')`;
  const d = await newcomer('cx');
  await outFind(d);
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('path', jsonb_build_object('stage', 'gap', 'program_id', 'base-builder-grants', 'at', now()::text)) WHERE builder_id = ${d.id}`;
  assert.ok((await attachToX(d.own, user, new Date())).ok);
  const after1 = await seenOf(root);
  assert.equal(after1.path, undefined, 'a path past the hook is never carried');
  const e = await newcomer('cy');
  await outFind(e);
  await outFind(e, { program: '1' });
  assert.ok((await attachToX(e.own, user, new Date())).ok);
  const after2 = await seenOf(root);
  assert.equal((after2.path as { program_id: string }).program_id, 'base-builder-grants');
  assert.ok(after2.connected_said);
});

/*
 * v4.8 Task 4 fix round 1: the real route (setup step 3 run, not skipped), the pick's edges, and tell's hand-offs.
 */
const CIRCLE_WHY = "For Circle Developer Grants: they fund apps on Arc, and EarnKit isn't on Arc yet. Your closest money is Base Builder Grant: up to $5,000. ";
/** B's second message after a lead line: the lead, the connected line, the Circle why with the Base hook, "Want the steps?". */
function assertSecond(s: string, lead: RegExp | null) {
  const parts = s.split('\n\n');
  if (lead) assert.match(parts.shift()!, lead, s);
  assert.ok(parts[0]?.startsWith(CONNECTED), s);
  assert.ok(parts[1]?.startsWith(CIRCLE_WHY), s);
  assert.equal(parts[2], 'Want the steps?', s);
  assert.equal(parts.length, 3, s);
  assert.doesNotMatch(s, /best fit|Want me to draft it|\| Program/, s);
  assert.doesNotMatch(s, BAD);
}

test('B fix round 1 (1): the real route, setup step 3 then a wallet no: the skip line, then B\'s second message (never a best fit to draft)', db, async () => {
  await worldB();
  const b = await newcomer('rw');
  await outFind(b);
  await outFind(b, { program: '2' });
  await connectB(b, { wallet: false });
  const step3 = await find(b);
  assert.equal(moveUp(step3)?.kind, 'wallet_setup', show(step3));
  const no = await tell(b, { kind: 'wallet_setup', project_key: null, answer: 'no' });
  assertSecond(show(no), /^No worries, add it whenever you're ready\.$/);
  assert.equal(moveUp(no)?.kind, 'qualify');
  const seen = await seenOf(b.id);
  assert.ok(seen.setup_done && seen.connected_said);
  assert.deepEqual({ ...(seen.path as object), at: undefined }, { stage: 'hook', program_id: 'base-builder-grants', at: undefined, picked: true, steps: true });
  // Said once: the next find is the pointer, its easy reply the same (fix round 1 (8)).
  assert.equal(show(await find(b)), 'Base Builder Grant is still your closest money. Want the steps?');
});

test('B fix round 1 (1): the real route with the wallet signed on the page: the done line, then B\'s second message', db, async () => {
  await worldB();
  const b = await newcomer('rs');
  await outFind(b);
  await outFind(b, { program: '2' });
  await connectB(b, { wallet: false });
  assert.equal(moveUp(await find(b))?.kind, 'wallet_setup');
  await sql()`INSERT INTO person_wallets (wallet, builder_id, recipient_at) VALUES (${`0x${'ab'.repeat(19)}${String(n).padStart(2, '0')}`}, ${b.id}, now())`;
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'wallet_link_at' WHERE builder_id = ${b.id}`;
  const r = await find(b);
  assertSecond(show(r), /^You're all set, Maya\.$/);
  assert.ok((await seenOf(b.id)).setup_done);
});

test('B fix round 1 (3): the ok after "Say ok once the change is pushed" is find\'s reply, run in the same tell (never empty)', db, async () => {
  await only(['base-builder-grants']);
  const b = await owner('okf');
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'declined' WHERE builder_id = ${b.id}`;
  await find(b);
  const go = await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' });
  assert.ok(show(go).endsWith(`\n\n${PUSHED_ASK}`), show(go));
  assert.equal(PUSHED_ASK, "Say ok once the change is pushed, and I'll check it.");
  b.gh.repos[b.key].files = { 'src/codes.ts': `export const SUFFIX = '0x046d617961000a${BUILDER_CODES_SUFFIX}'; Attribution.toDataSuffix({ codes: ['bc_earnkit'] });` };
  (b.ctx as { codesFetch?: typeof fetch }).codesFetch = b.gh;
  const ok = await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' });
  assert.equal(show(ok), A_CODES_IN_PROOF);
  assert.equal(moveUp(ok)?.kind, 'apply');
  assert.doesNotMatch(noteOf(ok), /call find now/);
});

test('B fix round 1 (3): a hosted agent\'s yes to help is find\'s reply, run in the same tell (never empty)', db, async () => {
  await only(['base-builder-grants']);
  const b = await owner('hlp');
  await sql()`UPDATE builder_profiles SET standing_seen = (standing_seen - 'declined') || '{"no_folder": true}'::jsonb WHERE builder_id = ${b.id}`;
  await find(b);
  await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' });
  const help = await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' });
  assert.match(show(help), /^Still on Base Builder Grant: add Base's Builder Code .* Want help with it now\?$/, show(help));
  assert.match(noteOf(help), /in short plain steps they can do themselves/);
});

test('B fix round 1 (4, 5): a pick never resets a path past the hook; a closed or applied pick gets one line and the list again', db, async () => {
  const sr = await worldB();
  const b = await newcomer('edge');
  const link = (show(await outFind(b)).match(/https?:\/\/\S+/) ?? [''])[0];
  // (4) The path moved on (a draft for Base); the opener was shown before that: "2" leaves it as it is.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('path', jsonb_build_object('stage', 'draft', 'program_id', 'base-builder-grants', 'at', ${new Date(Date.now() + 1000).toISOString()}::text)) WHERE builder_id = ${b.id}`;
  await outFind(b, { program: '2' });
  assert.deepEqual([((await seenOf(b.id)).path as { stage: string; program_id: string }).stage, ((await seenOf(b.id)).path as { program_id: string }).program_id], ['draft', 'base-builder-grants']);
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'path' WHERE builder_id = ${b.id}`;
  // (5) Circle closed since the list was shown: one line, then the list again (fresh, renumbered).
  await sql()`UPDATE programs SET status = 'closed' WHERE id = 'circle-developer-grants'`;
  assert.equal(show(await outFind(b, { program: '2' })), `Circle Developer Grants isn't open now. Reply 1 for Base Builder Grant or 2 for ${sr.title}, and connect here so I can check if your work fits: ${link}`);
  assert.equal((await seenOf(b.id)).path, undefined);
  assert.deepEqual(((await seenOf(b.id)).opener as { ids: string[] }).ids, ['base-builder-grants', sr.id]);
  // Applied to already (told EarnKit): one line, then the list again.
  await sql()`INSERT INTO builder_program_status (installation_id, program_id, status) VALUES (${b.id}, 'base-builder-grants', 'applied')`;
  assert.equal(show(await outFind(b, { program: '1' })), `You've already applied to Base Builder Grant. Reply 1 for ${sr.title}, and connect here so I can check if your work fits: ${link}`);
  assert.equal((await seenOf(b.id)).path, undefined);
});

test('B fix round 1 (12): a pick made signed in, before the code is connected, is acknowledged above step 2', db, async () => {
  await worldB();
  const b = await newcomer('ack');
  await outFind(b);
  assert.ok((await attachToX(b.own, { id: `46${RUN}${n}`, username: b.handle, name: 'Maya Lin', avatar: null }, new Date())).ok);
  const s = show(await find(b, { program: '2' }));
  assert.match(s, /^Got it: Circle Developer Grants\.\n\n/, s);
  assert.match(s, /\*\*Step 2 of 3:\*\*/, s);
  assert.equal(((await seenOf(b.id)).path as { program_id: string }).program_id, 'circle-developer-grants');
});

test('B fix round 1 (10): nothing open to number: the v4.0 setup reply, through find', db, async () => {
  await only([]);
  const b = await newcomer('none');
  const s = show(await outFind(b));
  assert.match(s, /^\*\*EarnKit gets you paid for building\.\*\*\n\n/, s);
  assert.ok(s.endsWith('Done with step 1?'), s);
  assert.equal((await seenOf(b.id)).opener, undefined);
});

test('B fix round 1 (10): a score above 0 is said in the connected line', db, async () => {
  await worldB();
  const b = await newcomer('sc');
  await outFind(b);
  await outFind(b, { program: '2' });
  await connectB(b);
  await sql()`UPDATE builder_live SET score = 54, ranked = true, calibration = ${'v2-shipping'}, parts = ${sql().json({ shipping: { points: 54, raw: { mask: 1, live_ships: 0 } } } as never)} WHERE builder_id = ${b.id}`;
  const p1 = show(await find(b)).split('\n\n')[0];
  assert.match(p1, new RegExp(`^Connected\\. I'll track every commit you push, so your profile stays current without you lifting a finger: earnkit\\.com/${b.handle.toLowerCase()}, score 54(, #\\d+ of \\d+ builders)?\\.$`), p1);
});

/*
 * v4.8 Task 5: the direct questions (target C), repeats and the email tell line (target D).
 */
test('rankWords (pure): "#N of M builders so far" at any pool size, from the same standing as the page pill', () => {
  assert.equal(rankWords({ ranked: true, rank: 1, total: 1 }), '#1 of 1 builders so far');
  assert.equal(rankWords({ ranked: true, rank: 3, total: 5 }), '#3 of 5 builders so far');
  assert.equal(rankWords({ ranked: true, rank: 1204, total: 3500 }), '#1,204 of 3,500 builders so far');
  for (const s of [{ ranked: false, rank: 1, total: 1 }, { ranked: true, rank: 0, total: 1 }, { ranked: true, rank: 3, total: 2 }, { ranked: true, rank: NaN, total: 2 }])
    assert.equal(rankWords(s), null, JSON.stringify(s));
});

/** Target C's standing answer, the owner's facts filled in. */
const C_STANDING = 'Score 77, #1 of 1 builders so far. It comes from your GitHub: 6 weeks shipping in a row, live at earnkit.com. Programs see it at earnkit.com/jenilt.';
test('standingAnswer and standingAgain (pure): target C word for word; a score of 0 or unknown says the profile fills in', () => {
  const f = { score: 77, rank: '#1 of 1 builders so far', streak: 6, liveAt: 'earnkit.com', live: true, name: 'EarnKit', page: 'earnkit.com/jenilt' };
  assert.equal(standingAnswer(f), C_STANDING);
  assert.equal(standingAgain(f), 'Same as a few minutes ago: #1 of 1, score 77.');
  // Live with no link known: the project's name; one week; no streak, not live: GitHub alone.
  assert.equal(standingAnswer({ ...f, liveAt: null, streak: 1 }), 'Score 77, #1 of 1 builders so far. It comes from your GitHub: 1 week shipping, EarnKit is live. Programs see it at earnkit.com/jenilt.');
  assert.equal(standingAnswer({ ...f, liveAt: null, live: false, streak: 0, rank: null }), 'Score 77. It comes from your GitHub. Programs see it at earnkit.com/jenilt.');
  assert.equal(standingAgain({ ...f, rank: null }), 'Same as a few minutes ago: score 77.');
  for (const score of [0, null]) {
    const s = standingAnswer({ ...f, score });
    assert.equal(s, 'Your profile fills in as your commits come in. Programs see it at earnkit.com/jenilt.');
    assert.doesNotMatch(s, /Score|#\d/);
    assert.equal(standingAgain({ ...f, score }), 'Same as a few minutes ago: your profile fills in as your commits come in.');
  }
  for (const s of [standingAnswer(f), standingAgain(f)]) assert.doesNotMatch(s, BAD);
});

test('programsAnswer and fitCell (pure): grants with fit, investor programs apart with what they are, the mentor line; never "qualify"', () => {
  assert.equal(fitCell({ fits: true, gaps: null }), 'Fits');
  assert.equal(fitCell({ fits: false, gaps: ['codes'] }), '1 step: add Builder Codes');
  assert.equal(fitCell({ fits: false, gaps: ['on Arc mainnet'] }), '1 step: deploy on Arc mainnet');
  assert.equal(fitCell({ fits: false, gaps: ['base', 'codes', 'use'] }), '3 steps');
  assert.equal(fitCell({ fits: false, gaps: null }), 'Not yet: not checked yet');
  assert.equal(fitCell({ fits: false, gaps: [], why: 'needs Arc' }), 'Not yet: needs Arc');
  const s = programsAnswer(
    [{ title: 'Base Builder Grant Program', amount: 'up to $5,000', when: 'rolling', fit: '1 step: add Builder Codes' }, { title: 'Arc Microgrants: Built with Arc Studio', amount: '500 USDC × 8 grants', when: 'closes Nov 1', fit: '1 step: deploy on Arc mainnet' }],
    [{ title: 'a16z speedrun SR008', amount: 'up to $1M', when: 'closes Nov 1', what: "a16z's 12-week startup program, in person in San Francisco." }],
  );
  assert.equal(s, [
    'Grants open now:',
    '',
    '| Grant | Money | Closes | Your fit |\n|---|---|---|---|\n| Base Builder Grant | up to $5,000 | Rolling | 1 step: add Builder Codes |\n| Arc Microgrants | 500 USDC × 8 grants | Nov 1 | 1 step: deploy on Arc mainnet |',
    '',
    'Investor programs:',
    '',
    "| Program | Money | Closes | What it is |\n|---|---|---|---|\n| a16z speedrun SR008 | up to $1M | Nov 1 | a16z's 12-week startup program, in person in San Francisco. |",
    '',
    PREPARE_LINE,
  ].join('\n'));
  assert.equal(PREPARE_LINE, 'If one of these is your plan, I can help you prepare.');
  assert.doesNotMatch(s, /qualify|\btotal\b/i);
  assert.doesNotMatch(s, BAD);
  // None open: one line for the grants, no investor table and no mentor line.
  assert.equal(programsAnswer([], []), 'No grants are open right now.');
  assert.equal(PROGRAMS_AGAIN, 'Same list as earlier.');
});

test('the alert emails (target D): each ends with exactly one tell line naming its program', () => {
  const closing = alertBody({ kind: 'closing', key: 'k', program: 'Base Builder Grant Program', day: 'Nov 1', amount: '$5,000', draft: false });
  const ready = alertBody({ kind: 'closing', key: 'k', program: 'Base Builder Grant Program', day: 'Nov 1', amount: '$5,000', draft: true });
  const fresh = alertBody({ kind: 'new', key: 'k', program: 'Base Builder Grant Program', amount: '$5,000', when: 'rolling', project: 'EarnKit' });
  const accepted = alertBody({ kind: 'accepted', key: 'k', program: 'Base Builder Grant Program', link: 'https://earnkit.com/me/post/abcdefghij' });
  const tail = (t: string) => t.split('\n').at(-1);
  assert.equal(tail(closing.text), 'Tell your agent: "EarnKit, draft Base Builder Grant."');
  assert.equal(tail(fresh.text), 'Tell your agent: "EarnKit, draft Base Builder Grant."');
  assert.equal(tail(ready.text), 'Tell your agent: "EarnKit, finish my Base Builder Grant draft."');
  assert.equal(tail(accepted.text), 'Tell your agent: "EarnKit, what\'s next after Base Builder Grant."');
  for (const b of [closing, ready, fresh, accepted]) {
    assert.equal((b.text.match(/Tell your agent:/g) ?? []).length, 1, b.text);
    assert.doesNotMatch(b.text, /Ask your agent/);
    assert.doesNotMatch(b.subject, /Tell your agent/);
    assert.doesNotMatch(b.text, BAD);
  }
  assert.equal(tellLine('draft Base'), 'Tell your agent: "EarnKit, draft Base."');
});

test('runAlertMail: the mailed text carries the tell line before the footer; subject unchanged (a test mailer, never sent)', db, async () => {
  const sent: { subject: string; text: string }[] = [];
  const t = `ek_v48_mail_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c = (await connectInstallation(t))!;
  await sql()`INSERT INTO digest_subscriptions (installation_id, login, email, opted_in_at) VALUES (${c.id}, '', ${`v48-${RUN}-${c.id}@example.com`}, now())`;
  const key = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 're_test';
  try {
    await runAlertMail(new Date(), {
      only: [c.id],
      mail: async (m) => void sent.push(m),
      events: async () => [{ kind: 'new', key: `new:v48-${RUN}`, program: 'Base Builder Grant Program', amount: '$5,000', when: 'rolling', project: 'EarnKit' }],
    });
  } finally {
    if (key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = key;
    // Never left for another file's run (its own mailer, all builders).
    await sql()`DELETE FROM digest_subscriptions WHERE installation_id = ${c.id}`;
  }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'New: Base Builder Grant Program, $5,000');
  assert.match(sent[0].text, /\n\nTell your agent: "EarnKit, draft Base Builder Grant\."\n\n/);
});

/** The owner-like builder with the page's score (77, a listed Shipping row) and only these programs open. */
async function asker(tag: string) {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants', 'circle-developer-grants']);
  const b = await owner(tag);
  await sql()`UPDATE builder_live SET score = 77, ranked = true, calibration = ${'v2-shipping'}, parts = ${sql().json({ shipping: { points: 77, raw: { mask: 1, live_ships: 0 } } } as never)} WHERE builder_id = ${b.id}`;
  return { b, sr };
}

test('C: "where do I stand" is answered first (score, #N of M so far, the GitHub facts, the page), then the path step; again, one pointer line', db, async () => {
  const { b, sr } = await asker('st');
  const r = await find(b, { ask: 'standing' });
  const s = show(r);
  const [p1, ...rest] = s.split('\n\n');
  const page = `earnkit\\.com/${b.handle.toLowerCase()}`;
  assert.match(p1, new RegExp(`^Score 77, #\\d+ of \\d+ builders so far\\. It comes from your GitHub: 6 weeks shipping in a row, live at earnkit\\.com\\. Programs see it at ${page}\\.$`), s);
  // The rank is the page's own standing (the same numbers as the pill would show).
  const m = /#(\d+) of (\d+)/.exec(p1)!;
  assert.ok(Number(m[1]) >= 1 && Number(m[1]) <= Number(m[2]), p1);
  // Then the path's step (A's opener for the a16z copy), its one easy reply last.
  assert.match(rest.join('\n\n'), new RegExp(`^Jenil, ${sr.title} closes [^\\n]+\\n\\nI can draft your application from your commits and live product in a few minutes\\. Want me to start\\?$`), s);
  assert.equal(moveUp(r)?.kind, 'apply');
  assert.doesNotMatch(s, BAD);
  // The same ask again in the session: one pointer line, then the step's own pointer. Never the block twice.
  const again = show(await find(b, { ask: 'standing' }));
  assert.equal(again, `Same as a few minutes ago: #${m[1]} of ${m[2]}, score 77.\n\nYour ${programName(sr.title)} application is still the next move. Want me to start?`);
  assert.doesNotMatch(again, /It comes from your GitHub/);
  // No ask: the path alone (the answer is not repeated).
  assert.equal(show(await find(b)), `Your ${programName(sr.title)} application is still the next move. Want me to start?`);
});

test('C: a score of 0 or unknown gets no score and no rank: the profile fills in', db, async () => {
  const { b } = await asker('s0');
  await sql()`UPDATE builder_live SET score = 0, parts = ${sql().json({ shipping: { points: 0, raw: { mask: 0, live_ships: 0 } } } as never)} WHERE builder_id = ${b.id}`;
  const p1 = show(await find(b, { ask: 'standing' })).split('\n\n')[0];
  assert.equal(p1, `Your profile fills in as your commits come in. Programs see it at earnkit.com/${b.handle.toLowerCase()}.`);
});

test('C: "what can I apply to" gives the grants table with fit and the investor table apart, then the path step; again, one line', db, async () => {
  const { b, sr } = await asker('pg');
  const r = await find(b, { ask: 'programs' });
  const s = show(r);
  const [grants, investors] = s.split(/\n\nInvestor programs:\n\n/);
  assert.match(grants, /^Grants open now:\n\n\| Grant \| Money \| Closes \| Your fit \|\n\|---\|---\|---\|---\|\n/, s);
  // Base: Builder Codes passed on, its one gap, from stored facts; never "you qualify".
  assert.match(grants, /\n\| Base Builder Grant \| up to \$5,000 \| Rolling \| 1 step: add Builder Codes \|/, s);
  assert.match(grants, /\n\| Circle Developer Grants \| [^|]+ \| Rolling \| (Fits|1 step: [^|]+|\d+ steps|Not yet: [^|]+) \|/, s);
  // An investor program is never in the grants table and never a fit.
  assert.doesNotMatch(grants, /speedrun/);
  assert.ok(investors, s);
  const [table, mentor, step] = investors.split('\n\n');
  assert.match(table, new RegExp(`^\\| Program \\| Money \\| Closes \\| What it is \\|\\n\\|---\\|---\\|---\\|---\\|\\n\\| ${sr.title} \\| up to \\$1M \\| [A-Z][a-z]{2} \\d{1,2} \\| a16z's 12-week startup program, in person in San Francisco\\. \\|$`), s);
  assert.doesNotMatch(table, /Fits|step/);
  assert.equal(mentor, PREPARE_LINE);
  // The path's step last, the one easy reply.
  assert.match(investors.split('\n\n').slice(2).join('\n\n'), /^Jenil, .+\n\nI can draft your application from your commits and live product in a few minutes\. Want me to start\?$/, s);
  assert.ok(step);
  assert.doesNotMatch(s, /qualify|\btotal\b/i);
  assert.doesNotMatch(s, BAD);
  const again = show(await find(b, { ask: 'programs' }));
  assert.equal(again, `Same list as earlier.\n\nYour ${programName(sr.title)} application is still the next move. Want me to start?`);
});

test('C: a program applied to is left out of the tables', db, async () => {
  const { b } = await asker('ap');
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, at) VALUES (${b.id}, '', 'circle-developer-grants', 'applied', now())`;
  const s = show(await find(b, { ask: 'programs' }));
  assert.match(s, /Base Builder Grant/);
  assert.doesNotMatch(s, /Circle Developer Grants/);
});

test('C: a held submit question and setup step 3 still win over a direct question, as before', db, async () => {
  const { b } = await asker('hq');
  await sql()`INSERT INTO projects (program_id, name, installation_id, confirmed_at) VALUES ('base-builder-grants', 'EarnKit', ${b.id}, now())`;
  for (const ask of ['standing', 'programs']) {
    const s = show(await find(b, { ask }));
    assert.match(s, /The only step left: submit it on .+\. Did you submit it\?$/, s);
    assert.doesNotMatch(s, /Score 77,|Grants open now|Same as/, s);
  }
  const { b: s3 } = await asker('h3');
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'wallet_asked' - 'wallet_link_at' - 'setup_asked' WHERE builder_id = ${s3.id}`;
  const r = await find(s3, { ask: 'standing' });
  const link = show(r).match(/no fee: (\S+)/)?.[1] ?? '';
  assert.equal(show(r), walletSetupAsk('EarnKit', link));
});

test('C: a shared client with no X of its own gets no answer and nothing said is written', db, async () => {
  const { b } = await asker('shq');
  const before = await seenOf(b.id);
  const t = `ek_v48_sharedq_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const other = (await connectInstallation(t))!.own;
  const shared = { ...(b.ctx as object), sharedClient: true, ownInstallationId: other };
  for (const ask of ['standing', 'programs']) {
    const s = show(await mcpCall(shared as never, 'find', { ask }));
    assert.doesNotMatch(s, /Score 77,|Grants open now|Same as a few minutes ago|Same list as earlier/, s);
  }
  assert.deepEqual((await seenOf(b.id)).said, before.said);
});
