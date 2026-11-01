import './fixtures/no-network-checks';
import { after, test, type TestContext } from 'node:test';
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
  CAN_DO, ANSWERED_FIRST, DRAFT_NOW_ASK, HELP_DONE_ASK, proofOf, gapProofOf, PREPARE_LINE, PREPARE_LINE_ONE, PROGRAMS_AGAIN, fitCell, grantFact, programsAnswer, standingAgain, standingAnswer, standingSaid, connectedLine, investorLater, noFitWhy, pickHook, openerAgain, openerReply, pickedReply, resolvePick, FOUNDER_BLANKS, MENTOR_NOTE, PATH_ANSWER_FIRST, CODES_OFFER, blanksAgain, SESSION_MS, SENT_ASK, TRACK_ACK, agoWords, passedLine, sinceLine, submitBy, submitPointer, submitReply, trackLead, bestMove, blanksAsk, closeWords, draftBlanks, draftReply, gapClosedReply, gapProof, gapReply, gapStillReply, pathReply, programName, proofLine, readPath, sessionOf,
  type GapGrant, type InvestorProgram, type Move, type MoveCtx, type MoveProgram,
} from './conversation';
import { qualifyGapSteps, BUILDER_CODES_GUIDE } from './bench-reply';
import { BUILDER_CODES_SUFFIX } from './builder-code';
import { MORE_ASK, NAME_ASK, PUSHED_ASK, RECHECK_WAIT, benchScore, codesSettled, founderBriefNote, openerPrograms, questionsDraftNote } from './bench-find';
import type { Card } from './present';
import { draftBody, shipLogFacts } from './ship-log-facts';
import { standingParagraph } from './standing';
import { rankWords } from './rank';
import { assertOpener } from './fixtures/opener';
import { standingOf } from './person-score';
import { alertBody, runAlertMail, tellLine } from './alert-mail';
import { askMismatch, converse, conversation, gateFailures, lazyNext, transcript, type Call, type Reply, type Turn } from './fixtures/converse';

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

test('bestMove (v4.8.1 R1): fit; a grant with no gap closing in 48 hours; an agent-doable one step; closest; investor in 7 days; quiet', () => {
  const fitSoon = prog({ id: 'fit-soon', ends_at: '2026-11-05T00:00:00Z', when: 'closes Nov 5' });
  const fitRolling = prog({ id: 'fit-rolling' });
  const codes = gap('codes', ['codes'], { doable: true });
  const two = gap('two', ['a', 'b']);
  const three = gap('three', ['a', 'b', 'c']);
  // 5 days out: an investor program, not within 48 hours.
  const week = { ...A16Z, id: 'week', ends_at: '2026-11-05T19:00:00Z' };
  // 1. A real fit, closing first (rolling last), before anything else.
  assert.deepEqual(bestMove(ctx({ fits: [fitRolling, fitSoon], grants: [codes, ARC], investors: [A16Z] })), { kind: 'fit', program: fitSoon });
  // 2. A grant closing within 48 hours with no gap known. v4.8.1 R1: an investor program (a16z) is never a 'now'; the
  // agent-doable one step leads it.
  assert.deepEqual(bestMove(ctx({ grants: [codes, ARC], investors: [A16Z, week] })), { kind: 'one_step', program: codes });
  const noGap = gap('nogap', [], { ends_at: '2026-11-01T12:00:00Z', when: 'closes Nov 1' });
  assert.deepEqual(bestMove(ctx({ grants: [noGap, codes] })), { kind: 'now', program: noGap });
  // ... a no-gap grant further out is never a move on its own.
  assert.deepEqual(bestMove(ctx({ grants: [gap('later', [], { ends_at: '2026-11-20T00:00:00Z' })] })), { kind: 'quiet' });
  // 3. A grant one step away, the step one the agent can do (Builder Codes), before an investor program in 7 days.
  assert.deepEqual(bestMove(ctx({ grants: [two, codes], investors: [week] })), { kind: 'one_step', program: codes });
  // 4. The closest grant by number of gaps, before an investor program in 7 days (v4.8.1 R1).
  const closest = bestMove(ctx({ grants: [three, two], investors: [week] }));
  assert.equal(closest.kind === 'closest' && closest.program.id, 'two');
  // 5. With no grant move, the investor program closing within 7 days, with the program file's odds.
  const inv = bestMove(ctx({ investors: [week] }));
  assert.equal(inv.kind, 'investor');
  assert.equal(inv.kind === 'investor' && inv.program.odds, A16Z.odds);
  // ... only within 7 days of its close.
  const later = { ...A16Z, id: 'later', ends_at: '2026-11-18T23:59:59Z' };
  // 6. Nothing: quiet.
  assert.deepEqual(bestMove(ctx({ investors: [later] })), { kind: 'quiet' });
  // A closed program is never a move.
  assert.deepEqual(bestMove(ctx({ fits: [prog({ id: 'gone', ends_at: '2026-10-30T00:00:00Z' })] })), { kind: 'quiet' });
});

test("bestMove (fix round 1, R1): Arc's chain gap is never a one-step; closing within 48 hours it is no grant move", () => {
  const week = { ...A16Z, id: 'week', ends_at: '2026-11-05T19:00:00Z' };
  // One gap, but a chain deployment closing within 48 hours: no grant move at all, so the investor program in 7 days leads.
  assert.equal(bestMove(ctx({ grants: [ARC], investors: [week] })).kind, 'investor');
  // Alone, it is only ever the closest grant (step 5), never a one_step.
  assert.equal(bestMove(ctx({ grants: [{ ...ARC, ends_at: '2026-11-10T00:00:00Z', when: 'closes Nov 10' }] })).kind, 'closest');
  // The owner's real day (v4.8.1 R1): a16z never leads on its own; Base (one gap, passed on, not raised yet) is raised.
  assert.deepEqual(bestMove(ctx({ grants: [ARC, BASE], investors: [A16Z] })), { kind: 'closest', program: BASE, raise: true });
});

test('bestMove: a passed step is raised once, only when it is the one gap, ahead of an investor program (v4.8.1 R1)', () => {
  // Base's one gap (Builder Codes) was passed on: it is raised as the closest, this once, ahead of a16z.
  assert.deepEqual(bestMove(ctx({ grants: [BASE], investors: [A16Z] })), { kind: 'closest', program: BASE, raise: true });
  // After "sent" (a16z applied to), the same.
  const raised = bestMove(ctx({ grants: [BASE], investors: [A16Z], skip: new Set(['a16z-speedrun']) }));
  assert.deepEqual(raised, { kind: 'closest', program: BASE, raise: true });
  // Raised once already: Base is no move, so a16z (no grant move left) leads.
  assert.deepEqual(bestMove(ctx({ grants: [BASE], investors: [A16Z], raised: new Set([BASE.id]) })), { kind: 'investor', program: A16Z });
  assert.deepEqual(bestMove(ctx({ grants: [BASE], raised: new Set([BASE.id]) })), { kind: 'quiet' });
  // A passed step that isn't the one gap is never raised.
  assert.deepEqual(bestMove(ctx({ grants: [{ ...BASE, gaps: ['codes', 'use'] }] })), { kind: 'quiet' });
});

test('bestMove (Review Focus 4): an investor program is never a fit; applied to or drafted is never the hook', () => {
  // An investment in the fits list is never a fit (it waits for its own step).
  assert.deepEqual(bestMove(ctx({ fits: [A16Z] })), { kind: 'quiet' });
  const fit = prog({ id: 'fit' });
  // Applied to or drafted (skip): never the hook, so the next move leads.
  assert.equal(bestMove(ctx({ fits: [fit], investors: [A16Z], skip: new Set(['fit']) })).kind, 'investor');
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
  // v4.8.1 Task 2 (R2): under 48 hours, the hours left (was "tomorrow night", "tonight", "tomorrow").
  assert.equal(closeWords('2026-11-02T07:59:59Z', PT, NOW), 'in 36 hours');
  assert.equal(closeWords('2026-11-01T06:59:59Z', PT, NOW), 'in 11 hours');
  assert.equal(closeWords('2026-11-01T18:00:00Z', PT, NOW), 'in 23 hours');
  assert.equal(closeWords('2026-11-06T07:59:59Z', PT, NOW), 'Nov 5');
  assert.equal(programName('Base Builder Grant Program'), 'Base Builder Grant');
  assert.equal(programName('Arc Microgrants: Built with Arc Studio'), 'Arc Microgrants');
  assert.equal(proofLine({ name: 'EarnKit', live: true }, 6, false), "You've shipped 6 weeks in a row and EarnKit is live.");
  // Task 6 fix round 1 (review 10): a streak under 2 weeks is left out.
  assert.equal(proofLine({ name: 'EarnKit', live: false }, 1, false), null);
  assert.equal(proofLine({ name: 'EarnKit', live: true }, 1, false), 'EarnKit is live.');
  assert.equal(proofLine({ name: 'EarnKit', live: false }, 2, false), "You've shipped 2 weeks in a row.");
  assert.equal(proofLine({ name: 'EarnKit', live: false }, 0, true), null);
});

test('proofOf and gapProofOf (Task 6 fix round 1, review 4): keyed on the facts, never the wording; a fact said this session is left out', () => {
  const ek = { name: 'EarnKit', live: true };
  const both = { line: "You've shipped 6 weeks in a row and EarnKit is live.", keys: ['proof:streak=6', 'proof:live=earnkit'] };
  assert.deepEqual(proofOf(ek, 6, false, new Set()), both);
  // The investor wording says why it matters; the facts (and so the keys) are the same.
  assert.deepEqual(proofOf(ek, 6, true, new Set()), { line: "You've shipped 6 weeks in a row and EarnKit is live, which is the traction they ask about.", keys: both.keys });
  assert.deepEqual(proofOf(ek, 6, false, new Set(['proof:streak=6'])), { line: 'EarnKit is live.', keys: ['proof:live=earnkit'] });
  assert.equal(proofOf(ek, 6, false, new Set(both.keys)), null);
  // A new streak is a new fact.
  assert.deepEqual(proofOf(ek, 7, false, new Set(both.keys))?.keys, ['proof:streak=7']);
  // Base, every step met: live on Base; said, the streak and live line (unsaid facts only); all said, none.
  assert.deepEqual(gapProofOf(ek, 6, [], new Set()), { line: "You're live on Base.", keys: ['proof:base=live'] });
  assert.deepEqual(gapProofOf(ek, 6, ['codes', 'use'], new Set()), { line: "You're on Base.", keys: ['proof:base=on'] });
  assert.deepEqual(gapProofOf(ek, 6, [], new Set(['proof:base=live'])), both);
  assert.equal(gapProofOf(ek, 6, [], new Set(['proof:base=live', ...both.keys])), null);
  assert.equal(gapProof(ek, 6, []), "You're live on Base.");
  // Task 6 fix round 1 (review 2): the draft offer ends on its question.
  assert.equal(DRAFT_NOW_ASK, 'It takes me a few minutes. Draft it now?');
});

test('pathReply (Task 6 fix round 1, review 4): a hook after the streak was said this session gives the Base fact, once', () => {
  const said = new Set(['proof:streak=6', 'proof:live=earnkit']);
  const r = pathReply({ now: NOW, first: null, project: { name: 'EarnKit', live: true }, streak: 6, move: { kind: 'closest', program: BASE, raise: false }, said, baseSteps: ['codes'] });
  assert.match(r.show_to_builder, /You're live on Base\./, r.show_to_builder);
  assert.doesNotMatch(r.show_to_builder, /shipped 6 weeks/);
  assert.ok(r.said.includes('proof:base=live'), r.said.join());
  const none = pathReply({ now: NOW, first: null, project: { name: 'EarnKit', live: true }, streak: 6, move: { kind: 'closest', program: BASE, raise: false }, said: new Set([...said, 'proof:base=live']), baseSteps: ['codes'] });
  assert.doesNotMatch(none.show_to_builder, /on Base\.|shipped/);
});

/** Section A's opener, the facts filled from the owner's account (score 77, 6 weeks, live, a16z open). */
const A_OPENER =
  "Jenil, a16z speedrun SR008 closes in 36 hours: up to $1M. You've shipped 6 weeks in a row and EarnKit is live, which is the traction they ask about.\n\n" +
  'I can draft your application from your commits and live product in a few minutes. Want me to start?';

test("pathReply: the owner's opener is section A's, word for word; the same hook again is a one-line pointer", () => {
  // v4.8.1 R1: a16z leads only with no grant move (or when picked), as an investor program.
  const move = bestMove(ctx({ investors: [A16Z] }));
  assert.equal(move.kind, 'investor');
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
    "Jenil, Arc Microgrants pays 500 USDC × 8 grants, closing in 32 hours. Arc Microgrants needs EarnKit on Arc mainnet. You've shipped 6 weeks in a row and EarnKit is live.\n\nWant the steps?");
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
/**
 * v4.8.1 Task 2 (R3): a session's first path reply says "Open now: {total} in grants." as its own paragraph just before
 * the easy reply. Fix round 1 (ruling a): a one-paragraph reply is split before its easy reply, so the line never goes
 * above the greeting. Asserts the line is there once, and gives the reply without it (the split kept).
 */
const withTotal = (s: string) => {
  assert.equal(s.match(/\n\nOpen now: \$[\d.]+[KM]?\+? in grants\.[^\n]*\n\n/g)?.length, 1, s);
  return s.replace(/Open now: [^\n]*\n\n/, '');
};
/** Fix round 1 (ruling a): a one-paragraph reply as the money line splits it, before its last sentence. */
const easySplit = (s: string, ask: string) => {
  assert.ok(s.endsWith(` ${ask}`), s);
  return `${s.slice(0, -ask.length - 1)}\n\n${ask}`;
};
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
 * and setup step 3 done. `pick` (v4.8.1 R1): the builder picked that program (said its name or number on the opener), so
 * an investor program leads; investor programs never lead on their own while a grant move exists.
 */
async function owner(tag: string, o: { pick?: string } = {}) {
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
  if (o.pick) await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('path', jsonb_build_object('stage', 'hook', 'program_id', ${o.pick}::text, 'at', now()::text, 'picked', true)) WHERE builder_id = ${c.id}`;
  return { ctx, id: c.id, key, gh, handle };
}
const find = (b: { ctx: unknown }, args: Record<string, unknown> = {}) => mcpCall(b.ctx as never, 'find', args);

test("the owner-like builder who picked a16z: the first find is A's opener; the next find in the session points back, never the same block", db, async () => {
  const sr = await speedrun(30);
  // Fix round 1 (R1): an open Arc Microgrants copy closing sooner, one chain gap away: never a one-step. v4.8.1 R1: a16z
  // leads because the builder picked it (Base, passed on, would be raised otherwise).
  const arc = committedProgram('arc-microgrants-studio', { keepContract: true });
  await upsertProgram(ProgramFile.parse({ ...arc, id: `v48-${process.pid}-arc`, ends_at: new Date(Date.now() + 20 * 3_600_000).toISOString(), status: 'active', starts_at: null }));
  const b = await owner('a', { pick: sr.id });
  const r = await find(b);
  const s = show(r);
  // v4.8.1 Task 2 (R3): the session's first path reply says the open total just before the easy reply.
  const [p1, money, p2] = s.split('\n\n');
  assert.match(money, /^Open now: \$[\d.]+[KM]?\+? in grants\.$/, s);
  assert.match(p1, new RegExp(`^Jenil, ${sr.title} closes (in \\d+ hours?|in under an hour|[A-Z][a-z]{2} \\d{1,2}): up to \\$1M\\. You've shipped \\d+ weeks? in a row and EarnKit is live, which is the traction they ask about\\.$`), s);
  assert.equal(p2, 'I can draft your application from your commits and live product in a few minutes. Want me to start?', s);
  assert.equal(s.split('\n\n').length, 3, s);
  assert.doesNotMatch(s, BAD);
  assert.doesNotMatch(s, /Ask me anytime/);
  // The agent note is the mentor note; a yes drafts it (the apply ask, stored for tell).
  assert.equal(r.reply?.note, PATH_NOTE);
  assert.equal(moveUp(r)?.kind, 'apply');
  assert.deepEqual((r.reply?.lead as { program_id: string }).program_id, sr.id);
  const seen = await seenOf(b.id);
  assert.equal((seen.bench_ask as { kind: string; program_id: string }).program_id, sr.id);
  assert.deepEqual({ ...(seen.path as object), at: undefined }, { stage: 'hook', program_id: sr.id, at: undefined, picked: true });
  assert.ok((seen.said as { keys: string[] }).keys.includes(`hook:${sr.id}`));
  // Review Focus 5 (an older agent calling find again): a one-line pointer, never the opener again.
  const again = show(await find(b));
  assert.equal(again, `Your ${programName(sr.title)} application is still the next move. Want me to start?`);
  // After 2 hours of quiet, a new session: the opener again. (Task 3: the copy opened within this test, after the last
  // session began, so "Since earlier today: ... opened." may lead it.)
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{said,at}', to_jsonb(${new Date(Date.now() - SESSION_MS - 1000).toISOString()}::text)) WHERE builder_id = ${b.id}`;
  const fresh = show(await find(b)).split('\n\n');
  assert.deepEqual(fresh.slice(-3), [p1, money, p2]);
  // Fix round 1 (5): it was hooked last session, so it is not new to this builder: no "opened".
  assert.equal(fresh.length, 3, fresh.join('|'));
});

test('a no to the hook parks that program for DECLINE_MS and the path moves on', db, async () => {
  const sr = await speedrun(30);
  const b = await owner('no', { pick: sr.id });
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
  assert.match(s, /^Jenil, Base Builder Grant pays up to \$5,000\. [^\n]*Builder Codes[^\n]*\n\nOpen now: [^\n]+\n\nI can add them and push the change, about 10 minutes\. Go\?$/, s);
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
  assert.ok(r.show_to_builder.startsWith('a16z speedrun SR008 closes in 36 hours: up to $1M. '), r.show_to_builder);
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

test('fix round 2 (F1): steps 1 to 3 lead even with the connect weeks due', db, async () => {
  await speedrun(30);
  const b = await owner('f1a');
  // v4.8.1 R1: Base's step not passed on here, so its agent-doable one step (step 3) leads; a16z never leads on its own.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'declined' WHERE builder_id = ${b.id}`;
  await connectDueFor(b);
  const s = show(await find(b));
  assert.ok(s.startsWith('Jenil, Base Builder Grant pays ') && s.endsWith('Go?'), s);
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

test('v4.8.1 fix round 1: with only an investor move, the connect weeks go first, once a session; then the path; a pick never waits', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id]);
  const b = await owner('f1i');
  await connectDueFor(b);
  const first = await find(b);
  assert.equal(moveUp(first)?.kind, 'connect', show(first));
  assert.match(show(first), /Make your shipping log public on /);
  assert.ok(((await seenOf(b.id)).said as { keys: string[] }).keys.includes('older'));
  // The next call in the session: the investor program (one older moment a session).
  const second = show(await find(b));
  assert.ok(second.startsWith(`Jenil, ${sr.title} closes `) && second.endsWith('Want me to start?'), second);
  // A builder who picked it is on it: the path, never the connect weeks.
  const c = await owner('f1j', { pick: sr.id });
  await connectDueFor(c);
  const picked = show(await find(c));
  assert.ok(picked.startsWith(`Jenil, ${sr.title} closes `), picked);
  assert.doesNotMatch(picked, /Make your shipping log public/, picked);
});

test('fix round 2 (F4): a v4.7 silence stand-aside never parks a program; an explicit no does', db, async () => {
  const sr = await speedrun(30);
  const b = await owner('f4', { pick: sr.id });
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
  // Task 6 fix round 1b: the re-ask has the blanks ask's approved shape, "Reply with it|both|them and I'll finish it.".
  assert.equal(blanksAgain(['a note on the founding team', 'a Loom product demo']), "I need a note on the founding team, and a Loom product demo. Reply with both and I'll finish it.");
  assert.equal(blanksAgain(['a demo']), "I need a demo. Reply with it and I'll finish it.");
  assert.equal(blanksAgain(['a', 'b', 'c']), "I need a, b, and c. Reply with them and I'll finish it.");
});

test('the draft notes (fix round 2, F7, F8): the guard always; with no verified record, never invented traction', () => {
  for (const n of [founderBriefNote('a16z speedrun SR008', 'k', { record: false }), questionsDraftNote('p', 'k', { record: false })]) {
    assert.match(n, /Never tell them they qualify or that an application was sent\./);
    assert.match(n, /no verified record for them yet, so leave traction out and never invent it/);
    assert.doesNotMatch(n, /verified record below/);
  }
  assert.match(founderBriefNote('a16z speedrun SR008', 'k', { record: true }), /around the Traction sentence below \(keep its facts exactly\)/);
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
  const b = await owner('dr', { pick: sr.id });
  await sql()`UPDATE builder_projects SET what = 'a funding finder for builders' WHERE builder_id = ${b.id} AND lower(project_key) = lower(${b.key})`;
  assert.equal(moveUp(await find(b))?.kind, 'apply');
  const r = await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes' });
  const s = show(r);
  const parts = s.split('\n\n');
  assert.equal(parts[0], "Here's your draft:", s);
  // Final review F1: target A's body from the stored facts: What it is (the stored description), one Traction sentence
  // (the streak), the page; never the raw ship log.
  assert.match(parts[1], /^What it is: a funding finder for builders\.\nTraction: Shipped 6 weeks in a row\b[^\n]*\.\n/, s);
  // Exactly the page's facts, nothing invented (a live link and revenue only when the page shows them).
  assert.equal(parts[1], draftBody((await shipLogFacts(b.id, new Date()))!, 'a funding finder for builders').join('\n'));
  assert.match(parts[1], new RegExp(`\\nProfile: \\S*${b.handle}$`, 'i'), s);
  assert.doesNotMatch(parts[1], /From your ship log|Shipping \d|^Page:/m, s);
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
  assert.equal(show(ok), "I need who's on the team, and any money you've raised. Reply with both and I'll finish it.");
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
  assert.match(show(hook), new RegExp(`^Jenil, Base Builder Grant pays up to \\$5,000\\. [^\\n]*Builder Codes[^\\n]*\\n\\nOpen now: [^\\n]+\\n\\n${OFFER.replace(/[.?]/g, '\\$&')}$`), show(hook));
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
  // Task 6 fix round 1 (review 4): "You're live on Base" was said this session (the step again), so not again.
  assert.equal(show(done), A_CODES_IN);
  assert.equal(moveUp(done)?.kind, 'apply');
  assert.equal(done.reply?.note, PATH_NOTE);
  const seen = await seenOf(b.id);
  assert.deepEqual({ ...(seen.path as object), at: undefined }, { stage: 'draft', program_id: 'base-builder-grants', at: undefined });
  // Its yes is the Base draft: EarnKit fills the confirmed Builder Code; contact details wait for submit; at most 2 blanks.
  const dr = await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes' });
  const draft = show(dr);
  assert.ok(draft.startsWith("Here's your draft:\n\nTraction: "), draft);
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
  // Final review F3: its one step is one the agent can't do, so the yes is the help itself.
  assert.equal(show(r), `Let's do it now: get EarnKit on Arc mainnet.\n\n${HELP_DONE_ASK}`);
});

test('F3: a hosted agent gets the steps to do itself, nothing marked; its no parks Base', db, async () => {
  await only(['base-builder-grants']);
  const b = await owner('bh');
  await sql()`UPDATE builder_profiles SET standing_seen = (standing_seen - 'declined') || '{"no_folder": true}'::jsonb WHERE builder_id = ${b.id}`;
  assert.equal(moveUp(await find(b))?.kind, 'qualify');
  // Final review F3: one step a hosted agent can't do itself: the hook's yes is the help (the agent walks them through it,
  // never "here in this folder"), its done ask last.
  const help = await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' });
  assert.equal(show(help), `Let's do it now: add Base's Builder Code to your app, a one-line tag Base uses to see your traffic. Guide: ${GUIDE}\n\n${HELP_DONE_ASK}`);
  assert.match(noteOf(help), /in short plain steps they can do themselves.*then call find/);
  assert.doesNotMatch(noteOf(help), /this folder|in their code here/);
  // Fix round 3 (7): the hosted yes stamps gap_did too, so the next find re-checks the code.
  assert.ok(((await seenOf(b.id)).gap_did as Record<string, string>)['base-builder-grants']);
  // The next find while helping: one short line, never the step again (final review F3); a no to it parks Base.
  const still = await find(b);
  assert.equal(show(still), `Take your time with the Base Builder Grant step. ${HELP_DONE_ASK}`);
  await tell(b, { kind: 'qualify', project_key: b.key, answer: 'no' });
  assert.ok(((await seenOf(b.id)).declined as Record<string, string>)['path:base-builder-grants']);
  assert.doesNotMatch(show(await find(b)), /Base Builder Grant|Builder Codes/);
});

test('a no parks the program and the next find hooks the next program; a no at the gap parks that one too', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants']);
  const b = await owner('nx', { pick: sr.id });
  // One older moment already said this session, so the closest grant is never put behind one (fix round 2, F1).
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('said', jsonb_build_object('at', now()::text, 'keys', '["older"]'::jsonb)) WHERE builder_id = ${b.id}`;
  assert.ok(show(await find(b)).includes(sr.title));
  // Final review F7: the no's reply is the next bestMove program (find, run in the tell): Base, whose passed step is
  // raised once as its one gap (greeted already this session: F4).
  const next = await tell(b, { kind: 'apply', project_key: b.key, answer: 'no' });
  assert.match(show(next), new RegExp(`^No problem, I'll set ${sr.title} aside\\.\\n\\nYour closest money is Base Builder Grant: up to \\$5,000\\. `), show(next));
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
const A_SUBMIT = `Done, it's ready to paste. Submit at https://speedrun.a16z.com/apply before Nov 1, 11:59 PM PT (in 36 hours). The form also asks for your email.\n\n${SENT_ASK}`;

test('the submit stage, the pointer and the track lead (pure): target A word for word, the deadline in the program\'s zone', () => {
  assert.equal(SENT_ASK, 'Reply "sent" once it\'s in, and I\'ll keep track of it for you.');
  const by = submitBy('2026-11-02T07:59:59Z', PT, NOW, 'PT');
  // v4.8.1 Task 2 (R2): the program-zone day, never "today" or "tomorrow", and the hours left under 48 hours.
  assert.equal(by, 'Nov 1, 11:59 PM PT (in 36 hours)');
  assert.equal(submitBy('2026-11-01T06:59:59Z', PT, NOW, 'PT'), 'Oct 31, 11:59 PM PT (in 11 hours)');
  assert.equal(submitBy('2026-11-06T07:59:59Z', PT, NOW, 'PT'), 'Nov 5, 11:59 PM PT');
  // A zone with no short name: the day only, never a time read in the wrong zone.
  assert.equal(submitBy('2026-11-06T07:59:59Z', 'Asia/Kolkata', NOW, null), 'Nov 6');
  assert.equal(submitReply({ link: 'https://speedrun.a16z.com/apply', by, contacts: ['your email'] }), A_SUBMIT);
  assert.equal(submitReply({ link: 'https://base.org/apply', by: null, contacts: [] }), `Done, it's ready to paste. Submit at https://base.org/apply.\n\n${SENT_ASK}`);
  assert.equal(submitPointer({ title: 'a16z speedrun SR008', when: 'closes Nov 1', ends_at: '2026-11-02T07:59:59Z', zone: PT }, NOW),
    'Your a16z speedrun SR008 application is ready to submit, closes in 36 hours. Reply "sent" once it\'s in.');
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
  const b = await owner('snt', { pick: sr.id });
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

test('fix round 1 (2): a plain yes to the submit ask is never "sent"; answer "sent" is; a no keeps it ready (final F8)', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants']);
  const b = await owner('sny', { pick: sr.id });
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
  // Another builder: a no to "sent" is "not yet" (final review F8): the next find still points back to it.
  const c = await owner('snn', { pick: sr.id });
  await find(c);
  await tell(c, { kind: 'apply', project_key: c.key, answer: 'yes' });
  await tell(c, { kind: 'apply', project_key: c.key, answer: 'yes', blanks: 'just me, nothing raised' });
  await tell(c, { kind: 'apply', project_key: c.key, answer: 'no' });
  assert.match(show(await find(c)), /speedrun SR008 application is ready to submit/);
});

/** A builder at submit on `sr` (picked, hook, draft, the blanks answered). */
async function atSubmit(tag: string, pick: string) {
  const b = await owner(tag, { pick });
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
  const b = await atSubmit('snm', sr.id);
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
  const b = await atSubmit('snq', sr.id);
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
  const b = await atSubmit('snf', sr.id);
  await backSession(b.id, SESSION_MS + 60_000);
  const s = show(await mcpCall(b.ctx as never, 'tell', { program_status: [{ program_id: sr.id, status: 'applied' }] }));
  const parts = s.split('\n\n');
  assert.ok(parts[0].startsWith("Nice, I'm tracking it."), s);
  assert.equal(parts.at(-1), OFFER, s);
  // Base was passed on before (seen), so its reopening is no news.
  assert.doesNotMatch(s, /opened/, s);
});

/**
 * Task 5 fix round 1: a fixed `now` for the "Since" day words (UTC days, ruling 7). Date is frozen for the test at a time
 * at least 4 hours into its UTC day, so a session back-dated 3 hours is still "earlier today" at any wall-clock hour.
 */
function pinClock(t: TestContext) {
  const real = Date.now();
  const day = Math.floor(real / 86_400_000) * 86_400_000;
  t.mock.timers.enable({ apis: ['Date'], now: Math.max(real, day + 4 * 3_600_000) });
}

test('fix round 1 (5, 11): "Since" says "opened" only for a program new to this builder; a missing or bad last session says nothing', db, async (t) => {
  pinClock(t);
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
  const d = await atSubmit('snr', sr.id);
  await backSession(d.id, 3 * 3_600_000);
  await sql()`UPDATE programs SET opened_at = now() WHERE id = ${sr.id}`;
  const p = show(await find(d));
  assert.match(p, new RegExp(`^Your ${sr.title} application is ready to submit`), p);
});

test('fix round 1 (6, 11): an announced result is said once (the alerts opener); a close within 48 hours as the submit step says it', db, async (t) => {
  pinClock(t);
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
  assert.match(g, new RegExp(`^Since earlier today: Arc Due ${RUN} closes [A-Z][a-z]{2} \\d{1,2}, \\d{1,2}:\\d{2} (AM|PM) ET \\(in \\d+ hours?\\)\\.\\n\\nOpen now: [^\\n]+\\n\\nStill on Arc Due ${RUN}: `), g);
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
  assert.equal(withTotal(s), `Since ${day}: 1 more week shipped, so your streak is 6 weeks${score}. Base Builder Grant is still open and you now meet its first requirement.\n\n${DRAFT_NOW_ASK}`);
  assert.ok(score, `the page's score: ${standing}`);
  assert.equal(moveUp(r)?.kind, 'apply');
  assert.equal(r.reply?.note, PATH_NOTE);
  assert.doesNotMatch(s, BAD);
  // Said once: the next find in this session is the step's pointer, never "Since" again.
  assert.doesNotMatch(show(await find(b)), /^Since /);
  // Nothing changed since the last session: the step alone.
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{said,at}', to_jsonb(${new Date(Date.now() - SESSION_MS - 1000).toISOString()}::text)) WHERE builder_id = ${b.id}`;
  assert.equal(withTotal(show(await find(b))), easySplit(A_CODES_IN_PROOF, 'Want me to draft the Base application next?'));
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
  // An investor program picked inside its window: the pick, its own kind (v4.8.1 R1: 'investor', never 'now').
  assert.deepEqual(pickHook(ctx({ grants: [codes], investors: [A16Z] }), A16Z.id), { move: { kind: 'investor', program: A16Z }, pick: true, steps: false });
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

test('B fix round 1 (3), Task 6 fix round 1 (review 1): a hosted agent\'s yes to help is its own reply, the done ask last (never empty)', db, async () => {
  await only(['base-builder-grants']);
  const b = await owner('hlp');
  await sql()`UPDATE builder_profiles SET standing_seen = (standing_seen - 'declined') || '{"no_folder": true}'::jsonb WHERE builder_id = ${b.id}`;
  await find(b);
  // Final review F3: one step the hosted agent can't do itself: the hook's yes is the help.
  const help = await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' });
  assert.equal(show(help), `Let's do it now: add Base's Builder Code to your app, a one-line tag Base uses to see your traffic. Guide: ${GUIDE}\n\n${HELP_DONE_ASK}`);
  assert.equal(moveUp(help)?.kind, 'qualify');
  assert.match(noteOf(help), /in short plain steps they can do themselves/);
  assert.deepEqual([(await seenOf(b.id)).bench_ask].map((a) => [(a as { help?: boolean }).help, (a as { checks?: number }).checks]), [[true, 0]]);
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
test('standingAnswer and standingAgain (pure): target C word for word; live only from a checked link; score 0 or unknown: the profile fills in', () => {
  const f = { score: 77, rank: '#1 of 1 builders so far', streak: 6, liveAt: 'earnkit.com', page: 'earnkit.com/jenilt' };
  assert.equal(standingAnswer(f), C_STANDING);
  assert.equal(standingAgain(f), 'Same as earlier: #1 of 1, score 77.');
  // Fix round 1 (10): no checked link, no live clause.
  assert.equal(standingAnswer({ ...f, liveAt: null, streak: 1 }), 'Score 77, #1 of 1 builders so far. It comes from your GitHub: 1 week shipping. Programs see it at earnkit.com/jenilt.');
  assert.equal(standingAnswer({ ...f, liveAt: null, streak: 0, rank: null }), 'Score 77. It comes from your GitHub. Programs see it at earnkit.com/jenilt.');
  assert.equal(standingAgain({ ...f, rank: null }), 'Same as earlier: score 77.');
  for (const score of [0, null]) {
    const s = standingAnswer({ ...f, score });
    assert.equal(s, 'Your profile fills in as your commits come in. Programs see it at earnkit.com/jenilt.');
    assert.doesNotMatch(s, /Score|#\d/);
    assert.equal(standingAgain({ ...f, score }), 'Same as earlier: your profile fills in as your commits come in.');
  }
  // Fix round 1 (3): what was said is in the key, so a changed score or rank is a new answer.
  assert.equal(standingSaid(f), standingSaid({ ...f, streak: 7 }));
  assert.notEqual(standingSaid(f), standingSaid({ ...f, score: 79 }));
  assert.notEqual(standingSaid(f), standingSaid({ ...f, rank: '#2 of 2 builders so far' }));
  for (const s of [standingAnswer(f), standingAgain(f)]) assert.doesNotMatch(s, BAD);
});

test('grantFact and fitCell (pure, fix round 1 (1, 6)): steps first, then one chain the project is not on, then none known; drafted and steps met', () => {
  const none = new Set<string>();
  const arc = (c: string) => (c === 'arc' ? 'Arc' : c);
  assert.deepEqual(grantFact(['codes'], ['base'], new Set(['base']), arc), { kind: 'steps', gaps: ['codes'] });
  // Circle: no gap from programNeeds, but its one chain (Arc) is not the project's: "needs Arc", as B's why line says.
  assert.deepEqual(grantFact([], ['arc'], new Set(['base']), arc), { kind: 'chain', chain: 'Arc' });
  assert.deepEqual(grantFact(null, ['arc'], none, arc), { kind: 'chain', chain: 'Arc' });
  assert.deepEqual(grantFact([], [], none, arc), { kind: 'none' });
  assert.deepEqual(grantFact([], ['arc'], new Set(['arc']), arc), { kind: 'none' });
  assert.deepEqual(grantFact(null, [], none, arc), { kind: 'unknown' });
  assert.equal(fitCell(true, { kind: 'none' }), 'Fits');
  assert.equal(fitCell(false, { kind: 'steps', gaps: ['codes'] }), '1 step: add Builder Codes');
  assert.equal(fitCell(false, { kind: 'steps', gaps: ['on Arc mainnet'] }), '1 step: deploy on Arc mainnet');
  assert.equal(fitCell(false, { kind: 'steps', gaps: ['base', 'codes', 'use'] }), '3 steps');
  assert.equal(fitCell(false, { kind: 'chain', chain: 'Arc' }), 'Not yet: needs Arc');
  assert.equal(fitCell(false, { kind: 'none' }), "Not yet: EarnKit can't see its needs yet");
  assert.equal(fitCell(false, { kind: 'unknown' }), 'Not yet: not checked yet');
  assert.equal(fitCell(false, { kind: 'drafted' }), 'Drafted');
  assert.equal(fitCell(false, { kind: 'met' }), 'Steps met');
});

test('programsAnswer (pure, fix round 1 (4)): one line a program under 3, a table from 3; investor programs apart, the mentor line; never "qualify"', () => {
  const base = { title: 'Base Builder Grant Program', amount: 'up to $5,000', when: 'rolling', fit: '1 step: add Builder Codes' };
  const circle = { title: 'Circle Developer Grants', amount: '$5K to $100K', when: 'rolling', fit: 'Not yet: needs Arc' };
  const arcG = { title: 'Arc Microgrants: Built with Arc Studio', amount: '500 USDC × 8 grants', when: 'closes Nov 1', fit: 'Fits' };
  const a16z = { title: 'a16z speedrun SR008', amount: 'up to $1M', when: 'closes Nov 1', what: "a16z's 12-week startup program, in person in San Francisco." };
  const s = programsAnswer([base, circle], [a16z]);
  assert.equal(s, [
    'Grants open now:',
    '',
    'Base Builder Grant: up to $5,000, rolling. Your fit: 1 step, add Builder Codes.',
    'Circle Developer Grants: $5K to $100K, rolling. Your fit: not yet, needs Arc.',
    '',
    "a16z speedrun SR008 (investor program): up to $1M, closes Nov 1. a16z's 12-week startup program, in person in San Francisco.",
    '',
    PREPARE_LINE_ONE,
  ].join('\n'));
  // From 3 rows, the table.
  const t = programsAnswer([arcG, base, circle], []);
  assert.equal(t, [
    'Grants open now:',
    '',
    '| Grant | Money | Closes | Your fit |\n|---|---|---|---|\n| Arc Microgrants | 500 USDC × 8 grants | Nov 1 | Fits |\n| Base Builder Grant | up to $5,000 | Rolling | 1 step: add Builder Codes |\n| Circle Developer Grants | $5K to $100K | Rolling | Not yet: needs Arc |',
  ].join('\n'));
  assert.equal(programsAnswer([arcG], []), 'Grants open now:\n\nArc Microgrants: 500 USDC × 8 grants, closes Nov 1. It fits.');
  const three = programsAnswer([], [a16z, { ...a16z, title: 'Alliance ALL19', what: 'Investor program' }, { ...a16z, title: 'Monad Nitro', amount: null, when: 'rolling' }]);
  assert.match(three, /^No grants are open right now\.\n\nInvestor programs:\n\n\| Program \| Money \| Closes \| What it is \|\n/);
  assert.match(three, /\| Monad Nitro \| Not stated \| Rolling \|/);
  assert.ok(three.endsWith(`\n\n${PREPARE_LINE}`));
  assert.equal(PREPARE_LINE, 'If one of these is your plan, I can help you prepare.');
  for (const x of [s, t, three]) {
    assert.doesNotMatch(x, /qualify|\btotal\b/i);
    assert.doesNotMatch(x, BAD);
  }
  assert.equal(programsAnswer([], []), 'No grants are open right now.');
  assert.equal(PROGRAMS_AGAIN, 'Same list as earlier.');
});

test('pathReply brief (fix round 1 (5)): after a direct answer, the step is the short pointer with no "still", and the hook counts as said', () => {
  // v4.8.1 R1: a16z as the move needs no grant move beside it (Base, passed on, would be raised first).
  const move = bestMove(ctx({ investors: [A16Z] })) as Exclude<Move, { kind: 'quiet' }>;
  const r = pathReply({ now: NOW, first: 'Jenil', project: { name: 'EarnKit', live: true }, streak: 6, move, said: new Set(), brief: true });
  assert.equal(r.show_to_builder, 'Your a16z speedrun SR008 application is the next move. Want me to start?');
  assert.ok(r.said.includes('hook:a16z-speedrun'));
  const again = pathReply({ now: NOW, first: 'Jenil', project: { name: 'EarnKit', live: true }, streak: 6, move, said: new Set(r.said) });
  assert.equal(again.show_to_builder, 'Your a16z speedrun SR008 application is still the next move. Want me to start?');
  const go = pathReply({ now: NOW, first: 'Jenil', project: { name: 'EarnKit', live: true }, streak: 6, move: { kind: 'one_step', program: { ...BASE, passed: false } }, said: new Set(), brief: true });
  assert.equal(go.show_to_builder, `Builder Codes are the one step to Base Builder Grant. ${CODES_OFFER}`);
  const steps = pathReply({ now: NOW, first: 'Jenil', project: { name: 'EarnKit', live: true }, streak: 6, move: { kind: 'closest', program: ARC, raise: false }, said: new Set(), brief: true });
  assert.equal(steps.show_to_builder, 'Arc Microgrants is your closest money. Want the steps?');
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

test('runAlertMail: the mailed text carries the tell line before the footer; subject unchanged (an injected mailer, no key set)', db, async () => {
  const sent: { subject: string; text: string }[] = [];
  const t = `ek_v48_mail_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c = (await connectInstallation(t))!;
  await sql()`INSERT INTO digest_subscriptions (installation_id, login, email, opted_in_at) VALUES (${c.id}, '', ${`v48-${RUN}-${c.id}@example.com`}, now())`;
  try {
    await runAlertMail(new Date(), {
      only: [c.id],
      mail: async (m) => void sent.push(m),
      events: async () => [{ kind: 'new', key: `new:v48-${RUN}`, program: 'Base Builder Grant Program', amount: '$5,000', when: 'rolling', project: 'EarnKit' }],
    });
  } finally {
    // Never left for another file's run (its own mailer, all builders).
    await sql()`DELETE FROM digest_subscriptions WHERE installation_id = ${c.id}`;
  }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'New: Base Builder Grant Program, $5,000');
  assert.match(sent[0].text, /\n\nTell your agent: "EarnKit, draft Base Builder Grant\."\n\n/);
});

/** The owner-like builder with the page's score (77, a listed Shipping row) and only these programs open. */
async function asker(tag: string, ids: string[] | null = null) {
  const sr = await speedrun(30);
  await only(ids ?? [sr.id, 'base-builder-grants', 'circle-developer-grants']);
  const b = await owner(tag, { pick: sr.id });
  await setScore(b.id, 77);
  return { b, sr };
}
const setScore = (id: number, score: number) =>
  sql()`UPDATE builder_live SET score = ${score}, ranked = true, calibration = ${'v2-shipping'}, parts = ${sql().json({ shipping: { points: score, raw: { mask: 1, live_ships: 0 } } } as never)} WHERE builder_id = ${id}`;
const pointerOf = (title: string, still = true) => `Your ${programName(title)} application is ${still ? 'still ' : ''}the next move. Want me to start?`;

test('C: "where do I stand": the answer (the pill\'s numbers), then the short step; again, one line; a changed score or a new session, the full answer', db, async () => {
  const { b, sr } = await asker('st');
  const r = await find(b, { ask: 'standing' });
  const s = show(r);
  const st = await standingOf(b.id);
  assert.ok(st.listed);
  const page = `earnkit.com/${b.handle.toLowerCase()}`;
  // No live clause: the test's live link is never checked (no network), so it is left out (fix round 1 (10)).
  const answer = `Score 77, #${st.rank} of ${st.total} builders so far. It comes from your GitHub: 6 weeks shipping in a row. Programs see it at ${page}.`;
  // Fix round 1 (5): the step is the short pointer; nothing the answer said is said again.
  assert.equal(s, `${answer}\n\n${pointerOf(sr.title, false)}`);
  assert.equal(moveUp(r)?.kind, 'apply');
  // Fix round 1 (8): the note never asks for a second answer.
  assert.ok(String(r.reply?.note).startsWith(ANSWERED_FIRST), String(r.reply?.note));
  assert.doesNotMatch(String(r.reply?.note), /answer it first/);
  assert.doesNotMatch(s, BAD);
  // The same ask again, nothing changed: one line, then the step's pointer.
  assert.equal(show(await find(b, { ask: 'standing' })), `Same as earlier: #${st.rank} of ${st.total}, score 77.\n\n${pointerOf(sr.title)}`);
  // No ask: the path alone. v4.8.1 Task 2 (R3): the session's first path reply that is no direct answer says the total.
  assert.equal(withTotal(show(await find(b))), easySplit(pointerOf(sr.title), 'Want me to start?'));
  // Fix round 1 (3): the score moved since: the full answer again, never "Same as".
  await setScore(b.id, 79);
  const moved = show(await find(b, { ask: 'standing' }));
  assert.match(moved, /^Score 79, #\d+ of \d+ builders so far\. It comes from your GitHub/, moved);
  assert.doesNotMatch(moved, /Same as/);
  // A new session (SESSION_MS of quiet): the full answer again.
  await backSession(b.id, SESSION_MS + 1000);
  assert.match(show(await find(b, { ask: 'standing' })), /^Score 79, #\d+ of \d+ builders so far\. /);
});

test('C (fix round 1 (2)): a builder not listed (held) gets no rank, as the page pill shows none', db, async () => {
  const { b } = await asker('ul');
  await sql()`UPDATE builder_profiles SET held = true WHERE builder_id = ${b.id}`;
  assert.equal((await standingOf(b.id)).listed, false);
  const p1 = show(await find(b, { ask: 'standing' })).split('\n\n')[0];
  assert.doesNotMatch(p1, /#\d/, p1);
  // The page shows no score off the leaderboard either (standing.ts pageScore), so the profile line.
  assert.equal(p1, `Your profile fills in as your commits come in. Programs see it at earnkit.com/${b.handle.toLowerCase()}.`);
});

test('C: a score of 0 or unknown gets no score and no rank: the profile fills in', db, async () => {
  const { b } = await asker('s0');
  await sql()`UPDATE builder_live SET score = 0, parts = ${sql().json({ shipping: { points: 0, raw: { mask: 0, live_ships: 0 } } } as never)} WHERE builder_id = ${b.id}`;
  const p1 = show(await find(b, { ask: 'standing' })).split('\n\n')[0];
  assert.equal(p1, `Your profile fills in as your commits come in. Programs see it at earnkit.com/${b.handle.toLowerCase()}.`);
});

test('C: "what can I apply to", first in a fresh session: the grants with fit, the investor program apart, the short step; the amount said once', db, async () => {
  const { b, sr } = await asker('pg');
  const r = await find(b, { ask: 'programs' });
  const s = show(r);
  const day = /closes ([A-Z][a-z]{2} \d{1,2})/.exec(s)?.[1];
  assert.equal(s, [
    'Grants open now:',
    '',
    'Base Builder Grant: up to $5,000, rolling. Your fit: 1 step, add Builder Codes.',
    // Fix round 1 (1): Circle funds apps on Arc, the fact B's why line reads.
    'Circle Developer Grants: $5,000 to $100,000 USDC grants, rolling. Your fit: not yet, needs Arc.',
    '',
    `${sr.title} (investor program): up to $1M, closes ${day}. a16z's 12-week startup program, in person in San Francisco.`,
    '',
    PREPARE_LINE_ONE,
    '',
    pointerOf(sr.title, false),
  ].join('\n'), s);
  // Fix round 1 (5): nothing said twice in the reply.
  assert.equal(s.match(/\$1M/g)?.length, 1, s);
  assert.doesNotMatch(s, /qualify|\btotal\b/i);
  assert.doesNotMatch(s, BAD);
  // Again, the same list: one line.
  assert.equal(show(await find(b, { ask: 'programs' })), `Same list as earlier.\n\n${pointerOf(sr.title)}`);
  // Fix round 1 (3): the list changed (Circle told applied): the full answer again, without it.
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, at) VALUES (${b.id}, '', 'circle-developer-grants', 'applied', now())`;
  const changed = show(await find(b, { ask: 'programs' }));
  assert.match(changed, /^Grants open now:\n\nBase Builder Grant: /, changed);
  assert.doesNotMatch(changed, /Circle|Same list/, changed);
});

test('C (fix round 1 (6)): a drafted grant reads "Drafted"; a grant parked by a no keeps its fit', db, async () => {
  const { b } = await asker('dg');
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('apply_yes', jsonb_build_object('circle-developer-grants', now()::text),
    'declined', COALESCE(standing_seen->'declined', '{}'::jsonb) || jsonb_build_object('path:base-builder-grants', now()::text)) WHERE builder_id = ${b.id}`;
  const s = show(await find(b, { ask: 'programs' }));
  assert.match(s, /\nBase Builder Grant: up to \$5,000, rolling\. Your fit: 1 step, add Builder Codes\.\n/, s);
  assert.match(s, /\nCircle Developer Grants: [^\n]+ Your fit: drafted\.\n/, s);
  assert.doesNotMatch(s, /not checked yet/);
});

test('C: on a quiet path (nothing to hook) the answer still comes first, above the reply that answers', db, async () => {
  const { b } = await asker('qt', ['circle-developer-grants']);
  const s = show(await find(b, { ask: 'standing' }));
  assert.match(s, /^Score 77, #\d+ of \d+ builders so far\. It comes from your GitHub: 6 weeks shipping in a row\. Programs see it at \S+\.\n\n./, s);
  assert.doesNotMatch(s, /Want me to start\?/);
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

test('C (fix round 1 (9)): signed out, or signed in with no code connected, a direct question keeps that state\'s reply and its one easy reply', db, async () => {
  await worldB();
  const b = await newcomer('naq');
  assertOpener(show(await outFind(b, { ask: 'programs' })));
  assert.ok((await attachToX(b.own, { id: `47${RUN}${n}`, username: b.handle, name: 'Maya Lin', avatar: null }, new Date())).ok);
  const s = show(await find(b, { ask: 'standing' }));
  assert.doesNotMatch(s, /Score \d+,|Grants open now|Same as/, s);
  assert.ok(/\?$/.test(s) || /https:\/\/\S+$/.test(s), s);
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
    assert.doesNotMatch(s, /Score 77,|Grants open now|Same as earlier|Same list as earlier/, s);
  }
  assert.deepEqual((await seenOf(b.id)).said, before.said);
});

/*
 * v4.8 Task 6: whole conversations as the merge gate (fixtures/converse.ts). Target A and B played as a lazy builder
 * replies, each reply checked by gateFailures.
 */
const BUILDER_CODES_FILE = { 'src/codes.ts': `export const SUFFIX = '0x046d617961000a${BUILDER_CODES_SUFFIX}'; Attribution.toDataSuffix({ codes: ['bc_earnkit'] });` };

/** A hand-made reply for the gate's own tests. */
const gr = (show: string, o: Partial<Reply> = {}): Reply => ({ turn: 0, session: 0, first: false, hook: false, tool: 'find', input: {}, show, said: [], reply: { show_to_builder: show }, ...o });
const rules = (rs: Reply[]) => gateFailures(rs).map((f) => `${f.turn}:${f.rule}`);
const OPENER_OK = gr("Jenil, Base Builder Grant pays up to $5,000. You've shipped 6 weeks in a row.\n\nWant the steps?", { first: true, hook: true });

const SIGNIN_URL = 'https://earnkit.com/signin/ctZ7e0DoAzqmuAQTYGh8gg';
const signIn = (show: string, o: Partial<Reply> = {}) => gr(show, { reply: { show_to_builder: show, move_up: { kind: 'sign_in', project_key: null } }, ...o });

test('gateFailures (Task 6): a good reply passes; every kind of break is caught with its turn', () => {
  assert.deepEqual(gateFailures([OPENER_OK]), []);
  // 1. No easy reply: an open question, a statement, two questions; the forms that are easy pass.
  assert.deepEqual(rules([gr('Here are your programs.\n\nWhat would you like to do?')]), ['0:easy_reply']);
  assert.deepEqual(rules([gr('Done.\n\nAnything else?')]), ['0:easy_reply']);
  assert.deepEqual(rules([gr('Your draft is saved.')]), ['0:easy_reply']);
  assert.deepEqual(rules([gr('Want the steps? Or should I draft it?')]), ['0:easy_reply']);
  assert.deepEqual(rules([gr('Want the steps?\n\nWant me to start?')]), ['0:easy_reply']);
  for (const ok of ['It takes me a few minutes. Draft it now?', 'Go?', 'Base pays up to $5,000. I can add them and push the change, about 10 minutes. Go?',
    'Reply "sent" once it\'s in, and I\'ll keep track of it for you.', 'Once it\'s submitted, reply "sent" and I\'ll keep track of it.',
    "Say ok once the change is pushed, and I'll check it.", "I'm checking the code now. Give it a minute, then say ok.", "Say ok once it's done, and I'll check it.",
    "Two blanks only you can fill: who's on the team, and any money you've raised. Reply with both and I'll finish it.", 'Reply with a number.'])
    assert.deepEqual(rules([gr(ok)]), [], ok);
  // Fix round 1b: the draft's blanks asks (1, 2, 3+ blanks) and the re-ask, one approved shape.
  for (const blanks of [['your demo video'], [...FOUNDER_BLANKS], ['a', 'b', 'c'], ['a', 'b', 'c', 'd']])
    for (const ask of [blanksAsk(blanks), blanksAgain(blanks)]) assert.deepEqual(rules([gr(ask)]), [], ask);
  // ... the sign-in link last, while the stored ask is sign_in (the opener, the pick).
  for (const ok of [`Reply with a number, and connect here so I can check if your work fits: ${SIGNIN_URL}`, `Got it: Circle. Connect here so I can check if your work fits: ${SIGNIN_URL}`])
    assert.deepEqual(rules([signIn(ok)]), [], ok);
  // ... a "?" inside a quoted draft or a table is not a second question.
  assert.deepEqual(rules([gr('> How does your product make money today?\n\n| Q | A |\n| Why now? | x |\n\nWant me to start?')]), []);
  // Fix round 1 (review 2): the false passes. Text after the question, a choice, an open request behind a yes/no word,
  // a request after the easy form, "Reply with it", any link but EarnKit's sign-in link with its stored ask.
  for (const bad of ['Want me to start? Or tell me what else you need.', 'Want help with it now? ok', 'Draft it now? It takes me a few minutes.',
    'Do you want Base, Arc or Circle?', 'Want the steps or the draft?', 'Can you tell me what your product does?', 'Is there something specific you want to build next?',
    'Reply with a number. Also tell me about your team, your raise and your goals.', 'Reply "sent" once in. Your team size?', 'Reply with it whenever.',
    "Reply with it and finish it yourself.", 'Reply with them.', 'Here is your plan. Connect here to see more: https://evil.example/x',
    `Reply with a number, or tell me about your plans.`])
    assert.deepEqual(rules([gr(bad)]), ['0:easy_reply'], bad);
  assert.deepEqual(rules([signIn('Here is your plan. Connect here to see more: https://evil.example/signin/ctZ7e0DoAzqmuAQTYGh8gg')]), ['0:easy_reply']);
  assert.deepEqual(rules([gr(`Got it: Circle. Connect here so I can check if your work fits: ${SIGNIN_URL}`)]), ['0:easy_reply']);
  assert.deepEqual(rules([signIn(`Which one do you want? Connect here: ${SIGNIN_URL}`)]), ['0:easy_reply']);
  // Fix round 2 (minor 3): nothing but the sign-in clause may follow the number clause.
  assert.deepEqual(rules([gr('Reply with a number and describe your product.')]), ['0:easy_reply']);
  for (const bad of [`Reply with a number and describe your product, and connect here so I can check if your work fits: ${SIGNIN_URL}`,
    `Reply 1 for Base and share your deck, and connect here so I can check if your work fits: ${SIGNIN_URL}`, `Connect here to see more: ${SIGNIN_URL}`])
    assert.deepEqual(rules([signIn(bad)]), ['0:easy_reply'], bad);
  for (const ok of [`Reply 1 for Base Builder Grant, 2 for Circle Developer Grants or 3 for a16z speedrun SR008, and connect here so I can check if your work fits: ${SIGNIN_URL}`,
    `Base Builder Grant isn't open now. Reply 1 for Circle Developer Grants, and connect here so I can check if your work fits: ${SIGNIN_URL}`])
    assert.deepEqual(rules([signIn(ok)]), [], ok);
  // 2. Empty.
  assert.deepEqual(rules([gr('')]), ['0:empty']);
  assert.deepEqual(rules([gr('  \n ')]), ['0:empty']);
  // 3. A paragraph repeated in a session (whitespace aside); the easy reply and a table header may repeat; a new session may.
  const para = 'Base Builder Grant pays up to $5,000.';
  assert.deepEqual(rules([gr(`${para}\n\nGo?`), gr(`${para.replace(' ', '  ')}\n\nWant the steps?`, { turn: 1 })]), ['1:repeat']);
  assert.deepEqual(rules([gr('One.\n\nGo?'), gr('Two.\n\nGo?', { turn: 1 })]), []);
  assert.deepEqual(rules([gr('One. Want help with it now?'), gr('Two. Want help with it now?', { turn: 1 })]), []);
  // ... but the same pointer twice is a repeat, its easy reply aside.
  const still = 'Still on Arc Microgrants: get EarnKit on Arc mainnet. Want help with it now?';
  assert.deepEqual(rules([gr(still), gr(still, { turn: 1 })]), ['1:repeat']);
  // ... and so is a paragraph said earlier inside a reply's last paragraph.
  assert.deepEqual(rules([gr(`${para}\n\nGo?`), gr(`${para} Want the steps?`, { turn: 1 })]), ['1:repeat']);
  assert.deepEqual(rules([gr('| Grant | Money |\n| A | $1 |\n\nGo?'), gr('| Grant | Money |\n| B | $2 |\n\nWant the steps?', { turn: 1 })]), []);
  assert.deepEqual(rules([gr(`${para}\n\nGo?`), gr(`${para}\n\nGo?`, { turn: 1, session: 1 })]), []);
  // Fix round 1 (review 4): a proof fact said twice in a session is a repeat, whatever sentence carries it (walk A's
  // investor hook and the next grant's hook); in a new session it may be said again.
  const opener = gr("Jenil, a16z closes tomorrow: up to $1M. You've shipped 6 weeks in a row and EarnKit is live, which is the traction they ask about.\n\nWant me to start?", { first: true, hook: true });
  const hook2 = (o: Partial<Reply>) => gr("Your closest money is Base Builder Grant: up to $5,000. You've shipped 6 weeks in a row and EarnKit is live.\n\nGo?", { turn: 1, hook: true, ...o });
  assert.deepEqual(rules([opener, hook2({})]), ['1:repeat']);
  assert.deepEqual(rules([opener, hook2({ session: 1, first: true })]), []);
  assert.deepEqual(rules([gr("You're live on Base. Want the steps?"), gr("Builder Codes are in. You're live on Base. Want me to draft it?", { turn: 1 })]), ['1:repeat']);
  // 4. No proof line on a session opener or a hook; a mid-session reply needs none; a signed-out opener (its `opener`
  // part) has no record yet.
  assert.deepEqual(rules([gr('Base Builder Grant pays up to $5,000.\n\nWant the steps?', { first: true })]), ['0:proof']);
  assert.deepEqual(rules([gr('Base Builder Grant pays up to $5,000.\n\nWant the steps?', { hook: true })]), ['0:proof']);
  assert.deepEqual(rules([gr('Base Builder Grant pays up to $5,000.\n\nWant the steps?')]), []);
  const out = `I'm EarnKit. I get builders funded for what they ship.\n\n1. Base: up to $5,000\n\nReply with a number, and connect here so I can check if your work fits: ${SIGNIN_URL}`;
  assert.deepEqual(rules([signIn(out, { first: true, said: ['opener'] })]), []);
  // Fix round 1 (review 3): the exemption is the `opener` part only, never the opener's words.
  assert.deepEqual(rules([signIn(out, { first: true })]), ['0:proof']);
  // ... a hook later in a session leans on the proof said earlier in it (ruling R6-8), never with none said.
  assert.deepEqual(rules([opener, gr('Your closest money is Base Builder Grant: up to $5,000.\n\nGo?', { turn: 1, hook: true })]), []);
  for (const proof of ['Score 77, #1 of 1 builders so far.', "You're live on Base.", 'Your streak is 7 weeks.', 'Your repo has 25 commits in 90 days.',
    'Since Friday: your score is up to 79.', 'Your app has 120 transactions on Base.', "You've shipped 6 weeks in a row.",
    'It comes from your GitHub: 6 weeks shipping in a row, live at earnkit.com.', 'Score 0 · Top 22% of builders. 6 weeks shipping in a row. No grants won yet.'])
    assert.deepEqual(rules([gr(`${proof}\n\nGo?`, { first: true })]), [], proof);
  // Fix round 2 (minor 2): "{name} is live" only for the builder's own project name or handle (the gate is told them).
  const named = (rs: Reply[]) => gateFailures(rs, { names: ['EarnKit', 'jenilt'] }).map((f) => `${f.turn}:${f.rule}`);
  assert.deepEqual(named([gr('EarnKit is live.\n\nGo?', { first: true })]), []);
  assert.deepEqual(named([gr('jenilt is live.\n\nGo?', { first: true })]), []);
  for (const other of ['Base Builder Grant is live.', 'Circle Developer Grants is live and open.'])
    assert.deepEqual(named([gr(`${other}\n\nGo?`, { first: true })]), ['0:proof'], other);
  assert.deepEqual(rules([gr('EarnKit is live.\n\nGo?', { first: true })]), ['0:proof']);
  // Fix round 1 (review 3): facts that are not the builder's never count.
  for (const none of ['Base Builder Grant pays up to $5,000 for onchain apps.', 'Applications go live on Nov 3.', 'The program is live now.', 'Start a streak this week.',
    '25 commits in 90 days.', 'Projects with 120 transactions do well.', 'Most winners have 6 weeks shipping in a row.'])
    assert.deepEqual(rules([gr(`${none}\n\nGo?`, { first: true })]), ['0:proof'], none);
  // ... nor does a session opener that says only "I'm EarnKit" to a signed-in builder (no `opener` part).
  assert.deepEqual(rules([gr("I'm EarnKit. I get builders funded for what they ship.\n\nWant the steps?", { first: true })]), ['0:proof']);
  // 5. Copy: an em dash, "coin", "points", an emoji.
  for (const bad of ['Base pays up to $5,000 — rolling.', 'Launch a coin.', 'You earned 5 points.', 'Nice work \u{1F680}.'])
    assert.deepEqual(rules([gr(`${bad}\n\nGo?`)]), ['0:copy'], bad);
  // ... never a word that only contains one ("pointer", "Coinbase").
  assert.deepEqual(rules([gr('A pointer to Coinbase.\n\nGo?')]), []);
  // 6. A claim: they qualify or are eligible, or EarnKit submitted, sent or filed it, or it's in.
  for (const bad of ['You qualify for Base.', "You're eligible for Base.", 'You now qualify to apply.', 'I submitted it for you.', "I've sent your application.", 'Your application was sent.',
    'Your application is in.', "I've filed it with Base.", 'All done, submitted it for you.', 'It is in.'])
    assert.deepEqual(rules([gr(`${bad}\n\nGo?`)]), ['0:claim'], bad);
  for (const ok of ['To qualify, EarnKit needs to add Builder Codes.\n\nGo?', 'Reply "sent" once it\'s in, and I\'ll keep track of it for you.', "Your fix is in the repo now.\n\nGo?"])
    assert.deepEqual(rules([gr(ok)]), [], ok);
  // Each failure names its turn and why.
  const [f] = gateFailures([gr('x'), gr('Done.\n\nAnything else?', { turn: 1 })].slice(1));
  assert.equal(f.turn, 1);
  assert.match(f.reason, /Anything else\?/);
});

test('askMismatch and lazyNext (Task 6 fix round 1, review 5): a tell answers the previous reply\'s structured ask', () => {
  const asked = (kind: string, show = 'Want me to start?') => gr(show, { reply: { show_to_builder: show, move_up: { kind, project_key: 'a/b' } } });
  assert.equal(askMismatch(asked('apply'), { move_up: { kind: 'apply', project_key: 'a/b', answer: 'yes' } }), null);
  assert.match(String(askMismatch(asked('qualify'), { move_up: { kind: 'apply', project_key: 'a/b', answer: 'yes' } })), /the reply asked/);
  assert.match(String(askMismatch(asked('apply'), { move_up: { kind: 'apply', project_key: 'c/d', answer: 'yes' } })), /the reply asked/);
  assert.match(String(askMismatch(null, { move_up: { kind: 'apply', project_key: null, answer: 'yes' } })), /asked nothing/);
  assert.equal(askMismatch(asked('apply', SENT_ASK), { program_status: [{ program_id: 'x', status: 'applied' }] }), null);
  assert.match(String(askMismatch(asked('apply'), { program_status: [{ program_id: 'x', status: 'applied' }] })), /"sent"/);
  const o = { blanks: 'just me', pushed: PUSHED_ASK };
  assert.deepEqual(lazyNext(asked('apply', SENT_ASK), o), { says: 'sent', tell: { move_up: { kind: 'apply', project_key: 'a/b', answer: 'sent' } } });
  assert.deepEqual(lazyNext(asked('apply', A_BLANKS), o), { says: 'just me', tell: { move_up: { kind: 'apply', project_key: 'a/b', answer: 'yes', blanks: 'just me' } } });
  assert.deepEqual(lazyNext(asked('qualify', 'Go?'), o), { says: 'ok', tell: { move_up: { kind: 'qualify', project_key: 'a/b', answer: 'yes' } } });
  assert.equal(lazyNext(asked('qualify', PUSHED_ASK), o), 'real_work');
  assert.equal(lazyNext(gr('Want me to start?'), o), null);
});

/** Walk A on the owner-like builder: opener, "sure", the blanks, "sent", "ok", the push, silence, two days later. */
async function walkA() {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants']);
  await sql()`UPDATE programs SET opened_at = now() - interval '30 days' WHERE id = 'base-builder-grants'`;
  const b = await owner('wa', { pick: sr.id });
  const live = (score: number) =>
    sql()`UPDATE builder_live SET score = ${score}, ranked = true, calibration = ${'v2-shipping'}, parts = ${sql().json({ shipping: { points: score, raw: { mask: 0b111111, live_ships: 0 } } } as never)} WHERE builder_id = ${b.id}`;
  await live(77);
  const turns: Turn[] = [
    { find: {} },
    { says: 'sure', tell: { move_up: { kind: 'apply', project_key: b.key, answer: 'yes' } } },
    { says: 'just me, nothing raised', tell: { move_up: { kind: 'apply', project_key: b.key, answer: 'yes', blanks: 'just me, nothing raised' } } },
    { says: 'sent', tell: { program_status: [{ program_id: sr.id, status: 'applied' }] } },
    { says: 'ok', tell: { move_up: { kind: 'qualify', project_key: b.key, answer: 'yes' } } },
    {
      says: 'ok', tell: { move_up: { kind: 'qualify', project_key: b.key, answer: 'yes' } },
      // The agent added Builder Codes and pushed (the fixture's fake GitHub).
      before: () => {
        b.gh.repos[b.key].files = BUILDER_CODES_FILE;
        (b.ctx as { codesFetch?: typeof fetch }).codesFetch = b.gh;
      },
    },
    { wait: 2 * 86_400_000 },
    {
      find: {},
      // Two days on: the score went up to 79 (the stored score of the last session's day was 77).
      before: async () => {
        const last = new Date(Date.now() - 2 * 86_400_000);
        await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held, ranked)
          VALUES (${b.id}, ${last.toISOString().slice(0, 10)}::date, 77, 0, '{}'::jsonb, '{}'::jsonb, 'v2', 'v2-shipping', false, true) ON CONFLICT (builder_id, day) DO UPDATE SET score = 77`;
        await live(79);
      },
    },
  ];
  return { sr, b, replies: await converse(b.ctx as never, turns, { builderId: b.id }) };
}

/** Walk B on a new builder: the opener (signed out), "2", connecting, "yes"; one conversation, each turn on the builder's context now. */
async function walkB() {
  await worldB();
  const b = await newcomer('wb');
  const call: Call = (tool, args) => withEnv(X_SECRET, () => mcpCall(b.ctx as never, tool, args, { format: true }));
  const replies = await converse(b.ctx as never, [
    { find: {} },
    { says: '2', find: { program: '2' } },
    { says: '(connects GitHub)', find: {}, before: () => connectB(b) },
    { says: 'yes', tell: { move_up: { kind: 'qualify', project_key: b.key, answer: 'yes' } } },
  ], { call, builderId: b.id });
  return { b, replies };
}

test('Task 6: walk A passes the merge gate on the fixtures', db, async () => {
  const { sr, b, replies } = await walkA();
  console.log(`\n=== WALK A ===\n${transcript(replies)}\n`);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], transcript(replies));
  // It is target A's path: the hook, the draft, submit, "sent" hooks Base, the codes, then a new session's draft offer.
  const ends = replies.map((r) => r.show.split('\n\n').at(-1));
  assert.deepEqual(replies.map((r) => [r.session, r.first, r.hook]), [[0, true, true], [0, false, false], [0, false, false], [0, false, true], [0, false, false], [0, false, false], [1, true, false]]);
  assert.deepEqual(ends, ['I can draft your application from your commits and live product in a few minutes. Want me to start?', A_BLANKS, SENT_ASK, OFFER, PUSHED_ASK, A_CODES_IN, DRAFT_NOW_ASK]);
  // Fix round 1 (review 4): the proof is said once a session, keyed on its facts: the Base hook after "sent" gives a new
  // one (target A, "you're live on Base"), never the opener's streak again; the codes reply none.
  assert.match(replies[3].show, /You're live on Base\./, replies[3].show);
  assert.doesNotMatch(replies[3].show, /shipped 6 weeks/, replies[3].show);
  assert.equal(replies[5].show, A_CODES_IN);
  assert.match(replies[6].show, /^Since [A-Z][a-z]+: your score is up to 79\. Base Builder Grant is still open and you now meet its first requirement\./, replies[6].show);
  const [row] = await sql()<{ status: string }[]>`SELECT status FROM builder_program_status WHERE installation_id = ${b.id} AND program_id = ${sr.id}`;
  assert.equal(row?.status, 'applied');
});

test('Task 6: walk B passes the merge gate on the fixtures', db, async () => {
  const { b, replies } = await walkB();
  console.log(`\n=== WALK B ===\n${transcript(replies)}\n`);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], transcript(replies));
  // It is target B's path: the opener, the pick, the connected line with the Base hook, then the steps.
  assertOpener(replies[0].show);
  assert.match(replies[1].show, /^Got it: Circle Developer Grants\. /);
  assert.ok(replies[2].show.startsWith(CONNECTED) && replies[2].hook, replies[2].show);
  assert.match(replies[3].show, /^Your next step toward Base Builder Grant:\n+1\. [^\n]*I can do this\./, replies[3].show);
  assert.deepEqual(replies.map((r) => [r.session, r.first]), [[0, true], [0, false], [0, false], [0, false]]);
  // Fix round 1 (review 10): a streak under 2 weeks is left out of the proof.
  assert.doesNotMatch(transcript(replies), /1 week in a row/);
});

/**
 * Fix round 1 (review 1): a step the agent can't do (Arc mainnet). Final review F3: the hook's yes is the help, its own
 * reply ending in the done ask, stored like the codes push; an ok re-checks: not done, it waits (parked) and the path
 * moves on in the same reply. Final review F2: it closes in 72 hours (a chain gap closing within 48 never leads), and
 * Base's passed step was raised already, so Arc is the hook.
 */
async function walkHelp(tag = 'hp') {
  const arc = committedProgram('arc-microgrants-studio', { keepContract: true });
  const p = ProgramFile.parse({ ...arc, id: `v48-${process.pid}-arch`, title: `Arc Help ${RUN}`, ends_at: new Date(Date.now() + 72 * 3_600_000).toISOString(), status: 'active', starts_at: null });
  await upsertProgram(p);
  // A second Arc copy closing in 10 days is the next program once this one waits (the same gap, a later close).
  const later = ProgramFile.parse({ ...arc, id: `v48-${process.pid}-arcn`, title: `Arc Next ${RUN}`, ends_at: new Date(Date.now() + 10 * 86_400_000).toISOString(), status: 'active', starts_at: null });
  await upsertProgram(later);
  await only([p.id, later.id, 'base-builder-grants']);
  const b = await owner(tag);
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('path_raised', jsonb_build_object('base-builder-grants', ${new Date(Date.now() - 86_400_000).toISOString()}::text)) WHERE builder_id = ${b.id}`;
  const turn = conversation(b.ctx as never, { builderId: b.id });
  const replies: Reply[] = [];
  /** The stored ask after each reply (fix round 2, minor 4). */
  const asks: Record<string, unknown>[] = [];
  const keep = async (r: Reply) => {
    replies.push(r);
    asks.push(((await seenOf(b.id)).bench_ask ?? {}) as Record<string, unknown>);
  };
  let r = (await turn({ find: {} }))!;
  await keep(r);
  // A lazy builder: "ok" to each reply's own ask, eight at most.
  for (let i = 0; i < 6; i++) {
    const t = lazyNext(r, { blanks: 'just me', pushed: PUSHED_ASK });
    if (!t || t === 'real_work') break;
    r = (await turn(t))!;
    await keep(r);
    // The park (or the next program's hook) ends the walk.
    if (r.hook || r.show.startsWith("I'll keep ")) break;
  }
  return { p, b, replies, asks, turn };
}

test('Task 6 fix round 1 (review 1), final F3: "ok" on a help step never repeats and never stalls; parked within two turns', db, async () => {
  const { p, b, replies, asks } = await walkHelp();
  console.log(`\n=== WALK HELP ===\n${transcript(replies)}\n`);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], transcript(replies));
  const name = programName(p.title);
  const [hook, help, next] = replies;
  assert.ok(hook.hook && hook.show.includes(name), hook.show);
  // Final review F3: the hook's yes is the help: its own reply, the done ask last, stored as a re-check ask.
  assert.equal(help.show, `Let's do it now: get EarnKit on Arc mainnet.\n\n${HELP_DONE_ASK}`);
  assert.deepEqual(moveUp({ isError: false, text: '', reply: help.reply })?.kind, 'check_fits');
  // Fix round 2 (minor 4): the stored ask is the re-check ask: help, checking, on this program, no ok yet.
  const pick = (a: Record<string, unknown>) => [a.kind, a.program_id, a.gap, a.help, a.checking, a.checks];
  assert.deepEqual(pick(asks[1]), ['check_fits', p.id, true, true, true, 0]);
  // An ok, not done: parked, and the path moves on to the next program in the same reply, never the step again.
  assert.ok(next.show.startsWith(`I'll keep ${name} for when it's done.\n\n`), next.show);
  assert.doesNotMatch(next.show.split('\n\n').slice(1).join(' '), new RegExp(name));
  assert.doesNotMatch(next.show, /get EarnKit on Arc mainnet/);
  assert.ok(next.hook && next.show.includes(`Arc Next ${RUN}`), next.show);
  // F4: greeted once this session (the opener), never again mid-reply.
  assert.doesNotMatch(next.show, /\n\nJenil, /, next.show);
  assert.equal(replies.length, 3, transcript(replies));
  // Fix round 2 (1): the help park is its own record (with the step), never a plain no.
  const seen = await seenOf(b.id);
  assert.equal((seen.declined as Record<string, string> | undefined)?.[`path:${p.id}`], undefined);
  assert.deepEqual(Object.keys((seen.help_parked ?? {}) as object), [p.id]);
  assert.equal(((seen.help_parked as Record<string, { step: string }>)[p.id]).step, 'on Arc mainnet');
});

test('Task 6 fix round 2 (1): a help park is re-checked once a session; the step met, the program is back on with what changed', db, async () => {
  const { p, b, replies, turn } = await walkHelp('hb');
  const name = programName(p.title);
  // Not met yet, a new session: still parked (checked once this session, not again).
  await turn({ wait: SESSION_MS + 60_000 });
  const still = (await turn({ find: {} }))!;
  assert.doesNotMatch(still.show, new RegExp(name), still.show);
  const checked = ((await seenOf(b.id)).help_parked as Record<string, { checked_at?: string }>)[p.id].checked_at;
  assert.ok(checked, 'the re-check is stamped');
  // The builder deploys on Arc (the facts EarnKit already reads: the project's chains).
  await sql()`UPDATE builder_projects SET chains = array_append(COALESCE(chains, '{}'), 'arc') WHERE builder_id = ${b.id} AND lower(project_key) = lower(${b.key})`;
  // Same session: not re-checked (at most once a session).
  assert.doesNotMatch((await turn({ find: {} }))!.show, /is back on/);
  // A new session: met, unparked, and its hook leads with what changed (closing in 40 hours now, it can be applied to now).
  await sql()`UPDATE programs SET ends_at = ${new Date(Date.now() + 40 * 3_600_000)} WHERE id = ${p.id}`;
  await turn({ wait: SESSION_MS + 60_000 });
  const back = (await turn({ find: {} }))!;
  assert.ok(back.show.startsWith(`You're on Arc now, so ${name} is back on.`), back.show);
  // It met the builder before (parked), so never "opened".
  assert.doesNotMatch(back.show, /opened/, back.show);
  assert.ok(back.hook && back.said.includes(`hook:${p.id}`), back.said.join());
  assert.equal(((await seenOf(b.id)).help_parked as Record<string, unknown>)[p.id], undefined);
  const all = [...replies, still, back].map((r, i) => ({ ...r, turn: i }));
  assert.deepEqual(gateFailures([still, back], { names: ['EarnKit', b.handle] }), [], transcript(all));
  console.log(`\n=== WALK BACK ON ===\n${transcript([still, back])}\n`);
});

test('Task 6 fix round 2 (1): a help park never met expires with DECLINE_MS', db, async () => {
  const { p, b, turn } = await walkHelp('hx');
  const parked = (await seenOf(b.id)).help_parked as Record<string, { at: string }>;
  parked[p.id].at = new Date(Date.now() - 31 * 86_400_000).toISOString();
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('help_parked', ${sql().json(parked as never)}::jsonb) WHERE builder_id = ${b.id}`;
  await turn({ wait: SESSION_MS + 60_000 });
  const r = (await turn({ find: {} }))!;
  assert.match(r.show, new RegExp(programName(p.title)), r.show);
  assert.doesNotMatch(r.show, /is back on/);
});

test('conversation (Task 6 fix round 1, review 8, 11): first and hook from the product; a wait checks the session ended; a tell must answer the ask', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants']);
  const b = await owner('cv');
  const turn = conversation(b.ctx as never, { builderId: b.id });
  // A wait with no session yet throws (nothing to end).
  await assert.rejects(turn({ wait: SESSION_MS + 1000 }), /no session to end/);
  const one = (await turn({ find: {} }))!;
  assert.deepEqual([one.first, one.hook], [true, true]);
  const two = (await turn({ find: {} }))!;
  assert.deepEqual([two.first, two.hook], [false, false]);
  // A wait shorter than a session's quiet throws: the next call would not be a new session.
  await assert.rejects(turn({ wait: 1000 }), /did not start a new session/);
  await turn({ wait: SESSION_MS + 60_000 });
  const three = (await turn({ find: {} }))!;
  assert.deepEqual([three.first, three.session], [true, 1]);
  assert.ok(three.said.includes(`hook:${sr.id}`), three.said.join());
  // A tell that names another ask than the reply's throws.
  await assert.rejects(turn({ tell: { move_up: { kind: 'qualify', project_key: b.key, answer: 'yes' } } }), /doesn't answer the previous reply's ask/);
});

/*
 * v4.8 final review fixes (final-review.md, "Fix now, in order"). Each item's test first.
 */

test('final F7: a no to a path ask hands off to find in the same tell: one line, then the next program, never a bare "Okay."', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants']);
  const b = await owner('fno', { pick: sr.id });
  assert.equal(moveUp(await find(b))?.kind, 'apply');
  const r = await tell(b, { kind: 'apply', project_key: b.key, answer: 'no' });
  const s = show(r);
  const [ack, ...rest] = s.split('\n\n');
  assert.equal(ack, `No problem, I'll set ${programName(sr.title)} aside.`, s);
  // The next program, from find run in this tell: Base, ending in its one easy reply.
  assert.match(rest.join('\n\n'), /Base Builder Grant/, s);
  assert.ok(s.endsWith(OFFER), s);
  assert.equal(moveUp(r)?.kind, 'qualify');
  // F4: the opener greeted this session, so the hand-off greets no one again.
  assert.doesNotMatch(s, /\n\nJenil, /, s);
  const declined = (await seenOf(b.id)).declined as Record<string, string>;
  assert.ok(declined[`path:${sr.id}`], JSON.stringify(declined));
});

test('final F7, F15: a lazy "no" walk passes the merge gate', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants']);
  const b = await owner('fnw', { pick: sr.id });
  const replies = await converse(b.ctx as never, [
    { find: {} },
    { says: 'no', tell: { move_up: { kind: 'apply', project_key: b.key, answer: 'no' } } },
    { says: 'no', tell: { move_up: { kind: 'qualify', project_key: b.key, answer: 'no' } } },
  ], { builderId: b.id });
  console.log(`\n=== WALK NO ===\n${transcript(replies)}\n`);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], transcript(replies));
  assert.ok(replies[1].hook, replies[1].show);
  assert.ok(replies[2].show.startsWith("No problem, I'll set Base Builder Grant aside."), replies[2].show);
});

test('final F8: a no at submit is "not yet": the stage and its ask stay, the reply is the pointer; the note says so', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants']);
  const b = await atSubmit('fns', sr.id);
  const r = await tell(b, { kind: 'apply', project_key: b.key, answer: 'no' });
  // Re-review blocker 2: the first no says it stays ready.
  assert.match(show(r), /^No rush, it stays ready until [^.]+\. Reply "sent" once it's in\.$/, show(r));
  assert.equal(moveUp(r)?.kind, 'apply');
  const seen = await seenOf(b.id);
  assert.equal((seen.path as { stage: string }).stage, 'submit');
  assert.equal((seen.bench_ask as { submit?: boolean }).submit, true);
  assert.equal(((seen.declined ?? {}) as Record<string, string>)[`path:${sr.id}`], undefined);
  // The next find still points back to it.
  assert.match(show(await find(b)), /ready to submit/);
  assert.match(noteOf(r), /won't apply/);
  assert.match(noteOf(r), /status: 'not_interested'/);
});

test('final F2 (pure): a grant whose gap the agent cannot do and that closes within 48 hours never leads; at equal gaps, doable first', () => {
  // After "sent" (a16z applied to): Arc closes in 10 hours with its chain gap, Base's passed codes step is raised.
  const arc10 = { ...ARC, ends_at: new Date(NOW.getTime() + 10 * 3_600_000).toISOString() };
  assert.deepEqual(bestMove(ctx({ grants: [arc10, BASE], investors: [A16Z], skip: new Set(['a16z-speedrun']) })), { kind: 'closest', program: BASE, raise: true });
  // Alone, it is no move.
  assert.deepEqual(bestMove(ctx({ grants: [arc10] })), { kind: 'quiet' });
  // Further out, equal gaps: the agent-doable one first, though Arc closes sooner.
  const arcLater = { ...ARC, ends_at: '2026-11-10T00:00:00Z', when: 'closes Nov 10' };
  const codesLater = { ...BASE, id: 'codes-later', ends_at: '2026-11-20T00:00:00Z', when: 'closes Nov 20' };
  const m = bestMove(ctx({ grants: [arcLater, codesLater] }));
  assert.equal(m.kind === 'closest' && m.program.id, 'codes-later');
  // A builder already on it (past the hook) keeps it.
  const on = bestMove(ctx({ grants: [arc10, BASE], path: { stage: 'gap', program_id: 'arc', at: NOW.toISOString() } }));
  assert.equal(on.kind !== 'quiet' && on.program.id, 'arc');
});

test('final F2: after "sent", with Arc closing tonight on a chain gap, the lead is Base Builder Codes with the passed-step line (target A)', db, async () => {
  const sr = await speedrun(30);
  const arc = committedProgram('arc-microgrants-studio', { keepContract: true });
  const p = ProgramFile.parse({ ...arc, id: `v48-${process.pid}-arcf2`, ends_at: new Date(Date.now() + 10 * 3_600_000).toISOString(), status: 'active', starts_at: null });
  await upsertProgram(p);
  await only([sr.id, p.id, 'base-builder-grants']);
  const b = await atSubmit('ff2', sr.id);
  const s = show(await mcpCall(b.ctx as never, 'tell', { program_status: [{ program_id: sr.id, status: 'applied' }] }));
  const [, hook, ask] = s.split('\n\n');
  assert.match(hook, /^Your closest money is Base Builder Grant: up to \$5,000\. [^\n]*Builder Codes[^\n]*You passed on them earlier today, but they're now the only gap to that money\./, s);
  assert.doesNotMatch(s, /Arc/, s);
  assert.equal(ask, OFFER, s);
});

test('final F3, F15 (pure): the gate fails one step said in more than two replies of a session', () => {
  const step = (show: string, turn: number, session = 0) => gr(show, { turn, session });
  const three = [
    step('Your next step toward Arc Microgrants:\n1. Get EarnKit on Arc mainnet.\n\nWant help with it now?', 0),
    step("Let's do it now: get EarnKit on Arc mainnet.\n\nSay ok once it's done, and I'll check it.", 1),
    step("Not done yet: get EarnKit on Arc mainnet. Say ok once it's done, and I'll check it.", 2),
  ];
  assert.deepEqual(rules(three), ['2:step']);
  assert.deepEqual(rules(three.slice(0, 2)), []);
  // A new session starts the count again.
  assert.deepEqual(rules([...three.slice(0, 2), { ...three[2], session: 1, first: true, said: ['proof:x'] }]), []);
});

test('final F3: one step the agent cannot do goes from the hook\'s yes straight to help; a find while helping says no step again; parked by the next ok', db, async () => {
  const arc = committedProgram('arc-microgrants-studio', { keepContract: true });
  const p = ProgramFile.parse({ ...arc, id: `v48-${process.pid}-arcf3`, title: `Arc Three ${RUN}`, ends_at: new Date(Date.now() + 72 * 3_600_000).toISOString(), status: 'active', starts_at: null });
  await upsertProgram(p);
  await only([p.id]);
  const b = await owner('ff3');
  const name = programName(p.title);
  const hook = await find(b);
  assert.ok(show(hook).includes(name) && show(hook).endsWith('Want the steps?'), show(hook));
  const help = await tell(b, { kind: 'check_fits', project_key: b.key, answer: 'yes' });
  assert.equal(show(help), `Let's do it now: get EarnKit on Arc mainnet.\n\n${HELP_DONE_ASK}`);
  // A find while the agent helps: a short line, never the step again.
  const mid = await find(b);
  assert.equal(show(mid), `Take your time with the ${name} step. ${HELP_DONE_ASK}`);
  assert.equal(moveUp(mid)?.kind, 'check_fits');
  // The next ok: not done, so it waits (parked), and the path moves on in the same reply.
  const ok = await tell(b, { kind: 'check_fits', project_key: b.key, answer: 'yes' });
  assert.ok(show(ok).startsWith(`I'll keep ${name} for when it's done.`), show(ok));
  assert.doesNotMatch(show(ok), /Not done yet|get EarnKit on Arc mainnet/, show(ok));
  assert.deepEqual(Object.keys(((await seenOf(b.id)).help_parked ?? {}) as object), [p.id]);
});

test('final F6: Builder Codes pushed, then two days of quiet: the first find re-checks and gives the closed reply', db, async () => {
  await only(['base-builder-grants']);
  const b = await owner('ff6');
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'declined' WHERE builder_id = ${b.id}`;
  await find(b);
  assert.match(show(await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' })), /^Adding Builder Codes to EarnKit/);
  await codesSettled();
  // The agent pushed; the session ends; two days pass (the yes, the session and any stored check all two days old).
  b.gh.repos[b.key].files = BUILDER_CODES_FILE;
  (b.ctx as { codesFetch?: typeof fetch }).codesFetch = b.gh;
  const twoDays = 2 * 86_400_000;
  const did = new Date(Date.now() - twoDays).toISOString();
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('gap_did', jsonb_build_object('base-builder-grants', ${did}::text)) WHERE builder_id = ${b.id}`;
  await sql()`UPDATE repo_builder_codes SET checked_at = ${new Date(Date.now() - twoDays - 3_600_000)} WHERE repo_key = ${b.key.toLowerCase()}`;
  await backSession(b.id, twoDays);
  // Nothing else changed (no "Since"): the closed reply, never "add Base's Builder Code" again.
  const r = show(await find(b));
  assert.equal(withTotal(r), easySplit(A_CODES_IN_PROOF, 'Want me to draft the Base application next?'));
});

test('final F1 (pure): the draft body is What it is and one Traction sentence from stored facts, then the page; never a bare label or "Shipping 77"', () => {
  const f = { score: 77, rank: '#1 of 1 builders so far', why: 'Code in 7 of the last 12 weeks, 4 of the last 4.', streak: 6, live: 'https://earnkit.com/', page: 'earnkit.com/jenilt', usedBy: null, revenue: null, stripe: null };
  assert.deepEqual(draftBody(f, 'a funding finder for builders'), [
    'What it is: a funding finder for builders.',
    'Traction: Shipped 6 weeks in a row, code in 7 of the last 12 weeks, and live at earnkit.com.',
    'Profile: earnkit.com/jenilt',
  ]);
  // No description stored: no What line (the agent writes it); verified usage and revenue join the one sentence.
  const more = { ...f, usedBy: { users: 40, returning: 3, capped: false }, revenue: { usd: 250, capped: false }, stripe: { usd: 1200, mrr: 300, capped: false } };
  const [t] = draftBody(more, null);
  assert.equal(t, 'Traction: Shipped 6 weeks in a row, code in 7 of the last 12 weeks, live at earnkit.com, used by 40 people in the last 30 days (verified onchain, 3 came back in a second week), $250 paid into its contracts by outside wallets in the last 30 days (verified onchain), and $1,200 received through Stripe in the last 30 days (verified from Stripe, $300 a month in subscriptions).');
  // Nothing verified: no Traction line, never an invented one.
  assert.deepEqual(draftBody({ ...f, why: 'No code in the last 12 weeks.', streak: 1, live: null }, null), ['Profile: earnkit.com/jenilt']);
  for (const l of draftBody(more, 'x')) assert.doesNotMatch(l, /Shipping \d|^From your ship log|^Live:|^Page:/);
  // The note asks for who it's for and why now from the README, in their voice, and never invented facts.
  const note = founderBriefNote('a16z speedrun SR008', 'k', { record: true });
  assert.match(note, /"Who it's for" and "Why now"/);
  assert.match(note, /README/);
  assert.match(note, /never invent traction, numbers or team/i);
  assert.doesNotMatch(note, /Keep the verified record's lines/);
});

test('final F5: a fresh session at the gap stage says the money once, then the step', db, async () => {
  await only(['base-builder-grants']);
  const b = await owner('ff5');
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'declined' WHERE builder_id = ${b.id}`;
  await find(b);
  await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' });
  await codesSettled();
  await backSession(b.id, SESSION_MS + 60_000);
  const r = withTotal(show(await find(b)));
  assert.equal(r, `Jenil, Base Builder Grant pays up to $5,000, and you're one step away: add Base's Builder Code to your app, a one-line tag Base uses to see your traffic. Guide: ${GUIDE} You're live on Base.\n\nWant me to do it now?`);
  assert.ok(((await seenOf(b.id)).said as { keys: string[] }).keys.includes('money:base-builder-grants'));
  // Again in the same session: the pointer, no money.
  assert.ok(show(await find(b)).startsWith('Still on Base Builder Grant: '));
});

test('final 9 (pure): standingParagraph at score 0 says neither the score nor the rank; one investor program, "If it\'s your plan"', () => {
  const s = { score: 0, rank: 'Top 22% of builders', streak: 6, wonUsd: 0, applied: 0, drafts: 0, next: null };
  assert.equal(standingParagraph(s), '6 weeks shipping in a row. No grants won yet.');
  assert.equal(standingParagraph({ ...s, score: 77 }), 'Score 77 · Top 22% of builders. 6 weeks shipping in a row. No grants won yet.');
  const g = [{ title: 'Base Builder Grant Program', amount: 'up to $5,000', when: 'rolling', fit: 'Fits' }];
  const inv = { title: 'a16z speedrun SR008', amount: 'up to $1M', when: 'closes Nov 1', what: 'Investor program' };
  assert.ok(programsAnswer(g, [inv]).endsWith("\n\nIf it's your plan, I can help you prepare."));
  assert.ok(programsAnswer(g, [inv, { ...inv, title: 'Alliance' }]).endsWith(`\n\n${PREPARE_LINE}`));
});

test('final 9: a same-program pick keeps its stage', db, async () => {
  await worldB();
  const b = await newcomer('same');
  await outFind(b);
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('path', jsonb_build_object('stage', 'gap', 'program_id', 'base-builder-grants', 'at', ${new Date(Date.now() - 60_000).toISOString()}::text)) WHERE builder_id = ${b.id}`;
  await outFind(b, { program: '1' });
  const path = (await seenOf(b.id)).path as { stage: string; program_id: string };
  assert.deepEqual([path.stage, path.program_id], ['gap', 'base-builder-grants']);
});

test('final 9 (F11): a shared client whose own installation is signed in to X gets no path and nothing path is written', db, async () => {
  await speedrun(30);
  const b = await owner('shx');
  const before = await seenOf(b.id);
  const t = `ek_v48_sharedx_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const other = (await connectInstallation(t))!.own;
  await sql()`UPDATE installations SET x_user_id = ${`x${other}`} WHERE id = ${other}`;
  const shared = { ...(b.ctx as object), sharedClient: true, ownInstallationId: other };
  for (const tool of ['find', 'score'] as const) {
    const r = await mcpCall(shared as never, tool, {});
    assert.doesNotMatch(show(r), /speedrun|Want me to start\?|Want the steps\?/, show(r));
    assert.ok(!String(r.reply?.note).endsWith(MENTOR_NOTE));
  }
  // The Bench's own gate (the tools answer a shared client before it): the path waits for a client of its own, since
  // tell answers every move_up from a shared client with the shared note.
  const direct = await benchScore(shared as never, new Date());
  assert.ok(!String(direct?.note ?? '').endsWith(MENTOR_NOTE), String(direct?.show_to_builder));
  const after = await seenOf(b.id);
  for (const k of ['path', 'said', 'path_raised']) assert.deepEqual(after[k], before[k], k);
  assert.notEqual((after.bench_ask as { path?: boolean } | undefined)?.path, true);
});

/*
 * v4.8 final re-review blockers (final-rereview.md): the quiet reply's easy reply, a repeated no at submit, and minors.
 */

test('re-review blocker 1: no, no, then find: the quiet reply always ends in one easy reply ("more"), through the gate; "more" is the programs answer', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id]);
  const b = await owner('qm');
  const turn = conversation(b.ctx as never, { builderId: b.id });
  const replies: Reply[] = [];
  let r = (await turn({ find: {} }))!;
  replies.push(r);
  for (let i = 0; i < 2; i++) {
    const m = r.reply?.move_up as { kind: string; project_key: string | null };
    r = (await turn({ says: 'no', tell: { move_up: { kind: m.kind, project_key: m.project_key, answer: 'no' } } }))!;
    replies.push(r);
  }
  r = (await turn({ find: {} }))!;
  replies.push(r);
  console.log(`\n=== WALK NO NO FIND ===\n${transcript(replies)}\n`);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], transcript(replies));
  assert.ok(r.show.endsWith(MORE_ASK), r.show);
  assert.equal((r.reply?.move_up as { kind: string }).kind, 'more');
  // Its answer ("more"): the programs answer, in the same tell.
  const more = await tell(b, { kind: 'more', project_key: b.key, answer: 'yes' });
  assert.match(show(more), /^(Grants open now:|No grants are open right now\.)/, show(more));
});

test('re-review blocker 2: no at submit twice: "No rush" once, then the next program; the application waits for the next session', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id, 'base-builder-grants']);
  const b = await atSubmit('sn2', sr.id);
  const turn = conversation(b.ctx as never, { builderId: b.id });
  // conversation's ask check needs the reply it follows: the submit pointer (a find) first.
  const replies: Reply[] = [(await turn({ find: {} }))!];
  replies.push((await turn({ says: 'no', tell: { move_up: { kind: 'apply', project_key: b.key, answer: 'no' } } }))!);
  assert.match(replies[1].show, /^No rush, it stays ready until [^.]+\. Reply "sent" once it's in\.$/, replies[1].show);
  replies.push((await turn({ says: 'no', tell: { move_up: { kind: 'apply', project_key: b.key, answer: 'no' } } }))!);
  assert.doesNotMatch(replies[2].show, /ready to submit|No rush/, replies[2].show);
  // Last ruling 2: the hand-off leads with the kept draft.
  assert.ok(replies[2].show.startsWith(`I'll keep your ${programName(sr.title)} draft ready.\n\n`), replies[2].show);
  assert.match(replies[2].show, /Base Builder Grant/, replies[2].show);
  replies.push((await turn({ find: {} }))!);
  assert.doesNotMatch(replies[3].show, /ready to submit|No rush/, replies[3].show);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], transcript(replies));
  // Kept drafted, never parked; the next session's opener points to it again.
  const seen = await seenOf(b.id);
  assert.equal(((seen.declined ?? {}) as Record<string, string>)[`path:${sr.id}`], undefined);
  await backSession(b.id, SESSION_MS + 60_000);
  assert.match(show(await find(b)), new RegExp(`${sr.title} application is ready to submit`));
});

test('re-review minor: the Builder Codes re-check runs at most once a session', db, async () => {
  await only(['base-builder-grants']);
  const b = await owner('rc1');
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'declined' WHERE builder_id = ${b.id}`;
  await find(b);
  await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' });
  await codesSettled();
  let calls = 0;
  (b.ctx as { codesFetch?: typeof fetch }).codesFetch = (async () => {
    calls++;
    throw new Error('GitHub down');
  }) as typeof fetch;
  await find(b);
  await codesSettled();
  const first = calls;
  assert.ok(first > 0, 'the first find re-checks');
  // Past the 2-minute backoff, the same session: never a second re-check.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('gap_check_failed', ${new Date(Date.now() - 5 * 60_000).toISOString()}::text) WHERE builder_id = ${b.id}`;
  await find(b);
  await codesSettled();
  assert.equal(calls, first);
});

test('re-review minor: a picked grant that closes within 48 hours on a step the agent cannot do says so in one line, then the closer money', db, async () => {
  const arc = committedProgram('arc-microgrants-studio', { keepContract: true });
  const p = ProgramFile.parse({ ...arc, id: `v48-${process.pid}-arcts`, title: `Arc Soon ${RUN}`, ends_at: new Date(Date.now() + 20 * 3_600_000).toISOString(), status: 'active', starts_at: null });
  await upsertProgram(p);
  await only([p.id, 'base-builder-grants']);
  const b = await owner('ts');
  await sql()`UPDATE builder_profiles SET standing_seen = (standing_seen - 'declined') || jsonb_build_object('path', jsonb_build_object('stage', 'hook', 'program_id', ${p.id}::text, 'at', now()::text, 'picked', true)) WHERE builder_id = ${b.id}`;
  const s = show(await find(b));
  assert.ok(s.startsWith(`Arc Soon ${RUN} closes too soon to get EarnKit on Arc mainnet done, so here's closer money. Base Builder Grant pays`), s);
  assert.ok(s.endsWith(OFFER), s);
  // Said once: the next find is the hook's pointer, no second line.
  assert.doesNotMatch(show(await find(b)), /closes too soon/);
});

test('last ruling 1 (pure): the gate takes "Reply with a program\'s name and I\'ll start on it." as the one easy reply', () => {
  assert.deepEqual(rules([gr(`Grants open now:\n\nBase Builder Grant: up to $5,000, rolling. It fits.\n\n${NAME_ASK}`)]), []);
});

test('last ruling 1: no, no, "more", then a name: the list ends with the name ask; the name is the pick (its no cleared); through the gate', db, async () => {
  const sr = await speedrun(30);
  await only([sr.id]);
  const b = await owner('nm');
  const turn = conversation(b.ctx as never, { builderId: b.id });
  const replies: Reply[] = [];
  let r = (await turn({ find: {} }))!;
  replies.push(r);
  for (let i = 0; i < 2; i++) {
    const m = r.reply?.move_up as { kind: string; project_key: string | null };
    r = (await turn({ says: 'no', tell: { move_up: { kind: m.kind, project_key: m.project_key, answer: 'no' } } }))!;
    replies.push(r);
  }
  r = (await turn({ says: 'more', tell: { move_up: { kind: 'more', project_key: b.key, answer: 'yes' } } }))!;
  replies.push(r);
  assert.ok(r.show.includes(`${sr.title} (investor program)`), r.show);
  assert.ok(r.show.endsWith(NAME_ASK), r.show);
  r = (await turn({ says: 'speedrun', find: { program: 'speedrun' } }))!;
  replies.push(r);
  console.log(`\n=== WALK NO NO MORE NAME ===\n${transcript(replies)}\n`);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], transcript(replies));
  assert.match(r.show, new RegExp(`${sr.title}[^\n]*Want me to start\\?$`), r.show);
  const seen = await seenOf(b.id);
  const declined = (seen.declined ?? {}) as Record<string, string>;
  assert.equal(declined[`path:${sr.id}`], undefined);
  assert.equal(declined[`apply:${sr.id}`], undefined);
  assert.deepEqual([(seen.path as { program_id: string }).program_id, (seen.path as { picked?: boolean }).picked], [sr.id, true]);
});
