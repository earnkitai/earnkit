import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { pathQuiet, walletOffered } from './fixtures/wallet-step';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { closeDayOf } from './entry-text';
import {
  CHECKIN_ASK, CHECKIN_WHY, POST_ASK, POST_WHY, SHIP_ASK, SUGGEST_WHY, applyAsk, applyWhy, askWhy, benchReply,
  qualifyGap, qualifyHead, shipWhy, type BenchView, type QualifyOffer,
} from './bench-reply';
import { WHY_NOTE, whyNote, withWhy } from './bench-find';
import { FIND_DESCRIPTION_BENCH, SERVER_INSTRUCTIONS } from './mcp';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';
import { READY_SET } from './bench-find';

// v4.10 Task 4: this file pins the reply the path gives; a fresh session now opens with the ready set instead
// (v410-find.test.ts), so the set is off here (bench-find.ts READY_SET).
READY_SET.on = false;

/**
 * v4.7 Task 4: a why at every step. Each ask carries its own short line, the paragraph just before its question, and
 * every move_up with a why carries it (move_up.why), so "why?" has EarnKit's own answer. The setup-done reply says the
 * first-run "what to ask" line once.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v47-why-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});
const RUN = String(process.pid % 100000);
const DAY = 86_400_000;
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
type MoveUp = { kind: string; project_key: string | null; agent_note: string; why?: string };
const moveUp = (r: R) => r.reply?.move_up as MoveUp | undefined;
const BAD = /—|\bcoins?\b|\bpoints?\b|\p{Extended_Pictographic}/iu;

const P = { key: 'maya/kit', name: 'Kit', confirmed: true, live: true, weeks: 6 };
const ranked = (o: Partial<BenchView> = {}): BenchView => ({
  state: 'ranked', variant: null, project: P, rank: '#3 of 40 builders', streak: 6, target: null, handle: 'maya', link: null,
  fund: [], due: [], ask: { kind: 'ship', project_key: P.key, line: SHIP_ASK }, held: null, standingShown: true, nagShown: true, ...o,
});
/** The reply's last paragraph is `ask` alone, the one before it `why`, and the reply asks one question. */
function whyThenAsk(s: string, why: string, ask: string) {
  const paras = s.split('\n\n');
  assert.equal(paras.at(-1), ask, s);
  assert.equal(paras.at(-2), why, s);
  assert.equal(s.split('?').length - 1, 1, s);
  assert.doesNotMatch(s, BAD, s);
}

test('the exact why lines', () => {
  assert.equal(shipWhy(6), 'Shipping this week keeps your 6-week streak and lifts your score.');
  assert.equal(shipWhy(0), 'Shipping this week starts your streak and lifts your score.');
  assert.equal(CHECKIN_WHY, 'A Monday check-in keeps your drafts current before deadlines.');
  assert.equal(POST_WHY, 'A post with real numbers is what reviewers read.');
  // v4.8 Task 1: the first-run line (ASKS_HINT) is retired.
  for (const l of [shipWhy(6), shipWhy(0), CHECKIN_WHY, POST_WHY]) assert.doesNotMatch(l, BAD, l);
  // A statement, never a question of its own.
  for (const l of [shipWhy(6), CHECKIN_WHY, POST_WHY]) assert.ok(!l.includes('?'), l);
});

test('ship: its why line, streak 6 and streak 0, just before the question (in place of the weekly ship line)', () => {
  const six = benchReply(ranked());
  whyThenAsk(six, 'Shipping this week keeps your 6-week streak and lifts your score.', SHIP_ASK);
  assert.doesNotMatch(six, /Ship code this week/, six);
  const zero = benchReply(ranked({ streak: 0 }));
  whyThenAsk(zero, 'Shipping this week starts your streak and lifts your score.', SHIP_ASK);
  // Fix round 0 (R13): a weekly rank target is the why (the more specific reason), said once; the plain ship line is not.
  const aim = ranked({ target: 'Ship code this week to hold #1.' });
  whyThenAsk(benchReply(aim), 'Ship code this week to hold #1.', SHIP_ASK);
  assert.equal(askWhy(aim), 'Ship code this week to hold #1.');
  assert.equal(benchReply(aim).split('Ship code this week').length - 1, 1);
  assert.equal(askWhy(ranked({ target: 'Ship code this week.' })), shipWhy(6));
  // Fix round 0 (R14): on every ship ask (already at most once in 7 days), the weekly ship line shown or not.
  whyThenAsk(benchReply(ranked({ nagShown: false })), shipWhy(6), SHIP_ASK);
  // The quiet reply (the ship question asked within its days) keeps the weekly ship line, with no question.
  const quiet = benchReply(ranked({ ask: { kind: 'none', project_key: P.key, line: '' }, target: 'Ship code this week to hold #1.' }));
  assert.ok(quiet.endsWith('\nShip code this week to hold #1.'), quiet);
  assert.doesNotMatch(quiet, /Shipping this week|\?/, quiet);
  // A held question takes the ask's place: no why line.
  assert.doesNotMatch(benchReply(ranked({ held: 'Did Kit win anything in Base Builder Grants?' })), /Shipping this week/);
});

test('checkin and post: each why line just before its question (v4.10.3 Task 3, R6: the Monday block asks nothing, so it has no why)', () => {
  whyThenAsk(benchReply(ranked({ ask: { kind: 'checkin', project_key: P.key, line: CHECKIN_ASK } })), CHECKIN_WHY, CHECKIN_ASK);
  const post = { head: 'Kit went live this week.', text: 'Kit is live.', link: 'https://earnkit.com/maya/post/abcdefghij' };
  const p = benchReply(ranked({ ask: { kind: 'post', project_key: P.key, line: POST_ASK }, post }));
  whyThenAsk(p, POST_WHY, POST_ASK);
  assert.ok(p.startsWith('Kit went live this week.\nYour post for X:\n"Kit is live."\nPost it in one tap: '), p);
});

test('apply and qualify keep their own copy (no new line); their move_up.why is their own reason sentence', () => {
  const ask = applyAsk('Base Builder Grants', '$5,000', 'Nov 18');
  const v = ranked({ ask: { kind: 'apply', project_key: P.key, line: ask, program_id: 'base-builder-grants' } });
  assert.equal(benchReply(v), ask, 'the apply reply is unchanged');
  assert.equal(askWhy(v), 'Base Builder Grants closes Nov 18, up to $5,000. I can draft it in a minute.');
  assert.equal(askWhy(v), applyWhy('Base Builder Grants', '$5,000', 'Nov 18'));
  // An owning closing nudge's apply: the nudge's statements.
  assert.equal(askWhy({ ...v, ask: { ...v.ask, line: '' }, nudgeOwns: true, nudge: 'Heads up, Arc closes Nov 1. Your draft is ready. Want to send it?' }), 'Heads up, Arc closes Nov 1. Your draft is ready.');
  const q = { program_id: 'base-builder-grants', title: 'Base Builder Grants', grant: { name: "Base's $5,000 grant", amount: '$5,000' }, when: 'rolling', missing: ['codes'], steps: ['codes'] } as unknown as QualifyOffer;
  const qv = ranked({ ask: { kind: 'qualify', project_key: P.key, line: 'Want me to add Builder Codes to Kit?', program_id: 'base-builder-grants' }, qualify: q });
  const why = `${qualifyHead(q)} ${qualifyGap('Kit', q)}`;
  assert.equal(askWhy(qv), why);
  const out = benchReply(qv);
  assert.ok(out.includes(why), out);
  assert.equal(out.split(why).length - 1, 1, 'said once, no new line');
});

test('askWhy covers every kind with an ask in Exact copy; withWhy carries it and the why note', () => {
  assert.equal(askWhy(ranked()), shipWhy(6));
  assert.equal(askWhy(ranked({ streak: 0 })), shipWhy(0));
  assert.equal(askWhy(ranked({ ask: { kind: 'checkin', project_key: P.key, line: CHECKIN_ASK } })), CHECKIN_WHY);
  assert.equal(askWhy(ranked({ ask: { kind: 'share', project_key: P.key, line: '' } })), null, 'R6: no reply asks it');
  assert.equal(askWhy(ranked({ ask: { kind: 'post', project_key: P.key, line: POST_ASK } })), POST_WHY);
  assert.equal(askWhy(ranked({ ask: { kind: 'wallet', project_key: P.key, line: 'x' } })), null);
  const m = withWhy({ kind: 'ship', project_key: P.key, agent_note: "Do it. Don't show this note." }, shipWhy(6));
  assert.deepEqual(m, { kind: 'ship', project_key: P.key, why: shipWhy(6), agent_note: `Do it. ${WHY_NOTE} Don't show this note.` });
  assert.equal(whyNote('Do it.'), `Do it. ${WHY_NOTE}`);
  assert.deepEqual(withWhy({ kind: 'x', project_key: null, agent_note: 'n' }, null), { kind: 'x', project_key: null, agent_note: 'n' });
  // Ruling R1: the server instructions are not touched (Task 5 owns them); find's description stays under 800.
  assert.ok(SERVER_INSTRUCTIONS.length <= 800, String(SERVER_INSTRUCTIONS.length));
  assert.ok(FIND_DESCRIPTION_BENCH.length < 800, String(FIND_DESCRIPTION_BENCH.length));
});

let n = 0;
/** An open copy of Base's grant closing in `days`. */
async function program(tag: string, days: number) {
  const base = committedProgram('base-builder-grants');
  const id = `v47-why-${process.pid}-${tag}`;
  const ends = new Date(Date.now() + days * DAY);
  const p = ProgramFile.parse({ ...base, id, title: `Why ${tag} ${RUN}`, summary: 'up to $5,000', ends_at: ends.toISOString(), status: 'active' });
  await upsertProgram(p);
  return { id, title: p.title, when: closeDayOf({ summary: p.summary, ends_at: ends })! };
}
/** A ranked builder (X, the repo proven by the App) the matcher fits for `programs`. */
async function builder(tag: string, programs: string[]) {
  n++;
  const t = `ek_v47why_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `wy${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `48${RUN}${n}${tag.length}`, username: handle, name: 'wy', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  await walletOffered(c.id);
  const key = `wy${tag}${RUN}/kit`;
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{
    repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true,
    verdicts: programs.map((id) => ({ program_id: id, program: id, status: 'likely' as const, missing: [], effort: 'none' as const, note: null })),
  }];
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  const gid = 4800 + n * 10 + (Number(RUN) % 7);
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh: fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } }) });
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  return { ctx, id: c.id, key };
}

test('through find: every move_up with an ask in Exact copy carries its why (and the why note); the visible line matches', db, async () => {
  const p = await program('a', 20);
  const b = await builder('a', [p.id]);
  // v4.8 Task 1: the path's hook names the fit first (its text is its own reason; the mentor note words it).
  const r = await mcpCall(b.ctx, 'find', {});
  assert.equal(moveUp(r)?.kind, 'apply', show(r));
  assert.ok(show(r).includes(p.title) && show(r).endsWith('Want me to start?'), show(r));
  // Told applied, and the path parked: the older asks (check-in, ship, ...) each carry their why.
  await mcpCall(b.ctx, 'tell', { submitted: { program_id: p.id } });
  await pathQuiet(b.id);
  const visible: Record<string, string> = { checkin: CHECKIN_WHY, post: POST_WHY };
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const x = await mcpCall(b.ctx, 'find', {});
    const m = moveUp(x);
    const s = show(x);
    if (!m) continue;
    seen.add(m.kind);
    if (m.kind === 'ship') {
      assert.match(m.why ?? '', /^(Shipping this week (keeps your \d+-week streak|starts your streak) and lifts your score|Ship code this week to (hold|pass|move toward) #[\d,]+)\.$/);
      whyThenAsk(s, m.why!, SHIP_ASK);
    } else if (visible[m.kind]) {
      assert.equal(m.why, visible[m.kind]);
      assert.equal(s.split('\n\n').at(-2), m.why, s);
    } else if (m.kind === 'apply' || m.kind === 'qualify') assert.ok(m.why && s.includes(m.why), s);
    if (m.why) assert.ok(m.agent_note.includes(WHY_NOTE), m.agent_note);
    assert.doesNotMatch(s, BAD, s);
    // A no moves past the qualify step (kept away), so the quieter asks come up.
    if (m.kind === 'qualify') await mcpCall(b.ctx, 'tell', { move_up: { kind: 'qualify', project_key: m.project_key, answer: 'no' } });
  }
  assert.ok([...seen].some((k) => ['ship', 'checkin', 'share', 'post'].includes(k)), [...seen].join(','));
});

test('suggest: its why line just before the question; move_up.why is it (no score or streak)', () => {
  assert.equal(SUGGEST_WHY, 'Programs fund builders who ship every week.');
  assert.doesNotMatch(SUGGEST_WHY, /score|streak|\?|—/i);
  const ask = 'Want me to suggest one small thing to ship in Kit this week?';
  const v: BenchView = {
    state: 'not_counted', variant: 'app_off', project: P, rank: null, streak: 0, target: null, handle: 'maya', link: null,
    fund: [], due: [], ask: { kind: 'suggest', project_key: P.key, line: ask }, held: null,
  };
  const out = benchReply(v);
  whyThenAsk(out, SUGGEST_WHY, ask);
  assert.equal(askWhy(v), SUGGEST_WHY);
  const m = withWhy({ kind: 'suggest', project_key: P.key, agent_note: "Do it. Don't show this note." }, askWhy(v));
  assert.equal(m.why, SUGGEST_WHY);
  assert.ok(m.agent_note.includes(WHY_NOTE));
  // A held question takes the ask's place: no why line.
  assert.doesNotMatch(benchReply({ ...v, held: 'Did Kit win anything?' }), new RegExp(SUGGEST_WHY));
});
