import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { committedProgram } from './fixtures/program-file';
import { avalanche, dropAvalanche } from './fixtures/find';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { productOdds, productScore, traction, type Detection } from './match';
import { newProgramOf, openCuratedRows, repoCanWin, type FitRepo } from './alerts';
import { scoreFits } from './stand-view';
import { fitWhy, tokenUnavailable } from './bench-find';
import { NOT_ON_BENCH, SHIP_STEP, STATE_COPY, VARIANT_COPY, noFitLine } from './bench-reply';
import type { RepoFit } from './present';

/**
 * Scoring and clarity, Task 4: four reply states (R16a), moving up by shipping (R8: "Ship this week to climb.",
 * never a coin, token or community round unless the builder asks about a token), and funding matches (R12: at
 * most 3 programs that fit, each with its deadline and why; closed programs never shown). Through mcpCall.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'move-up-test-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropAvalanche();
  await sql().end();
});
const RUN = String(process.pid % 100000);
const NO_MATCH = (async () => ({ checked: 1, scored: 0, fits: [] })) as never;
const CLOSED = ['arc-microgrants', 'colosseum-worlds-fair', 'monad-metropolis'] as const;
const OPEN = ['base-builder-grants', 'avalanche-team1-mini-grants', 'circle-developer-grants'] as const;
const COIN_WORDS = /\bcoin\b|\btokens?\b|community round|tokens\.fun|\$[A-Z]{3,}/i;
/** R12: "<program>: <award>, <closes Mon D | rolling>. <Why>." */
const FIT_LINE = /^[^:\n]+: [^,\n]+, (closes [A-Z][a-z]{2} \d{1,2}|rolling)\. [A-Z][^\n]*\.$/;

/** The program files as committed: R12 closes three, synced into this file's database. */
async function syncPrograms() {
  for (const id of [...CLOSED, ...OPEN]) await upsertProgram(ProgramFile.parse(committedProgram(id)));
}

async function agent(x?: string) {
  const t = `ek_mu_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  if (x) assert.ok((await attachToX(own, { id: `97${RUN}${x.length}${x.charCodeAt(0)}${x.charCodeAt(1)}`, username: `${x}${RUN}`.slice(0, 15), name: x, avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  return { id: c.id, ctx: { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: NO_MATCH } };
}

/** A profiled repo with real traction: 120 transactions, a live link that loads, 25 commits in 90 days. */
function profiled(key: string): { facts: RepoFit['facts'] & object; product: NonNullable<RepoFit['product']> } {
  const chains: Detection = {
    base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' },
    avalanche: { mainnet: true, testnet: false, evidence: 'hardhat.config.ts', basis: 'deploy_config' },
    arc: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' },
  };
  const p = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const t = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...p, traction: traction(t), ...productOdds(p, t, p.score) };
  return {
    product,
    facts: {
      name: key.split('/')[1], url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z',
      chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25,
    },
  };
}
/** The matcher's rows for `key`: every program `likely`, the closed ones too (they must never show). */
const matchFor = (key: string, ids: string[]) => {
  const { facts, product } = profiled(key);
  const fits: RepoFit[] = [{
    repo: key.split('/')[1], repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true,
    verdicts: ids.map((id) => ({ program_id: id, program: id, status: 'likely' as const, missing: [], effort: 'none' as const, note: null })),
  }];
  return (async () => ({ checked: 1, scored: 1, fits })) as never;
};

/** A ranked builder: signed in with X, the one project proven by the read-only App. */
async function rankedBuilder(x: string, name: string, gh: number) {
  const a = await agent(x);
  const key = `${x}${RUN}/kit`.toLowerCase();
  await mcpCall(a.ctx, 'find', { identity: { project: { name, repo: `https://github.com/${key}` } } });
  await installApp({ builderId: a.id, repoKey: key, login: `${x}${RUN}`, gh: fakeGitHub({ [key]: { id: gh, owner: `${x}${RUN}`, installation: gh } }) });
  return { ...a, key };
}

const fundPart = (s: string) => s.split('\n\n').find((p) => p.startsWith('Ways to get funded'))!.split('\n').slice(1);

test('R12: arc-microgrants, colosseum-worlds-fair and monad-metropolis are closed in their program files', () => {
  for (const id of CLOSED) assert.equal(committedProgram(id).status, 'closed', id);
  for (const id of OPEN) assert.equal(committedProgram(id).status, 'active', id);
});

test('R8, R12, R16a through find and score: the ranked reply is the score line, the why, at most 3 fits with deadline and why, and "Ship this week to climb."; no coin anywhere; closed programs never show', db, async () => {
  await syncPrograms();
  const extra = await avalanche(); // a fourth open program that fits: only 3 are named
  const a = await rankedBuilder('mvu', 'Kit', 7201);
  const ctx = { ...a.ctx, matchProjects: matchFor(a.key, [...CLOSED, ...OPEN, extra.id]) };
  const r = (await mcpCall(ctx, 'find', {})).reply!;
  const s = String(r.show_to_builder);
  const [stand, , up] = s.split('\n\n');
  const lines = stand.split('\n');
  assert.equal(lines[0], 'Where you stand');
  assert.match(lines[1], /^Kit: Shipping \d+ · (#\d+ of \d+ builders?|Top [\d.]+% of builders) this week\.$/, s);
  assert.match(lines[2], /^(No code in the last 12 weeks|Code in \d+ of the last 12 weeks)/, 'the why sentence');
  const fund = fundPart(s);
  assert.ok(fund.length >= 1 && fund.length <= 3, s);
  for (const l of fund) assert.match(l, FIT_LINE, l);
  // R12 (fix round 1): one order, present.ts byDeadline: all rolling here, so the bigger award first.
  assert.equal(fund[0], `${committedProgram('circle-developer-grants').title}: up to $100K, rolling. You deployed on Arc and your app is live.`, s);
  assert.equal(fund.length, 3);
  assert.equal((r.lead as { program_id: string } | undefined)?.program_id, 'circle-developer-grants', 'the lead is the first named');
  assert.equal(up, `How to move up\n${SHIP_STEP}`);
  for (const id of CLOSED) assert.ok(!s.includes(committedProgram(id).title), `${id} is closed: ${s}`);
  assert.doesNotMatch(s, COIN_WORDS, s);
  assert.equal(r.move_up && (r.move_up as { kind: string }).kind, 'ship');
  assert.match(String((r.move_up as { agent_note: string }).agent_note), /suggest one small, real thing to ship this week/);
  assert.equal((await sql()`SELECT 1 FROM coin_moments WHERE builder_id = ${a.id}`).length, 0, 'no coin offer recorded');

  // score: the same parts, its fits from the real matcher over what find saw (fit_repos), never a closed program.
  const sc = (await mcpCall(a.ctx, 'score', {})).reply!;
  const t = String(sc.show_to_builder);
  assert.match(t, /^Kit: Shipping \d+ · /m);
  const fits = fundPart(t);
  assert.equal(fits.length, 3, t);
  for (const l of fits) assert.match(l, FIT_LINE, l);
  assert.deepEqual(fits, fund, 'find and score name the same fits in the same order');
  assert.ok(t.endsWith(`How to move up\n${SHIP_STEP}`), t);
  assert.doesNotMatch(t, COIN_WORDS, t);
  for (const id of CLOSED) assert.ok(!t.includes(committedProgram(id).title), id);
});

test('R8: asking about a token (tell token: \'ask\', through the MCP schema) returns the offer; find and score never do', db, async () => {
  await syncPrograms();
  const a = await rankedBuilder('tka', 'Tokenkit', 7202);
  await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${a.id} AND kind = 'repo'`;
  // Launches off (no tokens.fun key): asking says so, nothing is recorded.
  const off = (await mcpCall(a.ctx, 'tell', { token: 'ask' })).reply!;
  assert.equal(off.show_to_builder, tokenUnavailable('Tokenkit'));
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
  try {
    const ctx = { ...a.ctx, tokenDeps: { check: async () => true } };
    const asked = (await mcpCall(ctx, 'tell', { token: 'ask' })).reply!;
    assert.match(String(asked.show_to_builder), /^A coin pays you 40% of its trading fees\. Want to launch a coin, \$TOKENKIT \(Tokenkit\), for Tokenkit\?$/, JSON.stringify(asked));
    assert.deepEqual(asked.coin, { project_key: a.key });
    assert.match(String(asked.agent_note), /tell with coin/);
    // The default paths stay clean even with an open offer.
    for (const tool of ['find', 'score'] as const) assert.doesNotMatch(String((await mcpCall(a.ctx, tool, {})).reply?.show_to_builder), COIN_WORDS, tool);
    // The existing token path keeps working: the yes to the offer, then confirm { project_id }.
    const yes = (await mcpCall(ctx, 'tell', { coin: { project_key: a.key, answer: 'yes', wallet: `0x${'e'.repeat(40)}` } })).reply!;
    assert.equal(typeof yes.project_id, 'number', JSON.stringify(yes));
  } finally {
    delete process.env.TOKENSFUN_DEPLOY_API_KEY;
  }
});

test('R16a: the four states\' copy, one table (signed_out, no_project, not_counted, ranked)', () => {
  assert.deepEqual(Object.keys(STATE_COPY), ['signed_out', 'no_project', 'not_counted', 'ranked']);
  assert.equal(STATE_COPY.signed_out.stand(), NOT_ON_BENCH);
  assert.equal(STATE_COPY.no_project.stand(), NOT_ON_BENCH);
  assert.equal(STATE_COPY.not_counted.stand('Kit'), "Kit isn't counted yet.");
  assert.equal(STATE_COPY.ranked.stand('Kit', 72, '#3 of 40 builders this week'), 'Kit: Shipping 72 · #3 of 40 builders this week.');
  assert.equal(STATE_COPY.ranked.ask(), 'Ship this week to climb.');
  // The other states keep their next steps: sign in, name a repo, install the App.
  assert.match(STATE_COPY.signed_out.ask('https://x'), /^Sign in with X/);
  assert.equal(STATE_COPY.no_project.noApp(), "What's your GitHub, or a link to something you've made?");
  assert.match(STATE_COPY.not_counted.ask('https://x'), /^Install the read-only EarnKit app/);
  for (const l of [...Object.values(STATE_COPY).flatMap((c) => Object.values(c).map((f) => (f as (...a: unknown[]) => string)('Kit', 1, null))),
    ...Object.values(VARIANT_COPY).flatMap((v) => [v.stand('Kit'), v.ask('Kit')]), noFitLine('Kit')])
    assert.doesNotMatch(l, COIN_WORDS, l);
});

test('R16a through mcpCall: signed out, no project and not counted keep their own step; only ranked says "Ship this week to climb."', db, async () => {
  const out = await agent();
  const s1 = String((await mcpCall(out.ctx, 'find', {})).reply?.show_to_builder);
  assert.match(s1, /You're not on the leaderboard yet\.[\s\S]*How to move up\nSign in with X/);
  const none = await agent('nop');
  const s2 = String((await mcpCall(none.ctx, 'find', {})).reply?.show_to_builder);
  // Launch ready L2: the repo picker's install link, never a GitHub URL asked for.
  assert.match(s2, /How to move up\nInstall the read-only EarnKit app on the repo you want ranked \(one click\): https:\/\/earnkit\.com\/github\/verify\?n=\S+\nWant me to rank it once that's done\?$/, s2);
  const unc = await agent('unc');
  const s3 = String((await mcpCall(unc.ctx, 'find', { identity: { project: { name: 'Unc', repo: `https://github.com/unc${RUN}/unc` } } })).reply?.show_to_builder);
  assert.match(s3, /Unc isn't counted yet\.[\s\S]*Install the read-only EarnKit app/);
  for (const s of [s1, s2, s3]) {
    assert.ok(!s.includes(SHIP_STEP), s);
    assert.doesNotMatch(s, COIN_WORDS, s);
  }
});

test('R12 positive match (Task 2c carry): a profiled builder with transactions, a live link and commits on a fitting chain gets good-odds fits from the real matcher', db, async () => {
  await syncPrograms();
  const key = `pos${RUN}/kit`;
  const { facts, product } = profiled(key);
  assert.equal(product.tier, 'product');
  assert.equal(product.odds, 'good');
  const repo: FitRepo = { key, name: 'kit', url: facts.url, homepage: facts.homepage, created_at: facts.created_at, chains: facts.chains, product, live_verified: true, said: null, tx_count: 120 };
  const rows = new Map((await openCuratedRows()).map((r) => [r.id, newProgramOf(r)]));
  assert.equal(repoCanWin(rows.get('base-builder-grants')!, repo), true, 'Base: deployed, live, real use');
  assert.equal(repoCanWin(rows.get('circle-developer-grants')!, repo), true, 'Arc: deployed, live, real use');
  for (const id of CLOSED) assert.equal(rows.has(id), false, `${id} is not open`);
  // scoreFits over the stored fit repo: byDeadline order, at most 3, each with its why.
  const a = await agent('psf');
  await sql()`UPDATE installations SET fit_repos = ${sql().json([repo] as never)} WHERE id = ${a.id}`;
  const { listPrograms } = await import('./programs');
  const fits = await scoreFits(a.id, key, { cards: await listPrograms(), skip: new Set(), now: new Date() });
  assert.ok(fits.length >= 2 && fits.length <= 3, JSON.stringify(fits.map((f) => f.card.id)));
  assert.equal(fits[0].card.id, 'circle-developer-grants', 'byDeadline: all rolling, so the biggest award first');
  assert.ok(fits.some((f) => f.card.id === 'avalanche-team1-mini-grants'), JSON.stringify(fits.map((f) => f.card.id)));
  assert.equal(fitWhy(fits[0].card, { chains: repo.chains, live: true }), 'You deployed on Arc and your app is live.');
  // A low-odds repo (no traction) gets none.
  const low = { ...repo, product: { ...product, odds: 'low' as const, traction: 0 }, tx_count: 0 };
  await sql()`UPDATE installations SET fit_repos = ${sql().json([low] as never)} WHERE id = ${a.id}`;
  assert.deepEqual(await scoreFits(a.id, key, { cards: await listPrograms(), skip: new Set(), now: new Date() }), []);
});

test('R12 fitWhy: from the matcher\'s facts, in plain words', () => {
  const card = { chains: ['base', 'arc'] as const, any_chain: false, tag: 'needs a live product' };
  const d = (basis: 'deployed' | 'deploy_config' | 'mention', mainnet = true) => ({ mainnet, testnet: !mainnet, evidence: 'x', basis });
  assert.equal(fitWhy({ ...card, chains: [...card.chains] }, { chains: { base: d('deployed') }, live: true }), 'You deployed on Base and your app is live.');
  assert.equal(fitWhy({ ...card, chains: [...card.chains] }, { chains: { arc: d('deploy_config') }, live: false }), 'You deploy to Arc.');
  assert.equal(fitWhy({ chains: ['base'], any_chain: false, tag: null }, { chains: { base: d('mention', false) }, live: true }), 'You build for Base.');
  assert.equal(fitWhy({ chains: [], any_chain: true, tag: null }, { chains: {}, live: false }), 'It takes any chain.');
  // A credited mainnet comes before one only mentioned.
  assert.equal(fitWhy({ chains: ['base', 'arc'], any_chain: false, tag: null }, { chains: { base: d('mention'), arc: d('deployed') }, live: false }), 'You deployed on Arc.');
});

test('R12 byDeadline (fix round 1): the soonest deadline first, rolling last, then the bigger award, then the id', async () => {
  const { byDeadline } = await import('./present');
  const c = (id: string, ends: string | null, usd: number | null) => ({ id, ends_at: ends ? new Date(ends) : null, max_award_usd: usd });
  const sorted = [c('roll-small', null, 500), c('late', '2026-12-01', 100), c('roll-big', null, 9000), c('soon', '2026-10-30', 50), c('soon-big', '2026-10-30', 5000)].sort(byDeadline);
  assert.deepEqual(sorted.map((x) => x.id), ['soon-big', 'soon', 'late', 'roll-big', 'roll-small']);
});
