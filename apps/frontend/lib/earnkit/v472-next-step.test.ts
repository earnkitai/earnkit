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
import { SHIP_ASK, benchReply, openNowLine, type BenchView } from './bench-reply';
import { openNowGrants, openNowInvestment } from './bench-find';
import { moneyText, openMoneyUsd } from './pool';
import { fridayNudge } from './nudges';
import { productOdds, productScore, traction, type Detection } from './match';
import type { Card, RepoFit } from './present';

/** v4.7.2 Task 1: the open money paragraph carries the total in grants and the soonest open investment. */
const NOW = new Date('2026-10-31T12:00:00Z');
const card = (o: Record<string, unknown>) =>
  ({ id: 'p', title: 'P', summary: '$1,000', reward: '$1,000', tag: 'likely', each_time: [], ends_at: null, status: 'active', max_award_usd: 1000, ...o }) as unknown as Card;
const A16Z = card({
  id: 'a16z', title: 'a16z speedrun SR008', summary: 'up to $1M · priority window Oct 12 to Nov 1', reward: 'Up to $1M in funding and $10M+ in credits',
  investment: true, max_award_usd: 1_000_000, ends_at: new Date('2026-11-01T20:00:00Z'),
});
const ARC = card({ id: 'arc', title: 'Arc Microgrants: Built with Studio', summary: '500 USDC × 8 grants · closes Nov 1', reward: '500 USDC', max_award_usd: 4000, ends_at: new Date('2026-11-01T20:00:00Z') });
const BASE = card({ id: 'base', title: 'Base Builder Grant Program', summary: '$5,000 · rolling', reward: '$5,000', max_award_usd: 5000 });

const GRANTS = [
  { title: 'Arc Microgrants: Built with Studio', amount: '500 USDC × 8 grants', when: 'closes Nov 1' },
  { title: 'Base Builder Grant Program', amount: '$5,000', when: 'rolling' },
];
const INVEST = { title: 'a16z speedrun SR008', amount: 'up to $1M', when: 'closes Nov 1' };

test('openNowLine: the owner line, with total and investment', () => {
  assert.equal(
    openNowLine(GRANTS, { total: '$105.5K', invest: INVEST }),
    'Open now: $105.5K in grants. Arc Microgrants, 500 USDC × 8 grants, closes Nov 1. Base Builder Grant Program, $5,000, rolling. a16z speedrun SR008, up to $1M investment, closes Nov 1.',
  );
});

test('openNowLine: no total, no "in grants." sentence', () => {
  const t = openNowLine(GRANTS, { total: null, invest: INVEST })!;
  assert.ok(t.startsWith('Open now: Arc Microgrants'), t);
  assert.ok(!t.includes('in grants.'), t);
});

test('openNowLine: no investment, no investment part', () => {
  const t = openNowLine(GRANTS, { total: '$105.5K', invest: null })!;
  assert.ok(!t.includes('investment'), t);
  assert.equal(openNowLine(GRANTS), 'Open now: Arc Microgrants, 500 USDC × 8 grants, closes Nov 1. Base Builder Grant Program, $5,000, rolling.');
  assert.equal(openNowLine([]), null);
});

test('openNowInvestment: first open investment, never "up to up to"', () => {
  const i = openNowInvestment([ARC, A16Z], NOW, new Set());
  assert.equal(i?.id, 'a16z');
  assert.equal(openNowLine(GRANTS, { invest: i })!.endsWith('a16z speedrun SR008, up to $1M investment, closes Nov 1.'), true);
  assert.ok(!/up to up to/i.test(openNowLine(GRANTS, { invest: i })!));
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
  assert.equal(openNowGrants(cards, NOW, new Set()).length, 2);
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
const show = (r: Awaited<ReturnType<typeof mcpCall>>) => String(r.reply?.show_to_builder ?? '');

/** A copy of base-builder-grants (a grant), open, closing `hours` from now. */
async function grant(tag: string, hours: number) {
  const base = committedProgram('base-builder-grants');
  const id = `v472-${process.pid}-${tag}`;
  const ends = new Date(Date.now() + hours * 3_600_000);
  const p = ProgramFile.parse({ ...base, id, title: `Open ${tag} ${RUN}`, summary: 'up to $5,000', ends_at: ends.toISOString(), status: 'active' });
  await upsertProgram(p);
  return { id, title: p.title, when: `closes ${closeDayOf({ summary: p.summary, ends_at: ends })}` };
}

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

const find = (b: { ctx: unknown }) => mcpCall(b.ctx as never, 'find', {});
/** An open investment (an accelerator) closing in an hour: sooner than any real program. */
async function investment(tag: string) {
  const base = committedProgram('base-builder-grants');
  const id = `v472-${process.pid}-${tag}`;
  const ends = new Date(Date.now() + 3_600_000);
  const p = ProgramFile.parse({ ...base, id, title: `Accel ${tag} ${RUN}`, summary: 'up to $1,000,000', investment: true, ends_at: ends.toISOString(), status: 'active' });
  await upsertProgram(p);
  return { id, title: p.title, when: `closes ${closeDayOf({ summary: p.summary, ends_at: ends })}` };
}

test('benchView: a ranked builder with no fit hears the total and the investment; one told applied never hears it named', db, async () => {
  const inv = await investment('inv');
  await grant('g', 2);
  const a = await builder('inv1', []);
  const first = show(await find(a));
  const money = first.split('\n\n')[0];
  assert.match(money, /^Open now: \$[\d.,]+[KM]?\+? in grants\. /, first);
  assert.ok(money.includes(`${inv.title}, up to $1M investment, ${inv.when}.`) || money.includes(`${inv.title}, up to $1,000,000 investment, ${inv.when}.`), money);
  assert.ok(!/up to up to/i.test(money), money);
  // The investment is never summed into the figure: the total has no seven-figure part for it.
  assert.doesNotMatch(money, /\$1(\.\d)?M\+? in grants/, money);

  // Told applied (toldAppliedSql): the grants and total stay, the investment is left out.
  const b = await builder('inv2', []);
  await sql()`INSERT INTO builder_program_status (installation_id, program_id, status) VALUES (${b.id}, ${inv.id}, 'applied')`;
  const told = show(await find(b));
  assert.match(told, /^Open now: /, told);
  assert.ok(!told.includes(inv.title), told);
});

test('a non-owning nudge lands right after the Open now paragraph, with the total and investment in it', () => {
  const open = [{ title: 'Arc Microgrants: Built with Studio', amount: '500 USDC × 8 grants', when: 'closes Nov 1' }];
  const v: BenchView = {
    state: 'ranked', variant: null, project: { key: 'maya/kit', name: 'Kit', confirmed: true, live: true, weeks: 6 }, rank: '#3 of 40 builders', streak: 6,
    target: null, handle: 'maya', link: null, fund: [], due: [], ask: { kind: 'ship', project_key: 'maya/kit', line: SHIP_ASK }, held: null,
    standingShown: true, nagShown: true, openNow: open, openTotal: '$105.5K', openInvest: INVEST, nudge: fridayNudge(6),
  };
  const ps = benchReply(v).split('\n\n');
  assert.equal(ps[0], openNowLine(open, { total: '$105.5K', invest: INVEST }));
  assert.ok(ps[0].startsWith('Open now: $105.5K in grants. ') && ps[0].endsWith('a16z speedrun SR008, up to $1M investment, closes Nov 1.'), ps[0]);
  assert.equal(ps[1], fridayNudge(6));
});
