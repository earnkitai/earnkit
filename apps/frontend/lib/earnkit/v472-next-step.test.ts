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
import { ASKS_HINT, SHIP_ASK, applyAsk, askWhy, benchReply, needsAsk, needsWhy, openNowLine, stateAsk, type BenchView } from './bench-reply';
import { checkNeedsNote, openNowGrants, openNowInvestment, programNeeds } from './bench-find';
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

test('needsWhy and needsAsk: the exact copy', () => {
  assert.equal(needsWhy('EarnKit', 'Arc Microgrants: Built with Arc Studio', ['on Arc mainnet']), 'Arc Microgrants needs EarnKit on Arc mainnet.');
  assert.equal(needsWhy('Kit', 'Arc Microgrants', ['on Arc mainnet', 'in a public repo']), 'Arc Microgrants needs Kit on Arc mainnet and in a public repo.');
  assert.equal(needsWhy('Kit', 'Arc Microgrants', ['on Arc mainnet', 'in a public repo', 'live at a link']), 'Arc Microgrants needs Kit on Arc mainnet, in a public repo and live at a link.');
  assert.equal(needsWhy('Kit', 'Arc Microgrants', []), 'Nothing EarnKit can see rules Kit out of Arc Microgrants.');
  assert.equal(needsAsk('EarnKit', 'Arc Microgrants: Built with Arc Studio'), 'Want the steps to get EarnKit ready for Arc Microgrants?');
  for (const s of [needsWhy('Kit', 'A', ['on Arc mainnet']), needsWhy('Kit', 'A', []), needsAsk('Kit', 'A')]) assert.doesNotMatch(s, BAD);
});

test('the quiet ranked reply with open grants ends with ASKS_HINT and has no question', () => {
  const open = [{ title: 'Arc Microgrants: Built with Studio', amount: '500 USDC × 8 grants', when: 'closes Nov 1' }];
  const v: BenchView = {
    state: 'ranked', variant: null, project: { key: 'maya/kit', name: 'Kit', confirmed: true, live: true, weeks: 6 }, rank: '#3 of 40 builders', streak: 6,
    target: null, handle: 'maya', link: null, fund: [], due: [], ask: { kind: 'none', project_key: 'maya/kit', line: '' }, held: null,
    standingShown: true, nagShown: true, openNow: open, openTotal: '$105.5K', openInvest: INVEST,
  };
  const s = benchReply(v);
  assert.equal(s.split('\n\n').at(-1), ASKS_HINT, s);
  assert.ok(!s.includes('?'), s);
  // The check_fits ask: the why names the gap, the question is last.
  const ask = { ...v, checkFits: { id: 'arc', title: open[0].title, needs: ['on Arc mainnet'] } };
  const cf = benchReply({ ...ask, ask: stateAsk({ state: 'ranked', variant: null, project: ask.project, link: null, checkFits: ask.checkFits }) });
  const ps = cf.split('\n\n');
  assert.equal(ps.at(-1), 'Want the steps to get Kit ready for Arc Microgrants?', cf);
  assert.equal(ps.at(-2), 'Arc Microgrants needs Kit on Arc mainnet.', cf);
  assert.equal(askWhy({ ...ask, ask: { kind: 'check_fits', project_key: 'maya/kit', line: '' } }), 'Arc Microgrants needs Kit on Arc mainnet.');
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
/** Every open program but `keep` said no to (the needs ask), so the test's own two are the only candidates. */
async function declineOthers(id: number, keep: string[]) {
  const rows = await sql()<{ id: string }[]>`SELECT id FROM programs WHERE status = 'active' AND (ends_at IS NULL OR ends_at > now()) AND NOT (id = ANY(${keep}::text[]))`;
  const declined = Object.fromEntries(rows.map((r) => [`needs:${r.id}`, new Date().toISOString()]));
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{declined}',
    COALESCE(standing_seen->'declined', '{}'::jsonb) || ${sql().json(declined as never)}::jsonb) WHERE builder_id = ${id}`;
}
const last = (s: string) => s.split('\n\n').at(-1)!;
const moveUpOf = (r: Awaited<ReturnType<typeof mcpCall>>) => r.reply?.move_up as { kind: string; why?: string; agent_note: string } | undefined;

test('Review Focus 1: no fit, two open programs: A three times with its gap, then B, then a no to B gives ASKS_HINT', db, async () => {
  const A = await program('arc-microgrants-studio', 'na', 10);
  const B = await program('base-builder-grants', 'nb', 20);
  const b = await builder('nd', []);
  await declineOthers(b.id, [A.id, B.id]);
  for (let i = 1; i <= 3; i++) {
    const r = await find(b);
    const s = show(r);
    assert.equal(last(s), needsAsk('Kit', A.title), `find ${i}: ${s}`);
    assert.ok(s.split('\n\n').at(-2)!.startsWith(`${A.title} needs Kit on Arc mainnet`), s);
    assert.equal(moveUpOf(r)?.why, s.split('\n\n').at(-2));
    assert.equal(moveUpOf(r)?.kind, 'check_fits');
    assert.equal((s.match(/\?/g) ?? []).length, 1, s);
    assert.doesNotMatch(s, BAD);
  }
  const fourth = await find(b);
  assert.equal(last(show(fourth)), needsAsk('Kit', B.title), show(fourth));
  assert.ok(/^(Need nb \d+ needs Kit .+\.|Nothing EarnKit can see rules Kit out of Need nb \d+\.)$/.test(show(fourth).split('\n\n').at(-2)!), show(fourth));
  // A no to B, with nothing else due (check-in answered, ship asked today).
  const no = await mcpCall(b.ctx as never, 'tell', { move_up: { kind: 'check_fits', project_key: b.key, answer: 'no' } });
  assert.ok(!String(no.reply?.show_to_builder).includes('?'));
  const [seen] = await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${b.id}`;
  assert.ok((seen.s.declined as Record<string, string>)[`needs:${B.id}`]);
  assert.equal((seen.s.needs_unanswered as Record<string, number> | undefined)?.[B.id], undefined);
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('checkin', 'no', 'ship_asked', now()::text) WHERE builder_id = ${b.id}`;
  const fifth = show(await find(b));
  assert.equal(last(fifth), ASKS_HINT, fifth);
  assert.ok(!fifth.includes('?'), fifth);
  assert.match(fifth, /^Open now: /, fifth);
  assert.doesNotMatch(fifth, BAD);
});

test('Review Focus 4: a yes to the needs ask reads that program, and it is not asked again', db, async () => {
  const A = await program('arc-microgrants-studio', 'ya', 11);
  const B = await program('base-builder-grants', 'yb', 21);
  const b = await builder('ny', []);
  await declineOthers(b.id, [A.id, B.id]);
  assert.equal(last(show(await find(b))), needsAsk('Kit', A.title));
  const yes = await mcpCall(b.ctx as never, 'tell', { move_up: { kind: 'check_fits', project_key: b.key, answer: 'yes' } });
  assert.equal(yes.reply?.agent_note, checkNeedsNote(A.title));
  const [seen] = await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${b.id}`;
  assert.ok((seen.s.needs_yes as Record<string, string>)[A.id]);
  assert.equal((seen.s.needs_unanswered as Record<string, number> | undefined)?.[A.id], undefined);
  for (let i = 0; i < 2; i++) assert.ok(!show(await find(b)).includes(needsAsk('Kit', A.title)));
});

test('Review Focus 5: a builder with a fit gets the money-first apply reply, no needs ask', db, async () => {
  const base = committedProgram('base-builder-grants');
  const id = `v472-${process.pid}-fit`;
  const ends = new Date(Date.now() + 20 * 86_400_000);
  const p = ProgramFile.parse({ ...base, id, title: `Fit ${RUN}`, summary: 'up to $5,000', ends_at: ends.toISOString(), status: 'active' });
  await upsertProgram(p);
  const b = await builder('nfit', [id]);
  const r = await find(b);
  assert.equal(show(r), applyAsk(p.title, '$5,000', closeDayOf({ summary: p.summary, ends_at: ends })!));
  assert.equal(moveUpOf(r)?.kind, 'apply');
});

/** v4.7.2 Task 2 fix round 1. Each DB test's program closes sooner than the ones before it, so it leads openNow. */
test('ruling B: no open grant, an investment or a total still makes the Open now line; the quiet reply ends with ASKS_HINT', () => {
  assert.equal(openNowLine([], { total: '$9K', invest: INVEST }), 'Open now: $9K in grants. a16z speedrun SR008, up to $1M investment, closes Nov 1.');
  assert.equal(openNowLine([], { total: null, invest: INVEST }), 'Open now: a16z speedrun SR008, up to $1M investment, closes Nov 1.');
  assert.equal(openNowLine([], { total: '$9K', invest: null }), 'Open now: $9K in grants.');
  assert.equal(openNowLine([], { total: null, invest: null }), null);
  const base: BenchView = {
    state: 'ranked', variant: null, project: { key: 'maya/kit', name: 'Kit', confirmed: true, live: true, weeks: 6 }, rank: '#3 of 40 builders', streak: 6,
    target: null, handle: 'maya', link: null, fund: [], due: [], ask: { kind: 'none', project_key: 'maya/kit', line: '' }, held: null,
    standingShown: true, nagShown: true, openNow: [], openTotal: null, openInvest: INVEST,
  };
  const quiet = benchReply(base);
  assert.ok(quiet.startsWith('Open now: a16z speedrun SR008, up to $1M investment, closes Nov 1.'), quiet);
  assert.equal(last(quiet), ASKS_HINT, quiet);
  assert.ok(!quiet.includes('?'), quiet);
  // The needs ask naming only the investment: the money paragraph leads, the why, then the question.
  const checkFits = { id: 'a16z', title: INVEST.title, needs: [] };
  const cf = benchReply({ ...base, checkFits, ask: stateAsk({ state: 'ranked', variant: null, project: base.project, link: null, checkFits }) });
  const ps = cf.split('\n\n');
  assert.equal(ps[0], 'Open now: a16z speedrun SR008, up to $1M investment, closes Nov 1.', cf);
  assert.equal(ps.at(-2), 'Nothing EarnKit can see rules Kit out of a16z speedrun SR008.', cf);
  assert.equal(ps.at(-1), 'Want the steps to get Kit ready for a16z speedrun SR008?', cf);
  // No grant, no investment, no total: no line, and no hint (nothing open to point at).
  const none = benchReply({ ...base, openInvest: null });
  assert.ok(!none.includes('Open now') && !none.includes(ASKS_HINT), none);
});

test('Review Focus 4: a no to A moves straight to B and clears A\'s count', db, async () => {
  const A = await program('arc-microgrants-studio', 'qa', 8);
  const B = await program('base-builder-grants', 'qb', 9);
  const b = await builder('nq', []);
  await declineOthers(b.id, [A.id, B.id]);
  assert.equal(last(show(await find(b))), needsAsk('Kit', A.title));
  const counted = await seenOf(b.id);
  assert.equal((counted.needs_unanswered as Record<string, number>)[A.id], 1);
  await mcpCall(b.ctx as never, 'tell', { move_up: { kind: 'check_fits', project_key: b.key, answer: 'no' } });
  const after = await seenOf(b.id);
  assert.equal((after.needs_unanswered as Record<string, number> | undefined)?.[A.id], undefined);
  assert.ok((after.declined as Record<string, string>)[`needs:${A.id}`]);
  const next = show(await find(b));
  assert.equal(last(next), needsAsk('Kit', B.title), next);
  // The grants list still names the declined grant A.
  assert.ok(next.split('\n\n')[0].includes(`${A.title}, `), next);
});

test('ruling A: a no to the needs ask for an investment keeps it out of the investment slot', db, async () => {
  const G = await program('arc-microgrants-studio', 'ia', 7);
  const I = await investment('ii');
  const b = await builder('ni', []);
  await declineOthers(b.id, [G.id, I.id]);
  const first = show(await find(b));
  assert.ok(first.split('\n\n')[0].includes(`${I.title}, up to $1M investment`) || first.split('\n\n')[0].includes(`${I.title}, up to $1,000,000 investment`), first);
  assert.equal(last(first), needsAsk('Kit', G.title), first);
  await mcpCall(b.ctx as never, 'tell', { move_up: { kind: 'check_fits', project_key: b.key, answer: 'no' } });
  const second = show(await find(b));
  assert.equal(last(second), needsAsk('Kit', I.title), second);
  await mcpCall(b.ctx as never, 'tell', { move_up: { kind: 'check_fits', project_key: b.key, answer: 'no' } });
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('checkin', 'no', 'ship_asked', now()::text) WHERE builder_id = ${b.id}`;
  const third = show(await find(b));
  assert.ok(!third.includes(I.title), third);
  // The declined grant G still shows in the grants list; nothing left to ask, so ASKS_HINT.
  assert.ok(third.split('\n\n')[0].includes(`${G.title}, `), third);
  assert.equal(last(third), ASKS_HINT, third);
});

const seenOf = async (id: number) =>
  (await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`)[0].s;

test('a needs showing on a held or a nudge-owned reply is never counted', db, async () => {
  const A = await program('arc-microgrants-studio', 'ha', 6);
  // Held: a confirmed entry for a rolling program (Base's grant): its submit step is the reply's held question.
  const h = await builder('nh', []);
  await declineOthers(h.id, [A.id]);
  await sql()`INSERT INTO projects (program_id, name, installation_id, confirmed_at) VALUES ('base-builder-grants', 'Kit', ${h.id}, now())`;
  const held = await find(h);
  assert.notEqual(moveUpOf(held)?.kind, 'check_fits', show(held));
  assert.ok(!show(held).includes(needsAsk('Kit', A.title)), show(held));
  assert.equal(((await seenOf(h.id)).needs_unanswered as Record<string, number> | undefined)?.[A.id], undefined);
  // Nudge-owned: an accepted outcome from before this week whose post isn't shared yet owns the one question.
  const o = await builder('no', []);
  await declineOthers(o.id, [A.id]);
  const code = Array.from({ length: 10 }, () => 'abcdefghijklmnopqrstuvwxyz234567'[Math.floor(Math.random() * 32)]).join('');
  const made = new Date(Date.now() - 8 * 86_400_000);
  await sql()`INSERT INTO post_drafts (code, builder_id, project_key, moment, moment_key, shape, text, proof_url, created_at, expires_at)
    VALUES (${code}, ${o.id}, ${o.key}, 'accepted', ${`accepted:${A.id}`}, 'accepted', 'Kit was accepted.', 'https://example.com/news', ${made}, ${new Date(made.getTime() + 14 * 86_400_000)})`;
  const owned = await find(o);
  assert.equal(moveUpOf(owned)?.kind, 'outcome_share', show(owned));
  assert.equal(((await seenOf(o.id)).needs_unanswered as Record<string, number> | undefined)?.[A.id], undefined);
});
