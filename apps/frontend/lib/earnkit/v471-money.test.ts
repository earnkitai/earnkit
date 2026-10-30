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
import { closeDayOf } from './entry-text';
import {
  CHECKIN_ASK, CHECKIN_WHY, MOMENT_ASK, POST_ASK, POST_WHY, SHARE_WHY, SHIP_ASK, TOKEN_OFFER, applyAsk, askWhy, benchReply, checkFitsWhy, checkNeedsAsk, openNowLine,
  qualifyLine, stateAsk, type BenchView, type MomentView,
} from './bench-reply';
import { CHECK_FITS_ASK_NOTE, CHECK_FITS_NOTE, checkNeedsNote, openNowGrants } from './bench-find';
import type { Card } from './present';
import { fridayNudge } from './nudges';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';

/**
 * v4.7.1 Task 1: money always shows. A ranked builder with no unapplied fit hears the open grants closing soonest
 * ("Open now: ...") ahead of any other ask, and in the quiet reply too; with no fit, the ask is check_fits once (what the
 * project would need for the first grant); the standing is v4.7's paragraph, never "EarnKit · 6 weeks in a row"; a
 * reply with no question carries no why. A builder with an unapplied fit hears v4.7's reply unchanged.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v471-money-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});
const RUN = String(process.pid % 100000);
const DAY = 86_400_000;
const BAD = /—|\bcoins?\b|\bpoints?\b|\p{Extended_Pictographic}/iu;
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
type MoveUp = { kind: string; project_key: string | null; agent_note: string; why?: string };
const moveUp = (r: R) => r.reply?.move_up as MoveUp | undefined;

const P = { key: 'maya/kit', name: 'Kit', confirmed: true, live: true, weeks: 6 };
const OPEN = [
  { title: 'Arc Microgrants: Built with Studio', amount: '500 USDC × 8 grants', when: 'closes Nov 1' },
  { title: 'Circle Developer Grants', amount: '$5,000 to $100,000 USDC grants', when: 'rolling' },
];
const ranked = (o: Partial<BenchView> = {}): BenchView => ({
  state: 'ranked', variant: null, project: P, rank: '#3 of 40 builders', streak: 6, target: null, handle: 'maya', link: null,
  fund: [], due: [], ask: { kind: 'ship', project_key: P.key, line: SHIP_ASK }, held: null, standingShown: true, nagShown: true, ...o,
});

test('exact copy: the open money paragraph and the check_fits ask', () => {
  assert.equal(
    openNowLine(OPEN),
    // Fix round 1 (R1): "Open now:" once, the grants joined.
    'Open now: Arc Microgrants, 500 USDC × 8 grants, closes Nov 1. Circle Developer Grants, $5,000 to $100,000 USDC grants, rolling.',
  );
  assert.equal(openNowLine(OPEN.slice(0, 1)), 'Open now: Arc Microgrants, 500 USDC × 8 grants, closes Nov 1.');
  assert.equal(openNowLine([]), null);
  assert.equal(checkFitsWhy('Kit'), 'None of these fit Kit on what EarnKit can see yet.');
  assert.equal(checkNeedsAsk('Kit', OPEN[0].title), 'Want me to check what Kit would need for Arc Microgrants?');
  assert.ok(checkNeedsNote('Arc Microgrants').startsWith(CHECK_FITS_NOTE.replace(" Don't show this note.", '')));
  assert.match(checkNeedsNote('Arc Microgrants'), /Arc Microgrants's requirements.*what the project would need.*Don't show this note\.$/);
});

test('open now: grants only, soonest deadline first, rolling last, two at most', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  const card = (id: string, o: Partial<Card> = {}): Card => ({
    id, title: `${id} Grants`, summary: '$1,000 · rolling', tag: null, each_time: [], status: 'active', chains: ['arc'], max_award_usd: 1000, reward: '$1,000 per grant', ...o,
  });
  const cards: Card[] = [
    card('any-rolling', { chains: [], any_chain: true, summary: 'up to $2,000 · rolling' }),
    card('later', { summary: '$1,000 · closes Nov 20', ends_at: new Date('2026-11-20T23:59:00Z') }),
    card('invest', { investment: true, ends_at: new Date('2026-10-31T00:00:00Z'), summary: '$1,000 · closes Oct 31' }),
    card('soon', { summary: '$1,000 · closes Nov 1', ends_at: new Date('2026-11-01T23:59:00Z') }),
    card('hidden', { summary: '$1,000 · closes Oct 31', ends_at: new Date('2026-10-31T23:59:00Z') }),
  ];
  assert.deepEqual(openNowGrants(cards, now, new Set(['hidden'])).map((g) => [g.title, g.when]), [['soon Grants', 'closes Nov 1'], ['later Grants', 'closes Nov 20']]);
  // Only rolling ones: by relevance.
  assert.deepEqual(openNowGrants([card('any-rolling', { chains: [], any_chain: true }), card('arc-rolling')], now, new Set()).map((g) => g.when), ['rolling', 'rolling']);
});

test('pure: no fit, the open grants lead every non-money ask and the quiet reply; a fit keeps v4.7 word for word', () => {
  const name = 'Kit';
  const checkFits = ranked({ openNow: OPEN, ask: stateAsk({ state: 'ranked', variant: null, project: P, link: null, checkFits: OPEN[0].title, checkin: true }) });
  assert.equal(checkFits.ask.kind, 'check_fits', 'check_fits goes ahead of the check-in');
  const paras = benchReply(checkFits).split('\n\n');
  assert.equal(paras[0], openNowLine(OPEN));
  assert.equal(paras.at(-2), checkFitsWhy(name));
  assert.equal(paras.at(-1), checkNeedsAsk(name, OPEN[0].title));
  assert.equal(askWhy(checkFits), checkFitsWhy(name));
  // The check-in, wallet and quiet replies carry it first too.
  for (const ask of [
    { kind: 'checkin' as const, project_key: P.key, line: CHECKIN_ASK },
    { kind: 'wallet' as const, project_key: P.key, line: 'Prove your Base wallet: https://earnkit.com/w\nDone?' },
    { kind: 'none' as const, project_key: P.key, line: '' },
  ]) {
    const s = benchReply(ranked({ openNow: OPEN, ask, standingShown: false }));
    assert.ok(s.startsWith(openNowLine(OPEN)!), s);
  }
  assert.equal(askWhy(ranked({ ask: { kind: 'none', project_key: P.key, line: '' } })), null);
  // The standing shown is the paragraph (standingText), never the old line.
  const st = benchReply(ranked({ openNow: OPEN, ask: { kind: 'none', project_key: P.key, line: '' }, standingText: 'Score 77 · #3 of 40 builders. 6 weeks shipping in a row.' }));
  assert.match(st, /Score 77/);
  assert.doesNotMatch(st, /Kit · |weeks in a row(?! )/);
  // A fit: openNow never changes a word.
  const fit = { kind: 'fits' as const, title: 'Base Builder Grant Program', amount: '$5,000', when: 'rolling' };
  for (const ask of [{ kind: 'ship' as const, project_key: P.key, line: SHIP_ASK }, { kind: 'none' as const, project_key: P.key, line: '' }]) {
    assert.equal(benchReply(ranked({ fund: [fit], openNow: OPEN, ask })), benchReply(ranked({ fund: [fit], ask })));
  }
  // Fix round 1 (review 1): fits all drafted or applied (no unapplied fit): the shapes with no moneyLine of their own
  // (wallet, token, new repo, the Monday block, a post) carry the fit line; with no fit, the open grants.
  const moment: MomentView = { week: 3, place: null, rank: 1, summary: null, post: null, first: 'Maya', score: 50, change: null, community: { usd: 0, lastWeekUsd: 0 } };
  const post = { head: 'Kit went live this week.', text: 'Kit is live.', link: 'https://earnkit.com/maya/post/abcdefghij' };
  const shapes: Partial<BenchView>[] = [
    { ask: { kind: 'wallet', project_key: P.key, line: 'Prove your Base wallet: https://earnkit.com/w\nDone?' } },
    { ask: { kind: 'token', project_key: null, line: TOKEN_OFFER } },
    { ask: { kind: 'new_repo', project_key: P.key, line: 'Working on something new? Connect that repo instead.' } },
    { ask: { kind: 'share', project_key: P.key, line: MOMENT_ASK }, moment },
    { ask: { kind: 'post', project_key: P.key, line: POST_ASK }, post },
  ];
  for (const o of shapes) {
    const withFit = benchReply(ranked({ fund: [fit], openNow: OPEN, standingShown: false, ...o }));
    assert.ok(withFit.includes(qualifyLine(fit)), withFit);
    assert.doesNotMatch(withFit, /Open now/, withFit);
    const noFit = benchReply(ranked({ openNow: OPEN, standingShown: false, ...o }));
    assert.ok(noFit.includes(openNowLine(OPEN)!), noFit);
    if (o.ask!.kind === 'share') assert.ok(noFit.endsWith(`${openNowLine(OPEN)}\n\n${SHARE_WHY}\n\n${MOMENT_ASK}`), noFit);
    if (o.ask!.kind === 'post') assert.ok(noFit.endsWith(`${openNowLine(OPEN)}\n\n${POST_WHY}\n\n${POST_ASK}`), noFit);
  }
  // Fix round 2 (R6): the fit told applied or drafted is never pitched (benchView's pitch null): the open grants instead.
  const base = { kind: 'fits' as const, title: 'Base Builder Grant Program', amount: '$5,000', when: 'rolling' };
  for (const o of shapes) {
    const s = benchReply(ranked({ fund: [base], openNow: OPEN, pitch: null, standingShown: false, ...o }));
    assert.doesNotMatch(s, /You qualify for the Base Builder Grant Program/, s);
    assert.ok(s.includes(openNowLine(OPEN)!), s);
    // The next fit not applied to is pitched instead.
    const next = benchReply(ranked({ fund: [base, fit], openNow: OPEN, pitch: { ...fit, title: 'Arc Grants' }, standingShown: false, ...o }));
    assert.ok(next.includes(qualifyLine({ ...fit, title: 'Arc Grants' })) && !next.includes('You qualify for the Base Builder'), next);
  }
  // Final review (R6 on every ranked reply): the ship, check-in and quiet replies never pitch the applied fit either;
  // the open grants instead, and one question at most.
  for (const ask of [
    { kind: 'ship' as const, project_key: P.key, line: SHIP_ASK },
    { kind: 'checkin' as const, project_key: P.key, line: CHECKIN_ASK },
    { kind: 'none' as const, project_key: P.key, line: '' },
  ]) {
    const s = benchReply(ranked({ fund: [base], best: { ...base, program_id: 'base-builder-grants', why: 'x', codes: null }, openNow: OPEN, pitch: null, ask }));
    assert.doesNotMatch(s, /You qualify for the Base Builder Grant Program/, s);
    assert.ok(s.includes('Open now:'), s);
    assert.ok((s.match(/\?/g) ?? []).length <= 1, s);
    // Absent pitch (money first, a pure caller): v4.7's fit line, word for word.
    assert.ok(benchReply(ranked({ fund: [base], openNow: OPEN, ask })).includes(qualifyLine(base)));
  }
  // Final review: money above the Friday nudge (no question mark of its own), so the reply asks exactly one question.
  for (const ask of [{ kind: 'ship' as const, project_key: P.key, line: SHIP_ASK }, { kind: 'checkin' as const, project_key: P.key, line: CHECKIN_ASK }]) {
    const s = benchReply(ranked({ fund: [base], openNow: OPEN, pitch: null, nudge: fridayNudge(6), ask }));
    const ps = s.split('\n\n');
    assert.deepEqual(ps.slice(0, 2), [openNowLine(OPEN), fridayNudge(6)], s);
    assert.equal((s.match(/\?/g) ?? []).length, 1, s);
    assert.ok(s.endsWith(ask.line), s);
  }
  // A fit pitched: its fit line (in the standing paragraph) still goes above the nudge.
  const fitNudge = benchReply(ranked({ fund: [fit], pitch: fit, nudge: fridayNudge(6), standingText: 'Score 77 · #3 of 40 builders.' })).split('\n\n');
  assert.ok(fitNudge[0].includes(qualifyLine(fit)) && fitNudge[1] === fridayNudge(6), fitNudge.join('|'));
  // A held question never gets the open grants.
  assert.doesNotMatch(benchReply(ranked({ openNow: OPEN, held: 'Did Kit win?' })), /Open now/);
});

/** A copy of base-builder-grants (a grant), open, closing `hours` from now. */
async function grant(tag: string, hours: number) {
  const base = committedProgram('base-builder-grants');
  const id = `v471-${process.pid}-${tag}`;
  const ends = new Date(Date.now() + hours * 3_600_000);
  const p = ProgramFile.parse({ ...base, id, title: `Open ${tag} ${RUN}`, summary: 'up to $5,000', ends_at: ends.toISOString(), status: 'active' });
  await upsertProgram(p);
  return { id, title: p.title, when: `closes ${closeDayOf({ summary: p.summary, ends_at: ends })}` };
}

let n = 0;
/** A ranked builder (X, the repo proven by the App) the matcher fits for `programs` (none: no fit). */
async function builder(tag: string, programs: string[]) {
  n++;
  const t = `ek_v471_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `mo${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `471${RUN}${n}${tag.length}`, username: handle, name: 'mo', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  await walletOffered(c.id);
  const key = `mo${tag}${RUN}/kit`;
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
  const gid = 47100 + n * 10 + (Number(RUN) % 7);
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh: fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } }) });
  // The connect weeks are another task's moment; Base's grant steps were declined today (the owner's account).
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text,
      'declined', jsonb_build_object(${`qualify:${key}`}::text, now()::text)) WHERE builder_id = ${c.id}`;
  return { ctx, id: c.id, key };
}
const find = (b: { ctx: unknown }) => mcpCall(b.ctx as never, 'find', {});

test('Review Focus 1: no fit, qualify declined, 2 open grants: money first, check_fits once, and the quiet reply still says the money', db, async () => {
  const a = await grant('a', 2);
  const b2 = await grant('b', 4);
  const b = await builder('nf', []);
  const first = await find(b);
  const s = show(first);
  const paras = s.split('\n\n');
  // Fix round 1 (R3): other test files add open grants to the shared DB, so this checks the shape and its own two grants'
  // order (soonest first), and names them exactly only when no other grant closes before them.
  const money = paras[0];
  assert.match(money, /^Open now: [^\n]+\.$/, s);
  assert.equal(money.split('Open now:').length, 2, 'once (R1)');
  const cellA = `${a.title}, $5,000, ${a.when}.`;
  const cellB = `${b2.title}, $5,000, ${b2.when}.`;
  if (money.includes(cellA) && money.includes(cellB)) assert.ok(money.indexOf(cellA) < money.indexOf(cellB), money);
  const [{ sooner }] = await sql()<{ sooner: number }[]>`
    SELECT count(*)::int AS sooner FROM programs WHERE status = 'active' AND ends_at > now() AND ends_at < ${new Date(Date.now() + 4 * 3_600_000)} AND id NOT IN (${a.id}, ${b2.id})`;
  if (sooner === 0) {
    assert.equal(money, `Open now: ${cellA} ${cellB}`, s);
    assert.equal(paras.at(-1), checkNeedsAsk('Kit', a.title), s);
  }
  assert.equal(paras.at(-2), checkFitsWhy('Kit'), s);
  assert.match(paras.at(-1)!, /^Want me to check what Kit would need for [^?]+\?$/, s);
  assert.equal(moveUp(first)?.kind, 'check_fits');
  assert.equal(moveUp(first)?.why, checkFitsWhy('Kit'));
  assert.ok(moveUp(first)?.agent_note.startsWith(CHECK_FITS_ASK_NOTE.replace(" Don't show this note.", '')));
  assert.doesNotMatch(s, BAD);
  assert.doesNotMatch(s, /Kit · /);
  assert.equal((s.match(/\?/g) ?? []).length, 1, s);
  // The yes reads that program's requirements.
  const yes = await mcpCall(b.ctx as never, 'tell', { move_up: { kind: 'check_fits', project_key: b.key, answer: 'yes' } });
  const named = /would need for ([^?]+)\?$/.exec(paras.at(-1)!)![1];
  const note = String(yes.reply?.agent_note);
  assert.ok(note.startsWith(CHECK_FITS_NOTE.replace(" Don't show this note.", '')), note);
  assert.ok(note.includes(`${named}`) && /requirements/.test(note), note);
  if (named === a.title) assert.equal(note, checkNeedsNote(a.title));

  // Once only: the next find asks something else, and still leads with the money.
  const second = await find(b);
  assert.notEqual(moveUp(second)?.kind, 'check_fits');
  assert.match(show(second), /^Open now: /, show(second));
  if (moveUp(second)?.kind === 'checkin') assert.equal(show(second).split('\n\n').at(-2), CHECKIN_WHY);

  // The quiet reply (check-in answered, ship asked today): the money, no standing line, no why.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('checkin', 'no', 'ship_asked', now()::text) WHERE builder_id = ${b.id}`;
  const quiet = await find(b);
  const q = show(quiet);
  assert.ok(q.includes('Open now:'), q);
  assert.match(q, /^Open now: [^\n]+\.$/m, q);
  assert.doesNotMatch(q, /·/);
  assert.equal(moveUp(quiet)?.why, undefined);
  assert.doesNotMatch(q, BAD);
});

test('Review Focus 2: an unapplied fit still hears v4.7\'s apply reply, no open-now paragraph, no check_fits', db, async () => {
  const base = committedProgram('base-builder-grants');
  const id = `v471-${process.pid}-fit`;
  const ends = new Date(Date.now() + 20 * DAY);
  const p = ProgramFile.parse({ ...base, id, title: `Fit ${RUN}`, summary: 'up to $5,000', ends_at: ends.toISOString(), status: 'active' });
  await upsertProgram(p);
  const b = await builder('fit', [id]);
  const r = await find(b);
  assert.equal(show(r), applyAsk(p.title, '$5,000', closeDayOf({ summary: p.summary, ends_at: ends })!));
  assert.doesNotMatch(show(r), /Open now/);
  assert.equal(moveUp(r)?.kind, 'apply');
});
