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
import { SHIP_ASK, benchReply, needsWhy, type BenchView } from './bench-reply';
import { needsKnown, needsYesNote, openNowInvestment, programNeeds } from './bench-find';
import { listPrograms } from './programs';
import { moneyText, openMoneyUsd } from './pool';
import { productOdds, productScore, traction, type Detection } from './match';
import type { Card, RepoFit } from './present';

/**
 * v4.7.2 Tasks 1 and 2, what stays after v4.8 Task 1: the soonest open investment, the landing total, the gap engine
 * (programNeeds, needsKnown, needsWhy) and the fit reply word for word. v4.8 retired the "Open now:" paragraph and the
 * rotating needs ask (the path names the money and the gap: conversation.ts, v48-conversation.test.ts).
 */
const NOW = new Date('2026-10-31T12:00:00Z');
const card = (o: Record<string, unknown>) =>
  ({ id: 'p', title: 'P', summary: '$1,000', reward: '$1,000', tag: 'likely', each_time: [], ends_at: null, status: 'active', max_award_usd: 1000, ...o }) as unknown as Card;
const A16Z = card({
  id: 'a16z', title: 'a16z speedrun SR008', summary: 'up to $1M · priority window Oct 12 to Nov 1', reward: 'Up to $1M in funding and $10M+ in credits',
  investment: true, max_award_usd: 1_000_000, ends_at: new Date('2026-11-01T20:00:00Z'),
});
const ARC = card({ id: 'arc', title: 'Arc Microgrants: Built with Studio', summary: '500 USDC × 8 grants · closes Nov 1', reward: '500 USDC', max_award_usd: 4000, ends_at: new Date('2026-11-01T20:00:00Z') });
const BASE = card({ id: 'base', title: 'Base Builder Grant Program', summary: '$5,000 · rolling', reward: '$5,000', max_award_usd: 5000 });


test('openNowInvestment: first open investment, never "up to up to"', () => {
  const i = openNowInvestment([ARC, A16Z], NOW, new Set());
  assert.equal(i?.id, 'a16z');
  // v4.8 Task 1: the "Open now:" line is retired; the amount cell keeps one "up to".
  assert.equal(i?.amount, 'up to $1M');
});

test('openNowInvestment: skips an applied one, a closed one, and is null with none', () => {
  assert.equal(openNowInvestment([ARC, A16Z], NOW, new Set(['a16z'])), null);
  assert.equal(openNowInvestment([ARC, A16Z], new Date('2026-11-05T00:00:00Z'), new Set()), null);
  assert.equal(openNowInvestment([ARC, BASE], NOW, new Set()), null);
  assert.equal(openNowInvestment([{ ...A16Z, sponsored: true } as Card], NOW, new Set()), null);
  assert.equal(openNowInvestment([{ ...A16Z, agent_completable: false } as Card], NOW, new Set()), null);
});

test('openNowInvestment: soonest closes first, rolling last', () => {
  const rolling = card({ ...A16Z, id: 'r', title: 'Rolling', ends_at: null, summary: 'up to $2M · rolling' });
  const soon = card({ ...A16Z, id: 's', title: 'Soon', ends_at: new Date('2026-11-10T00:00:00Z') });
  assert.equal(openNowInvestment([rolling, soon], NOW, new Set())?.id, 's');
});

test('the total is the landing chip figure and leaves the investment out', () => {
  const cards = [ARC, BASE, A16Z];
  const total = moneyText(openMoneyUsd(cards, NOW));
  assert.equal(total, '$9K');
});

appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v472-next-step-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});
const RUN = String(process.pid % 100000);

let n = 0;
/** A ranked builder (X, the repo proven by the App) the matcher fits for `programs` (none: no fit). */
async function builder(tag: string, programs: string[]) {
  n++;
  const t = `ek_v472_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `mo${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `472${RUN}${n}${tag.length}`, username: handle, name: 'mo', avatar: null }, new Date())).ok);
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
  const gid = 47200 + n * 10 + (Number(RUN) % 7);
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh: fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } }) });
  // The connect weeks are another task's moment; Base's grant steps were declined today (the owner's account).
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text,
      'declined', jsonb_build_object(${`qualify:${key}`}::text, now()::text)) WHERE builder_id = ${c.id}`;
  return { ctx, id: c.id, key };
}

/** v4.7.2 Task 2: the why names the gap, and every reply has a next step. */
const BAD = /—|\bcoins?\b|\bpoints?\b|\p{Extended_Pictographic}/iu;
const ARC_FILE = committedProgram('arc-microgrants-studio', { keepContract: true });

test('programNeeds: Arc with Arc not known gives "on Arc mainnet"; all known gives none; all three in order', () => {
  assert.deepEqual(programNeeds(ARC_FILE, { chains: new Set(['base']), repo: true, live: true }), ['on Arc mainnet']);
  assert.deepEqual(programNeeds(ARC_FILE, { chains: new Set(['arc']), repo: true, live: true }), []);
  assert.deepEqual(programNeeds(ARC_FILE, { chains: new Set(), repo: false, live: false }), ['on Arc mainnet', 'in a public repo', 'live at a link']);
  // No contract, no repo rule, no live field: nothing to name.
  assert.deepEqual(programNeeds({ needs_contract: null, needs_repo: false, submission_requirements: [] }, { chains: new Set(), repo: false, live: false }), []);
});

test('needsWhy: the exact copy; the check_fits yes note', () => {
  assert.equal(needsWhy('EarnKit', 'Arc Microgrants: Built with Arc Studio', ['on Arc mainnet']), 'Arc Microgrants needs EarnKit on Arc mainnet.');
  assert.equal(needsWhy('Kit', 'Arc Microgrants', ['on Arc mainnet', 'in a public repo']), 'Arc Microgrants needs Kit on Arc mainnet and in a public repo.');
  assert.equal(needsWhy('Kit', 'Arc Microgrants', ['on Arc mainnet', 'in a public repo', 'live at a link']), 'Arc Microgrants needs Kit on Arc mainnet, in a public repo and live at a link.');
  // Final review 3 (ruled copy): no known gap.
  assert.equal(needsWhy('Kit', 'Arc Microgrants: Built with Arc Studio', []), "EarnKit can't see what Arc Microgrants would need from Kit yet.");
  // v4.8 Task 1: needsWhy is the path's gap sentence for a grant other than Base's; the rotating question is retired.
  for (const s of [needsWhy('Kit', 'A', ['on Arc mainnet']), needsWhy('Kit', 'A', [])]) assert.doesNotMatch(s, BAD);
  // Final review 4: the yes never runs find again; its note names the gaps and asks nothing after.
  const note = needsYesNote('Arc Microgrants', ['on Arc mainnet']);
  assert.ok(note.includes("Don't call find") && note.includes('on Arc mainnet') && /ask no question/.test(note) && /Never tell them they qualify/.test(note), note);
  assert.ok(needsYesNote('Arc Microgrants', []).includes('EarnKit sees no gap of its own yet.'));
});

/** A copy of a committed program, open, closing `minutes` from now; Arc keeps its contract rule. */
async function program(file: string, tag: string, minutes: number) {
  const base = committedProgram(file, { keepContract: file.startsWith('arc') });
  const id = `v472-${process.pid}-${tag}`;
  const ends = new Date(Date.now() + minutes * 60_000);
  const p = ProgramFile.parse({ ...base, id, title: `Need ${tag} ${RUN}`, summary: 'up to $5,000', ends_at: ends.toISOString(), status: 'active', starts_at: null });
  await upsertProgram(p);
  return { id, title: p.title };
}

/** v4.7.2 final review. */
test('final review 11: a builder with a fit gets the v4.7.1 reply, word for word', () => {
  const P = { key: 'maya/kit', name: 'Kit', confirmed: true, live: true, weeks: 6 };
  const fit = { kind: 'fits' as const, title: 'Base Builder Grant Program', amount: '$5,000', when: 'rolling' };
  const v: BenchView = {
    state: 'ranked', variant: null, project: P, rank: '#3 of 40 builders', streak: 6, target: null, handle: 'maya', link: null,
    fund: [fit], due: [], held: null, standingShown: true, nagShown: true, standingText: 'Score 77 · #3 of 40 builders. 6 weeks shipping in a row.',
    best: { ...fit, program_id: 'base-builder-grants', why: 'You deployed on Base and your app is live.', codes: null },
    ask: { kind: 'ship', project_key: P.key, line: SHIP_ASK },
  };
  // The strings v4.7.1's bench-reply.ts (7a7b3b39) gives for this view.
  assert.equal(benchReply(v), 'Score 77 · #3 of 40 builders. 6 weeks shipping in a row.\nYou qualify for the Base Builder Grant Program, up to $5,000.\n\nShipping this week keeps your 6-week streak and lifts your score.\n\nWant me to suggest one small thing to ship?');
  assert.equal(benchReply({ ...v, ask: { kind: 'none', project_key: P.key, line: '' } }), 'Score 77 · #3 of 40 builders. 6 weeks shipping in a row.\nYou qualify for the Base Builder Grant Program, up to $5,000.\nShip code this week.');
});

test('final review 5, 6, 9: the reply\'s own facts count; only a public repo clears "in a public repo"; the Card carries the facts', db, async () => {
  const A = await program('arc-microgrants-studio', 'ka', 5);
  const b = await builder('nk', []);
  await sql()`UPDATE builder_sources SET public_at = NULL WHERE builder_id = ${b.id} AND kind = 'repo'`;
  await sql()`DELETE FROM source_readings WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id = ${b.id} AND kind = 'repo')`;
  assert.equal((await needsKnown(b.id, b.key)).repo, false, 'never read public: not cleared');
  await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${b.id} AND kind = 'repo'`;
  assert.equal((await needsKnown(b.id, b.key)).repo, true, 'read public: cleared');
  const also = await needsKnown(b.id, b.key, { chains: ['ARC'], live: true });
  assert.ok(also.chains.has('arc') && also.live);
  const card = (await listPrograms()).find((c) => c.id === A.id)!;
  assert.equal(card.needs_contract, 'arc');
  assert.equal(card.needs_live, true);
  assert.deepEqual(programNeeds(card, also), []);
});
