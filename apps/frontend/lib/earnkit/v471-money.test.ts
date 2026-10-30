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
  CHECKIN_ASK, CHECKIN_WHY, SHIP_ASK, applyAsk, askWhy, benchReply, checkFitsWhy, checkNeedsAsk, openNowLine, stateAsk, type BenchView,
} from './bench-reply';
import { CHECK_FITS_ASK_NOTE, CHECK_FITS_NOTE, checkNeedsNote, openNowGrants } from './bench-find';
import type { Card } from './present';
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
    'Open now: Arc Microgrants, 500 USDC × 8 grants, closes Nov 1. Open now: Circle Developer Grants, $5,000 to $100,000 USDC grants, rolling.',
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
  const money = `Open now: ${a.title}, $5,000, ${a.when}. Open now: ${b2.title}, $5,000, ${b2.when}.`;
  const paras = s.split('\n\n');
  assert.equal(paras[0], money, s);
  assert.equal(paras.at(-2), checkFitsWhy('Kit'), s);
  assert.equal(paras.at(-1), checkNeedsAsk('Kit', a.title), s);
  assert.equal(moveUp(first)?.kind, 'check_fits');
  assert.equal(moveUp(first)?.why, checkFitsWhy('Kit'));
  assert.ok(moveUp(first)?.agent_note.startsWith(CHECK_FITS_ASK_NOTE.replace(" Don't show this note.", '')));
  assert.doesNotMatch(s, BAD);
  assert.doesNotMatch(s, /Kit · /);
  assert.equal((s.match(/\?/g) ?? []).length, 1, s);
  // The yes reads that program's requirements.
  const yes = await mcpCall(b.ctx as never, 'tell', { move_up: { kind: 'check_fits', project_key: b.key, answer: 'yes' } });
  assert.equal(yes.reply?.agent_note, checkNeedsNote(a.title));

  // Once only: the next find asks something else, and still leads with the money.
  const second = await find(b);
  assert.notEqual(moveUp(second)?.kind, 'check_fits');
  assert.ok(show(second).startsWith(money), show(second));
  if (moveUp(second)?.kind === 'checkin') assert.equal(show(second).split('\n\n').at(-2), CHECKIN_WHY);

  // The quiet reply (check-in answered, ship asked today): the money, no standing line, no why.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('checkin', 'no', 'ship_asked', now()::text) WHERE builder_id = ${b.id}`;
  const quiet = await find(b);
  const q = show(quiet);
  assert.ok(q.includes('Open now:'), q);
  assert.ok(q.startsWith(money), q);
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
