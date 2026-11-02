import './fixtures/no-network-checks';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { PATH_ANSWER_FIRST, moneyLine, passedLine, pointerReply } from './conversation';
import { committedProgram } from './fixtures/program-file';
import type { Card } from './present';
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
import { MORE_ASK, NAME_ASK, WAIT_NOTE, closingPrograms, codesSettled } from './bench-find';
import { GitHubBudgetStop, type ReaderDeps } from './source-readers';
import { dropPrograms, dropRunPrograms } from './fixtures/programs-cleanup';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { closesIn, endsCell, summaryIn, withClosesIn } from './entry-text';
import { programGuide } from './guide';
import { fullProgramTable } from './present';
import { readGuidePage } from './landing';

/*
 * v4.8.2 Task 1 (R1, R2): the owner's dogfood of v4.8.1. The reasoned pointer is followed by "more" (no short
 * "Still {Program}. Reply "no"..." nag), and the passed-step line never says when the builder passed (no guilt).
 */

const NOW = new Date('2026-11-01T10:31:00Z');
const BAD = /—|\bcoins?\b|\bpoints?\b|\p{Extended_Pictographic}/iu;
const POINTER = 'Base Builder Grant is still your best move: up to $5,000, one step away. I can add Builder Codes and push the change, about 10 minutes. Go?';

test('v4.8.2 R2: the passed-step line says only that it is the only gap (final fix F5: Builder Codes named)', () => {
  assert.equal(passedLine(true), "That's now the only gap to that money.");
  assert.equal(passedLine(), "It's now the only gap to that money.");
});

test('v4.8.2 R1: the second pointer is "more", never the short "Reply no" pointer', () => {
  const facts = { id: 'base', title: 'Base Builder Grant', amount: 'up to $5,000', when: 'rolling', ends_at: null, zone: 'UTC', gaps: 1, stage: 'hook' as const, drafted: false };
  const first = pointerReply(facts, 'Go?', new Set(), NOW);
  assert.deepEqual(first, { text: 'Base Builder Grant is still your best move: up to $5,000, one step away. Go?', said: ['point:base'], more: false, ready: false, again: false });
  const more = pointerReply(facts, 'Go?', new Set(first.said), NOW);
  assert.deepEqual(more, { text: MORE_ASK, said: ['more:base'], more: true, ready: false, again: false });
  // v4.8.2 final fix (F1): the "more" line a second time this session is `again` (the agent is told to wait).
  assert.deepEqual(pointerReply(facts, 'Go?', new Set([...first.said, ...more.said]), NOW), { text: MORE_ASK, said: ['more:base'], more: true, ready: false, again: true });
});

appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v482-fixes-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await codesSettled();
  await dropRunPrograms();
  await sql().end();
});
const RUN = String(process.pid % 100000);
let n = 0;
/** The readers stop as a spent budget (v481-fixes.test.ts QUIET). */
const QUIET = new Proxy({}, {
  get: (_t, k) => (k === 'now' ? new Date() : k === 'ghSpent' ? () => true : k === 'requests' ? { tick: null } : async () => { throw new GitHubBudgetStop(); }),
}) as ReaderDeps;
/**
 * The owner-like builder (v481-fixes.test.ts ownerDb, its own copy as each test file keeps one): X name "Jenil T",
 * project EarnKit, its repo proven by the App, live and on Base, six weeks shipping, Builder Codes passed on today.
 */
async function ownerDb(tag: string) {
  n++;
  const t = `ek_v482_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `jg${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `482${RUN}${n}${tag.length}`, username: handle, name: 'Jenil T', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  await walletOffered(c.id);
  const key = `jg${tag}${RUN}/earnkit`;
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'earnkit', url: `https://github.com/${key}`, homepage: 'https://earnkit.com', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{ repo: 'earnkit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true, verdicts: [] }];
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, readerDeps: QUIET, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  await mcpCall(ctx, 'find', { identity: { project: { name: 'EarnKit', repo: `https://github.com/${key}`, live_url: 'https://earnkit.com' } } });
  const gid = 82000 + n * 10 + (Number(RUN) % 7);
  const gh = fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  const weeks = Array.from({ length: 6 }, (_, k) => isoWeekOf(new Date(Date.now() - k * 7 * 86_400_000)));
  await sql()`UPDATE builder_projects SET commit_weeks = ${weeks}::text[], shipped = true, kind = 'app' WHERE builder_id = ${c.id} AND lower(project_key) = lower(${key})`;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text,
      'declined', jsonb_build_object(${`qualify:${key}`}::text, now()::text)) WHERE builder_id = ${c.id}`;
  return { ctx, id: c.id, key, handle };
}

test('v4.8.2 R1+R2: five plain finds on the owner shape: the hook, the reasoned pointer, then "more" three times; the gate passes', db, async () => {
  const b = await ownerDb('pt5');
  const replies = await converse(b.ctx as never, Array.from({ length: 5 }, () => ({ find: {} })), { builderId: b.id });
  const t = transcript(replies);
  assert.equal(replies.length, 5, t);
  assert.ok(replies[0].hook, t);
  assert.match(replies[0].show, /Builder Codes[^\n]*\. That's now the only gap to that money\./, t);
  assert.equal(replies[1].show, POINTER, t);
  for (const r of replies.slice(2)) {
    assert.equal(r.show, MORE_ASK, t);
    assert.equal((r.reply?.move_up as { kind: string }).kind, 'more', t);
  }
  // v4.8.2 final fix (F1): from the first "more" (find 3) the agent note tells the agent to wait for the builder
  // (no find until they speak). The builder text is the same.
  const note = (r: (typeof replies)[number]) => String(r.reply?.note ?? '');
  // (tools.ts withFacts puts PATH_ANSWER_FIRST first on every find path note; the wait note follows it.)
  for (const r of replies.slice(2)) assert.ok(note(r).startsWith(`${PATH_ANSWER_FIRST} ${WAIT_NOTE} `), note(r));
  for (const r of replies.slice(0, 2)) assert.ok(!note(r).includes(WAIT_NOTE), note(r));
  for (const r of replies) {
    assert.doesNotMatch(r.show, /Reply "no"|Still Base|You passed/, t);
    assert.doesNotMatch(r.show, BAD, t);
  }
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], t);
});

test('v4.8.2 final fix (F1): after the programs answer, the name ask again carries the wait note', db, async () => {
  const b = await ownerDb('ptw');
  const replies = await converse(b.ctx as never, [
    { find: {} }, { find: {} }, { find: {} },
    { says: 'more', tell: { move_up: { kind: 'more', project_key: b.key, answer: 'yes' } } },
    { find: {} }, { find: {} },
  ], { builderId: b.id });
  const t = transcript(replies);
  assert.ok(replies[3].show.endsWith(NAME_ASK), t);
  for (const r of replies.slice(4)) {
    assert.equal(r.show, NAME_ASK, t);
    assert.equal((r.reply?.move_up as { kind: string }).kind, 'name', t);
    assert.ok(String(r.reply?.note ?? '').startsWith(`${PATH_ANSWER_FIRST} ${WAIT_NOTE} `), String(r.reply?.note));
  }
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], t);
});

test('v4.8.2 R1: a no to the reasoned pointer still parks the program', db, async () => {
  const b = await ownerDb('ptn');
  const replies = await converse(b.ctx as never, [
    { find: {} }, { find: {} },
    { says: 'no', tell: { move_up: { kind: 'qualify', project_key: b.key, answer: 'no' } } },
    { find: {} },
  ], { builderId: b.id });
  const t = transcript(replies);
  assert.equal(replies[1].show, POINTER, t);
  assert.equal((replies[1].reply?.move_up as { kind: string }).kind, 'qualify', t);
  const next = replies.at(-1)!;
  assert.ok(next.show.trim(), t);
  assert.doesNotMatch(next.show, /Base Builder Grant/, t);
  const [row] = await sql()<{ d: Record<string, string> | null }[]>`SELECT standing_seen->'declined' AS d FROM builder_profiles WHERE builder_id = ${b.id}`;
  assert.ok(Object.keys(row.d ?? {}).some((k) => k.startsWith('path:')), JSON.stringify(row.d));
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], t);
});

/*
 * v4.8.2 Task 2 (R3): the money line names what closes within 48 hours, any category, at most 2, soonest first:
 * "Open now: {total} in grants. Closing soon: {A} ({amount}, in N hours) and {B} (...)."
 */
const H = 3_600_000;
/** A committed program file as a live card (programs.ts programCard's fields the money line reads), closing `h` hours after NOW. */
const fileCard = (name: string, h: number | null, o: Partial<Card> = {}): Card => {
  const f = committedProgram(name);
  return {
    id: f.id, title: f.title, summary: f.summary, tag: f.tag ?? null, each_time: [], status: 'active', investment: f.investment === true,
    ends_at: h === null ? null : new Date(NOW.getTime() + h * H), tz: f.tz ?? null, ...o,
  } as Card;
};
const ownerCards = () => [fileCard('base-builder-grants', null), fileCard('arc-microgrants-studio', 14.5), fileCard('a16z-speedrun', 19.5)];
const none = new Set<string | null>();

test('v4.8.2 R3: on the owner shape the money line names Arc and a16z, soonest first, with the table\'s amount cells', () => {
  assert.equal(moneyLine('$105.5K', closingPrograms(ownerCards(), NOW, new Set(), none), NOW),
    'Open now: $105.5K in grants. Closing soon: Arc Microgrants (500 USDC × 8 grants, in 14 hours) and a16z speedrun SR008 (investor program, up to $1M, in 19 hours).');
  // The total at 0: only the closing sentence; nothing closing: only the total; neither: no line.
  assert.equal(moneyLine(null, closingPrograms(ownerCards(), NOW, new Set(), none), NOW),
    'Closing soon: Arc Microgrants (500 USDC × 8 grants, in 14 hours) and a16z speedrun SR008 (investor program, up to $1M, in 19 hours).');
  assert.equal(moneyLine('$105.5K', [], NOW), 'Open now: $105.5K in grants.');
  assert.equal(moneyLine(null, [], NOW), null);
  // An unknown amount: the parenthesis holds the time (an investor program keeps its kind).
  const arc = closingPrograms(ownerCards(), NOW, new Set(), none)[0];
  assert.equal(moneyLine('$1K', [{ ...arc, amount: null }], NOW), 'Open now: $1K in grants. Closing soon: Arc Microgrants (in 14 hours).');
  assert.doesNotMatch(moneyLine('$105.5K', closingPrograms(ownerCards(), NOW, new Set(), none), NOW)!, BAD);
});

test('v4.8.2 R3: a declined, applied or drafted Arc is left out', () => {
  // pathSkip's set: applied (told), drafted, a no (declined, parked) all land in skip.
  assert.equal(moneyLine('$105.5K', closingPrograms(ownerCards(), NOW, new Set(['arc-microgrants-studio']), none), NOW),
    'Open now: $105.5K in grants. Closing soon: a16z speedrun SR008 (investor program, up to $1M, in 19 hours).');
});

test("v4.8.2 R3: a reply about Arc doesn't name Arc; a picked path's program is left out, an unpicked old hook's is not", () => {
  const ids = (led: Set<string | null>) => closingPrograms(ownerCards(), NOW, new Set(), led).map((p) => p.id);
  assert.deepEqual(ids(new Set(['arc-microgrants-studio', null])), ['a16z-speedrun']);
  assert.deepEqual(ids(new Set(['base-builder-grants', 'a16z-speedrun'])), ['arc-microgrants-studio']);
  assert.deepEqual(ids(new Set(['base-builder-grants', null])), ['arc-microgrants-studio', 'a16z-speedrun']);
});

test('v4.8.2 R3: a program 50 hours out is not named; at most 2; never upcoming, unlisted or closed', () => {
  const far = [fileCard('base-builder-grants', null), fileCard('arc-microgrants-studio', 50), fileCard('a16z-speedrun', 19.5)];
  assert.deepEqual(closingPrograms(far, NOW, new Set(), none).map((p) => p.id), ['a16z-speedrun']);
  const three = [...ownerCards(), fileCard('circle-developer-grants', 2.5)];
  assert.deepEqual(closingPrograms(three, NOW, new Set(), none).map((p) => p.id), ['circle-developer-grants', 'arc-microgrants-studio']);
  const hidden = [fileCard('arc-microgrants-studio', 14.5, { status: 'upcoming' }), fileCard('a16z-speedrun', 19.5, { status: 'unlisted' }), fileCard('circle-developer-grants', -1)];
  assert.deepEqual(closingPrograms(hidden, NOW, new Set(), none), []);
  // v4.8.2 final fix (F3): a reply about one Arc round names no other open "Arc Microgrants" round (left out by name).
  const other = [...ownerCards(), fileCard('arc-microgrants-studio', 10, { id: 'arc-round-2' })];
  assert.deepEqual(closingPrograms(other, NOW, new Set(), new Set(['arc-microgrants-studio', null])).map((p) => p.id), ['a16z-speedrun']);
  // Two rounds with one name: the sooner only, then the next program.
  const twice = [...ownerCards(), fileCard('arc-microgrants-studio', 16.5, { id: 'arc-round-2' })];
  assert.deepEqual(closingPrograms(twice, NOW, new Set(), none).map((p) => p.id), ['arc-microgrants-studio', 'a16z-speedrun']);
});

/*
 * v4.8.2 Task 3 (R4): every program object an agent gets says the hours left under 48 hours (closes_in), and its
 * summary's close part says it too, so no agent repeats a program-zone day ("Nov 1, 11:59 PM ET") to a builder elsewhere.
 */
const ARC_SUMMARY = '500 USDC × 8 grants · closes Nov 1, 11:59 PM ET';
const inH = (h: number) => new Date(NOW.getTime() + h * H);

test('v4.8.2 R4: closesIn is the hours left under 48 hours, null after, for a rolling program or none', () => {
  assert.equal(closesIn({ summary: ARC_SUMMARY, ends_at: inH(14.5) }, NOW), 'in 14 hours');
  assert.equal(closesIn({ summary: ARC_SUMMARY, ends_at: inH(14.5).toISOString() }, NOW), 'in 14 hours');
  assert.equal(closesIn({ summary: ARC_SUMMARY, ends_at: inH(0.5) }, NOW), 'in under an hour');
  assert.equal(closesIn({ summary: ARC_SUMMARY, ends_at: inH(5 * 24) }, NOW), null);
  assert.equal(closesIn({ summary: ARC_SUMMARY, ends_at: inH(-1) }, NOW), null);
  assert.equal(closesIn({ summary: 'milestone-based USDC grants · rolling', ends_at: inH(3) }, NOW), null);
  assert.equal(closesIn({ summary: ARC_SUMMARY, ends_at: null }, NOW), null);
});

test('v4.8.2 R4: summaryIn swaps only the close part; without hours left the summary stays', () => {
  assert.equal(summaryIn(ARC_SUMMARY, 'in 14 hours'), '500 USDC × 8 grants · closes in 14 hours');
  assert.equal(summaryIn('up to $1M · new projects · closes Nov 1, 11:59 PM PT', 'in 19 hours'), 'up to $1M · new projects · closes in 19 hours');
  assert.equal(summaryIn(ARC_SUMMARY, null), ARC_SUMMARY);
  // No close part: nothing to swap (closes_in still carries the time).
  assert.equal(summaryIn('$50K in prizes · opens soon', 'in 3 hours'), '$50K in prizes · opens soon');
  // The prize part is never touched, even when it starts with "closes".
  assert.equal(summaryIn('closes fund · closes Nov 1', 'in 2 hours'), 'closes fund · closes in 2 hours');
  // v4.8.2 final fix (F2): any part with a month and day keeps its words before the date ("regular deadline ...").
  assert.equal(summaryIn('$400K at admission · regular deadline Nov 18', 'in 30 hours'), '$400K at admission · regular deadline in 30 hours');
  assert.equal(summaryIn('$50K in prizes · submit by Nov 7, 9:00 AM IST', 'in 5 hours'), '$50K in prizes · submit in 5 hours');
  assert.equal(summaryIn('$50K in prizes · Nov 7', 'in 5 hours'), '$50K in prizes · closes in 5 hours');
  assert.equal(summaryIn('$400K at admission · regular deadline Nov 18', null), '$400K at admission · regular deadline Nov 18');
});

test("v4.8.2 final fix (F2): Alliance's find object under 48 hours: no month and day in the summary", () => {
  const f = committedProgram('alliance-all19');
  const p = withClosesIn({ id: f.id, summary: f.summary, ends_at: inH(30.5) }, NOW);
  assert.equal(p.closes_in, 'in 30 hours');
  assert.equal(p.summary, '$400K at admission · regular deadline in 30 hours');
  assert.doesNotMatch(p.summary, /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d/);
  // 48 hours or more out: the summary as committed.
  assert.equal(withClosesIn({ id: f.id, summary: f.summary, ends_at: inH(72) }, NOW).summary, f.summary);
});

test('v4.8.2 R4: the guide header and the "Ends" cell say the hours left under 48 hours, the zone day after', () => {
  assert.equal(endsCell({ summary: ARC_SUMMARY, ends_at: inH(14.5) }, NOW), 'in 14 hours');
  assert.equal(endsCell({ summary: ARC_SUMMARY, ends_at: inH(5 * 24) }, NOW), 'Nov 1, 11:59 PM ET');
  assert.equal(endsCell({ summary: ARC_SUMMARY, ends_at: inH(14.5) }), 'Nov 1, 11:59 PM ET');
  const file = committedProgram('arc-microgrants-studio');
  const facts = (h: number) => ({ ...ProgramFile.parse({ ...file, ends_at: inH(h).toISOString(), status: 'active', starts_at: null }), opens_note: null, tz: null }) as never;
  assert.match(programGuide(facts(14.5), NOW, { hours: true }).header, / · ends in 14 hours$/);
  assert.match(programGuide(facts(5 * 24), NOW, { hours: true }).header, / · ends Nov 1, 11:59 PM ET$/);
  // Fix 1: the hours are opt-in (MCP only); the site page's default keeps the zone day.
  assert.match(programGuide(facts(14.5), NOW).header, / · ends Nov 1, 11:59 PM ET$/);
  const card = (h: number) => ({ id: `t3-${h}`, title: 'Arc Microgrants', summary: ARC_SUMMARY, ends_at: inH(h), tz: null, chains: ['arc'], any_chain: false, tracks: [], tag: null, max_award_usd: 500, builder_fields: 0, closes_in_days: 0 }) as unknown as Card;
  const t = fullProgramTable({ cards: [card(14.5)], repos: null, entries: [], now: NOW } as never)!;
  assert.match(t, /\| in 14 hours \|/, t);
  assert.doesNotMatch(t, /Nov 1/, t);
});

test('v4.8.2 R4 fix 1: at exactly 48 hours the zone day and no closes_in; at 47.9 hours "in 47 hours"', () => {
  const at = (h: number) => ({ summary: ARC_SUMMARY, ends_at: inH(h) });
  assert.equal(closesIn(at(48), NOW), null);
  assert.equal(withClosesIn(at(48), NOW).summary, ARC_SUMMARY);
  assert.equal(withClosesIn(at(48), NOW).closes_in, null);
  assert.equal(endsCell(at(48), NOW), 'Nov 1, 11:59 PM ET');
  assert.equal(closesIn(at(47.9), NOW), 'in 47 hours');
  assert.deepEqual(withClosesIn(at(47.9), NOW), { ...at(47.9), summary: '500 USDC × 8 grants · closes in 47 hours', closes_in: 'in 47 hours' });
  assert.equal(endsCell(at(47.9), NOW), 'in 47 hours');
  const file = committedProgram('arc-microgrants-studio');
  const facts = (h: number) => ({ ...ProgramFile.parse({ ...file, ends_at: inH(h).toISOString(), status: 'active', starts_at: null }), opens_note: null, tz: null }) as never;
  assert.match(programGuide(facts(48), NOW, { hours: true }).header, / · ends Nov 1, 11:59 PM ET$/);
  assert.match(programGuide(facts(47.9), NOW, { hours: true }).header, / · ends in 47 hours$/);
});

/** A copy of Arc Microgrants Studio closing `h` hours from the real clock (the tools read new Date()). */
async function arcCopy(tag: string, h: number, status: 'active' | 'upcoming' = 'active') {
  const id = `v482-${process.pid}-${tag}`;
  await upsertProgram(ProgramFile.parse({ ...committedProgram('arc-microgrants-studio'), id, title: `Arc Hours ${tag} ${RUN}`, ends_at: new Date(Date.now() + h * H).toISOString(), status, starts_at: null, ...(status === 'upcoming' && { opens_note: 'Opens soon.' }) }));
  return id;
}
type AgentProgram = { id: string; summary: string; deadline: string; closes_in: string | null };
const programsOf = (r: Record<string, unknown> | null) => (r?.programs ?? []) as AgentProgram[];

test('v4.8.2 R4: a new builder\'s find: closes_in and the summary say "in 14 hours"; a 5-day program keeps its summary', db, async () => {
  const soon = await arcCopy('soon', 14.5);
  const far = await arcCopy('far', 5 * 24 + 0.5);
  const t = `ek_v482_t3_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c = (await connectInstallation(t))!;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, readerDeps: QUIET };
  const r = (await mcpCall(ctx as never, 'find', {})).reply;
  const ps = programsOf(r);
  const s = ps.find((p) => p.id === soon)!;
  const f = ps.find((p) => p.id === far)!;
  assert.ok(s && f, JSON.stringify(ps.map((p) => p.id)));
  assert.equal(s.closes_in, 'in 14 hours');
  assert.equal(s.summary, '500 USDC × 8 grants · closes in 14 hours');
  assert.match(s.deadline, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(f.closes_in, null);
  assert.equal(f.summary, ARC_SUMMARY);
  for (const p of ps) assert.ok('closes_in' in p, p.id);
  // get_program (find with program_id): closes_in beside the ISO deadline, and the guide says the hours.
  const g = (await mcpCall(ctx as never, 'find', { program_id: soon })).reply!;
  assert.equal(g.closes_in, 'in 14 hours');
  assert.match(String((g.guide as { text: string }).text), /ends in 14 hours/);
  assert.doesNotMatch(String((g.guide as { text: string }).text), /Nov 1, 11:59 PM ET/);
  assert.equal((await mcpCall(ctx as never, 'find', { program_id: far })).reply!.closes_in, null);
  // Fix 1: the site's /programs/<id> page keeps the program-zone day; only get_program says the hours.
  const page = await readGuidePage(soon);
  assert.match(page!.guide.header, / · ends Nov 1, 11:59 PM ET$/, page!.guide.header);
  // Fix 1: an upcoming program closing within 48 hours has no closes_in.
  const up = await arcCopy('up', 14.5, 'upcoming');
  const u = (await mcpCall(ctx as never, 'find', { program_id: up })).reply!;
  assert.equal(u.closes_in, null, JSON.stringify(u).slice(0, 300));
  await dropPrograms([soon, far, up]);
});

test('v4.8.2 R4: the ranked builder\'s find (list_programs) carries closes_in and the hours-left summary', db, async () => {
  const soon = await arcCopy('rsoon', 14.5);
  const far = await arcCopy('rfar', 5 * 24 + 0.5);
  const b = await ownerDb('t3r');
  const r = (await mcpCall(b.ctx as never, 'find', {})).reply;
  const ps = programsOf(r);
  const s = ps.find((p) => p.id === soon);
  const f = ps.find((p) => p.id === far);
  assert.ok(s && f, JSON.stringify(ps.map((p) => p.id)));
  assert.equal(s.closes_in, 'in 14 hours');
  assert.equal(s.summary, '500 USDC × 8 grants · closes in 14 hours');
  assert.equal(f.closes_in, null);
  assert.equal(f.summary, ARC_SUMMARY);
  await dropPrograms([soon, far]);
});
