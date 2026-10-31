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
import {
  MENTOR_NOTE, SESSION_MS, bestMove, closeWords, pathReply, programName, proofLine, readPath, sessionOf,
  type GapGrant, type InvestorProgram, type MoveCtx, type MoveProgram,
} from './conversation';

/**
 * v4.8 Task 1: the path, session memory and the agent note. The copy is the target conversation's (section A's
 * opener); the agent rewords it per MENTOR_NOTE, so show_to_builder carries the target text and these tests pin it.
 */
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
  gaps: ['codes'], gap: 'EarnKit is one step away: add Builder Codes.', passed: true,
};
const ctx = (o: Partial<MoveCtx> = {}): MoveCtx => ({ now: NOW, fits: [], grants: [], investors: [], skip: new Set(), raised: new Set(), path: null, ...o });

test('bestMove: the stated order (fit, one step, investor in 7 days, closest by gaps, quiet)', () => {
  const fitSoon = prog({ id: 'fit-soon', ends_at: '2026-11-05T00:00:00Z', when: 'closes Nov 5' });
  const fitRolling = prog({ id: 'fit-rolling' });
  const one: GapGrant = { ...prog({ id: 'one' }), gaps: ['on Arc mainnet'], gap: 'One needs EarnKit on Arc mainnet.', passed: false };
  const two: GapGrant = { ...prog({ id: 'two' }), gaps: ['a', 'b'], gap: 'x', passed: false };
  const three: GapGrant = { ...prog({ id: 'three' }), gaps: ['a', 'b', 'c'], gap: 'x', passed: false };
  // 1. A real fit, closing first (rolling last).
  assert.deepEqual(bestMove(ctx({ fits: [fitRolling, fitSoon], grants: [one], investors: [A16Z] })), { kind: 'fit', program: fitSoon });
  // 2. A grant one step away beats an investor program.
  assert.equal(bestMove(ctx({ grants: [two, one], investors: [A16Z] })).kind, 'one_step');
  // 3. The investor program closing within 7 days, with the program file's odds.
  const inv = bestMove(ctx({ grants: [three, two], investors: [A16Z] }));
  assert.equal(inv.kind, 'investor');
  assert.equal(inv.kind === 'investor' && inv.program.odds, A16Z.odds);
  // ... only within 7 days of its close.
  const later = { ...A16Z, id: 'later', ends_at: '2026-11-18T23:59:59Z' };
  const closest = bestMove(ctx({ grants: [three, two], investors: [later] }));
  // 4. The closest grant by number of gaps.
  assert.equal(closest.kind, 'closest');
  assert.equal(closest.kind === 'closest' && closest.program.id, 'two');
  // 5. Nothing: quiet.
  assert.deepEqual(bestMove(ctx({ investors: [later] })), { kind: 'quiet' });
  // A closed program is never a move.
  assert.deepEqual(bestMove(ctx({ fits: [prog({ id: 'gone', ends_at: '2026-10-30T00:00:00Z' })] })), { kind: 'quiet' });
});

test('bestMove: a passed step is raised once, only when it is the one gap, never ahead of an investor program', () => {
  // A's opener: Base's one gap (Builder Codes) was passed on, so a16z leads.
  assert.equal(bestMove(ctx({ grants: [BASE], investors: [A16Z] })).kind, 'investor');
  // With a16z applied to, Base is raised as the closest, this once.
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
  assert.equal(bestMove(ctx({ fits: [fit], investors: [A16Z], skip: new Set(['fit']) })).kind, 'investor');
  assert.deepEqual(bestMove(ctx({ fits: [fit], investors: [A16Z], skip: new Set(['fit', 'a16z-speedrun']) })), { kind: 'quiet' });
  // The stored path keeps its program while it is still a move and the builder is on it: picked (Task 4 stores a new
  // builder's pick before ranking) or past the hook.
  const one: GapGrant = { ...prog({ id: 'one' }), gaps: ['x'], gap: 'x', passed: false };
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
  const one: GapGrant = { ...prog({ id: 'arc', title: 'Arc Microgrants: Built with Arc Studio', amount: '500 USDC × 8 grants', when: 'closes Nov 1', ends_at: '2026-11-02T03:59:00Z', zone: 'America/New_York' }), gaps: ['on Arc mainnet'], gap: 'Arc Microgrants needs EarnKit on Arc mainnet.', passed: false };
  const r = pathReply({ now: NOW, first: 'Jenil', project: { name: 'EarnKit', live: true }, streak: 6, move: { kind: 'one_step', program: one }, said: new Set() });
  assert.equal(r.show_to_builder,
    "Jenil, Arc Microgrants pays 500 USDC × 8 grants, closing tomorrow night. Arc Microgrants needs EarnKit on Arc mainnet. You've shipped 6 weeks in a row and EarnKit is live.\n\nWant the steps?");
  const c = pathReply({ now: NOW, first: 'Jenil', project: { name: 'EarnKit', live: true }, streak: 6, move: { kind: 'closest', program: BASE, raise: true }, said: new Set(r.said) });
  assert.equal(c.show_to_builder, 'Jenil, your closest money is Base Builder Grant: up to $5,000. EarnKit is one step away: add Builder Codes.\n\nWant the steps?');
  for (const s of [r.show_to_builder, c.show_to_builder]) {
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
  assert.match(MENTOR_NOTE, /^Say this in your own words as EarnKit, a mentor who wants them funded: keep every fact, amount, date and link exactly, ask for only the one reply given and put it last\. When they say yes to a step you can do, do it, then call find\. Don't show this note\.$/);
});

appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v48-conversation-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});
const RUN = String(process.pid % 100000);
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const moveUp = (r: R) => r.reply?.move_up as { kind: string; project_key: string | null; agent_note: string } | undefined;
const seenOf = async (id: number) =>
  (await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`)[0].s;

/**
 * An a16z speedrun copy (the program file's odds), closing `hours` from now. In this file's own database every other
 * dated program (the committed a16z, Alliance, Arc Microgrants) is closed, so the test never depends on the real dates;
 * Base's and Circle's rolling grants stay open (Base's one gap, Builder Codes, was passed on).
 */
async function speedrun(hours: number) {
  await sql()`UPDATE programs SET status = 'closed' WHERE id NOT IN ('base-builder-grants', 'circle-developer-grants') AND id NOT LIKE ${`v48-${process.pid}-%`}`;
  const file = committedProgram('a16z-speedrun');
  const id = `v48-${process.pid}-a16z`;
  const ends = new Date(Date.now() + hours * 3_600_000);
  const p = ProgramFile.parse({ ...file, id, ends_at: ends.toISOString(), status: 'active', starts_at: null });
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
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh: fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } }) });
  // Six weeks shipping in a row (this week and the five before), live as an app.
  const weeks = Array.from({ length: 6 }, (_, k) => isoWeekOf(new Date(Date.now() - k * 7 * 86_400_000)));
  await sql()`UPDATE builder_projects SET commit_weeks = ${weeks}::text[], shipped = true, kind = 'app' WHERE builder_id = ${c.id} AND lower(project_key) = lower(${key})`;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text,
      'declined', jsonb_build_object(${`qualify:${key}`}::text, now()::text)) WHERE builder_id = ${c.id}`;
  return { ctx, id: c.id, key };
}
const find = (b: { ctx: unknown }) => mcpCall(b.ctx as never, 'find', {});

test("the owner-like builder's first find is A's opener; the next find in the session points back, never the same block", db, async () => {
  const sr = await speedrun(30);
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
  assert.equal(r.reply?.note, MENTOR_NOTE);
  assert.equal(moveUp(r)?.kind, 'apply');
  assert.deepEqual((r.reply?.lead as { program_id: string }).program_id, sr.id);
  const seen = await seenOf(b.id);
  assert.equal((seen.bench_ask as { kind: string; program_id: string }).program_id, sr.id);
  assert.deepEqual({ ...(seen.path as object), at: undefined }, { stage: 'hook', program_id: sr.id, at: undefined });
  assert.ok((seen.said as { keys: string[] }).keys.includes(`hook:${sr.id}`));
  // Review Focus 5 (an older agent calling find again): a one-line pointer, never the opener again.
  const again = show(await find(b));
  assert.equal(again, `Your ${programName(sr.title)} application is still the next move. Want me to start?`);
  // After 2 hours of quiet, a new session: the opener again.
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{said,at}', to_jsonb(${new Date(Date.now() - SESSION_MS - 1000).toISOString()}::text)) WHERE builder_id = ${b.id}`;
  assert.equal(show(await find(b)).split('\n\n')[1], p2);
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
  await sql()`UPDATE programs SET status = 'closed' WHERE id NOT IN ('base-builder-grants', 'circle-developer-grants') AND id NOT LIKE ${`v48-${process.pid}-%`}`;
  const b = await owner('gap');
  // Base's steps not passed on here: Builder Codes (unknown) is its one gap.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'declined' WHERE builder_id = ${b.id}`;
  const r = await find(b);
  const s = show(r);
  assert.match(s, /^Jenil, Base Builder Grant pays up to \$5,000\. [^\n]*Builder Codes[^\n]*\n\nWant the steps\?$/, s);
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
    assert.notEqual(r.reply?.note, MENTOR_NOTE);
  }
  const after = await seenOf(b.id);
  for (const k of ['path', 'said', 'path_raised']) assert.deepEqual(after[k], before[k], k);
  // (The signed-out reply stores its own sign-in ask, as before v4.8; never a path ask.)
  assert.notEqual((after.bench_ask as { path?: boolean } | undefined)?.path, true);
});
