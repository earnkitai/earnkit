import './fixtures/no-network-checks';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { moneyLine, passedLine, pointerReply } from './conversation';
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
import { MORE_ASK, closingPrograms, codesSettled } from './bench-find';
import { GitHubBudgetStop, type ReaderDeps } from './source-readers';
import { dropRunPrograms } from './fixtures/programs-cleanup';

/*
 * v4.8.2 Task 1 (R1, R2): the owner's dogfood of v4.8.1. The reasoned pointer is followed by "more" (no short
 * "Still {Program}. Reply "no"..." nag), and the passed-step line never says when the builder passed (no guilt).
 */

const NOW = new Date('2026-11-01T10:31:00Z');
const BAD = /—|\bcoins?\b|\bpoints?\b|\p{Extended_Pictographic}/iu;
const POINTER = 'Base Builder Grant is still your best move: up to $5,000, one step away. I can add Builder Codes and push the change, about 10 minutes. Go?';

test('v4.8.2 R2: the passed-step line says only that it is the only gap', () => {
  assert.equal(passedLine('2026-10-22T09:00:00Z', NOW, true), "They're now the only gap to that money.");
  assert.equal(passedLine('2026-10-22T09:00:00Z', NOW), "It's now the only gap to that money.");
  assert.equal(passedLine(null, NOW, true), "They're now the only gap to that money.");
  assert.equal(passedLine(null, NOW), "It's now the only gap to that money.");
});

test('v4.8.2 R1: the second pointer is "more", never the short "Reply no" pointer', () => {
  const facts = { id: 'base', title: 'Base Builder Grant', amount: 'up to $5,000', when: 'rolling', ends_at: null, zone: 'UTC', gaps: 1, stage: 'hook' as const, drafted: false };
  const first = pointerReply(facts, 'Go?', new Set(), NOW);
  assert.deepEqual(first, { text: 'Base Builder Grant is still your best move: up to $5,000, one step away. Go?', said: ['point:base'], more: false, ready: false });
  assert.deepEqual(pointerReply(facts, 'Go?', new Set(first.said), NOW), { text: MORE_ASK, said: [], more: true, ready: false });
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
  assert.match(replies[0].show, /Builder Codes[^\n]*\. They're now the only gap to that money\./, t);
  assert.equal(replies[1].show, POINTER, t);
  for (const r of replies.slice(2)) {
    assert.equal(r.show, MORE_ASK, t);
    assert.equal((r.reply?.move_up as { kind: string }).kind, 'more', t);
  }
  for (const r of replies) {
    assert.doesNotMatch(r.show, /Reply "no"|Still Base|You passed/, t);
    assert.doesNotMatch(r.show, BAD, t);
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
  // Two rounds with one name: the sooner only, then the next program.
  const twice = [...ownerCards(), fileCard('arc-microgrants-studio', 16.5, { id: 'arc-round-2' })];
  assert.deepEqual(closingPrograms(twice, NOW, new Set(), none).map((p) => p.id), ['arc-microgrants-studio', 'a16z-speedrun']);
});
