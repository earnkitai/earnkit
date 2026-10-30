import { after, test } from 'node:test';
import { walletOffered } from './fixtures/wallet-step';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
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
import { fitLines, fitWhy } from './bench-find';
import { INTRO_LINE, SHIP_ASK, STATE_COPY, VARIANT_COPY } from './bench-reply';
import type { RepoFit } from './present';
import { endsOnRankedStep } from './fixtures/ranked-step';
import { padPool } from './fixtures/rank-pool';

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
/** v4.2 Task 4: programs the find-and-score test closed so only its fixture programs are active; reopened after. */
const parked: string[] = [];
after(async () => {
  if (!process.env.DATABASE_URL) return;
  if (parked.length > 0) await sql()`UPDATE programs SET status = 'active' WHERE id = ANY(${parked}::text[])`;
  await dropAvalanche();
  await sql().end();
});
const RUN = String(process.pid % 100000);
const NO_MATCH = (async () => ({ checked: 1, scored: 0, fits: [] })) as never;
const CLOSED = ['arc-microgrants', 'colosseum-worlds-fair', 'monad-metropolis'] as const;
// v3.1 Task 8: Avalanche Team1 Mini Grants is unlisted (v31-programs.test.ts); find.ts avalanche() keeps an active copy.
const OPEN = ['base-builder-grants', 'circle-developer-grants'] as const;
const COIN_WORDS = /\bcoin\b|\btokens?\b|community round|tokens\.fun|\$[A-Z]{3,}/i;
/** R12: "<program>: <award>, <closes Mon D | rolling>. <Why>." */
/** Task 16: the ranked reply's money line. v3.1 GTM W3: "You qualify" only with nothing in the way, else its condition. */
const FIT_LINE = /^(You qualify for the [^\n]+, up to \$[\d,]+(, closes [A-Z][a-z]{2} \d{1,2})?\.|Long shot: [^\n]+, up to \$[\d,]+( investment)?(, closes [A-Z][a-z]{2} \d{1,2})?\.( It takes a company with a full-time team\.)?|[^\n]+, up to \$[\d,]+(, closes [A-Z][a-z]{2} \d{1,2})?, once (your app is live|you have real users)\.)$/;

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
  await walletOffered(c.id);
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


test('R12: arc-microgrants, colosseum-worlds-fair and monad-metropolis are closed in their program files', () => {
  for (const id of CLOSED) assert.equal(committedProgram(id).status, 'closed', id);
  for (const id of OPEN) assert.equal(committedProgram(id).status, 'active', id);
});

test('R8, R12, R16a through find and score (Task 16): the standing line, one money line (the Best fit), the ship question and its points line; no coin anywhere; closed programs never show', db, async () => {
  // v3.1 F3: the pool reaches RANK_MIN_POOL, so a rank shows.
  await padPool(9);
  await syncPrograms();
  const extra = await avalanche(); // a fourth open program that fits: only 3 are named
  // v4.2 Task 4: score's real matcher reads every active program in the database; a program added to programs/ later
  // (arc-microgrants-studio closes Nov 1) would become the closing-soonest Best fit there while find's fixture holds
  // only these. Park the other committed (seeded) programs for this test and restore exactly those after, so it never
  // depends on today's real list and never touches temporary programs other test files create.
  const here = [...CLOSED, ...OPEN, 'a16z-speedrun', 'alliance-all19'];
  const real = readdirSync(join(import.meta.dirname, '../../../../programs')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((id) => !here.includes(id));
  parked.push(...(await sql()<{ id: string }[]>`UPDATE programs SET status = 'closed' WHERE status = 'active' AND id = ANY(${real}::text[]) RETURNING id`).map((r) => r.id));
  const a = await rankedBuilder('mvu', 'Kit', 7201);
  // v3.1 F1: the open investments (any chain) are fits too, so find's match holds them as score's real matcher does.
  // v3 Stage 2 final review: one closing within 30 days (a16z speedrun, Alliance) is the apply step for this product
  // repo (v3-apply.test.ts (h)); v3.1 spec 3.2: else a rolling fit is. Every program is marked asked here, so the step is
  // the ranked one on any date (the Best fit still leads). v4.7 T3: an open fit asked once is asked again (money
  // first), so each is declined here (kept away DECLINE_MS) for the ranked step.
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb)
    || jsonb_build_object('apply_asked', (SELECT jsonb_object_agg(id, now()::text) FROM programs),
      'declined', (SELECT jsonb_object_agg('apply:' || id, now()::text) FROM programs)) WHERE builder_id = ${a.id}`;
  const ctx = { ...a.ctx, matchProjects: matchFor(a.key, [...CLOSED, ...OPEN, extra.id, 'a16z-speedrun', 'alliance-all19']) };
  const r = (await mcpCall(ctx, 'find', {})).reply!;
  const s = String(r.show_to_builder);
  const lines = s.split('\n');
  assert.match(lines[0], /^Kit · (#\d+ of \d+ builders?|Top [\d.]+% of builders)/, s);
  // v3.1 F4: no why sentence in the reply (the page keeps it); Task 16: no page line, no list of fits.
  assert.doesNotMatch(s, /No code in the last 12 weeks|Code in \d+ of the last 12 weeks|Your page|Ways to get funded/, s);
  assert.match(lines[1], FIT_LINE, s);
  // v4.7 T4: the ship ask's why is its own paragraph before the question.
  assert.equal(lines.length, 6, s);
  assert.equal((r.lead as { program_id: string } | undefined)?.program_id, 'base-builder-grants', 'the lead is the first fit line (never an investment)');
  assert.ok(endsOnRankedStep(s), s);
  for (const id of CLOSED) assert.ok(!s.includes(committedProgram(id).title), `${id} is closed: ${s}`);
  assert.doesNotMatch(s, COIN_WORDS, s);
  assert.equal(r.move_up && (r.move_up as { kind: string }).kind, 'ship');
  assert.match(String((r.move_up as { agent_note: string }).agent_note), /suggest one small, real thing to ship this week/);
  assert.equal((await sql()`SELECT 1 FROM coin_moments WHERE builder_id = ${a.id}`).length, 0, 'no coin offer recorded');

  // score: the same reply, its fits from the real matcher over what find saw (fit_repos), never a closed program.
  const sc = (await mcpCall(a.ctx, 'score', {})).reply!;
  const t = String(sc.show_to_builder);
  // v4.7 T2: score leads with the standing paragraph (the page's score and rank), so no "Kit · " line of its own.
  assert.ok(t.startsWith(`${sc.standing}\n\n`), t);
  assert.doesNotMatch(t, /^Kit · /m);
  assert.equal(t.split('\n')[2], lines[1], `score names the same Best fit: ${t}`);
  // GTM W2: the ship question was just asked (find), so score asks nothing (once in 7 days); v3.1 cold read: the points
  // line was shown this week (find), so score leaves it out too (at most once an ISO week).
  assert.ok(!t.includes('?') && !/points/.test(t), t);
  assert.doesNotMatch(t, COIN_WORDS, t);
  for (const id of CLOSED) assert.ok(!t.includes(committedProgram(id).title), id);
});

test('R8, v4.0 Task 11: an older agent asking about a token (tell token: \'ask\') never gets a project coin; find and score never offer one', db, async () => {
  await syncPrograms();
  const a = await rankedBuilder('tka', 'Tokenkit', 7202);
  await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${a.id} AND kind = 'repo'`;
  // Launches off (no tokens.fun key): no coin offer, nothing is recorded.
  const off = (await mcpCall(a.ctx, 'tell', { token: 'ask' })).reply!;
  assert.doesNotMatch(String(off.show_to_builder), /\bcoin/i);
  assert.equal(off.coin, undefined);
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
  try {
    const ctx = { ...a.ctx, tokenDeps: { check: async () => true } };
    // Launches on: still no project coin (v4.0 Task 11: the builder token answers, v31-mcp-surface (j)).
    const asked = (await mcpCall(ctx, 'tell', { token: 'ask' })).reply!;
    assert.doesNotMatch(String(asked.show_to_builder), /\bcoin/i, JSON.stringify(asked));
    assert.equal(asked.coin, undefined);
    assert.doesNotMatch(String(asked.agent_note ?? ''), /tell with coin|confirm/);
    for (const tool of ['find', 'score'] as const) assert.doesNotMatch(String((await mcpCall(a.ctx, tool, {})).reply?.show_to_builder), COIN_WORDS, tool);
  } finally {
    delete process.env.TOKENSFUN_DEPLOY_API_KEY;
  }
});

test('R16a: the steps\' copy before the account has a page, one table (signed_out, no_project, not_counted); ranked asks to ship', () => {
  assert.deepEqual(Object.keys(STATE_COPY), ['signed_out', 'no_project', 'not_counted']);
  // v3.1 cold read: never "<Project> isn't counted yet.".
  assert.equal(STATE_COPY.not_counted.stand('Kit'), null);
  assert.equal(SHIP_ASK, 'Want me to suggest one small thing to ship?');
  // The other states keep their next steps: sign in, name a repo, install the App.
  assert.match(STATE_COPY.signed_out.ask('https://x'), /^Setup takes about a minute:\n1\. Sign in with X: https:\/\/x\n/);
  assert.equal(STATE_COPY.no_project.noApp(), "What's your GitHub, or a link to something you've made?");
  assert.match(STATE_COPY.not_counted.ask('https://x', false), /^\*\*Step 2 of 3:\*\* connect your app's code on GitHub so I can match you/);
  for (const l of [...Object.values(STATE_COPY).flatMap((c) => Object.values(c).map((f) => (f as (...a: unknown[]) => string)('Kit'))),
    ...Object.values(VARIANT_COPY).flatMap((v) => [v.stand('Kit'), v.ask('Kit')]), SHIP_ASK])
    if (l !== null) assert.doesNotMatch(l, COIN_WORDS, l);
});

test('R16a through mcpCall: signed out, no project and not counted keep their own step; only ranked asks to ship', db, async () => {
  const out = await agent();
  const s1 = String((await mcpCall(out.ctx, 'find', {})).reply?.show_to_builder);
  assert.ok(s1.startsWith(INTRO_LINE), s1);
  assert.match(s1, /\n1\. Sign in with X: https:\/\/\S+\n/);
  const none = await agent('nop');
  const s2 = String((await mcpCall(none.ctx, 'find', {})).reply?.show_to_builder);
  // Launch ready L2: the repo picker's install link, never a GitHub URL asked for.
  // v4.0: GitHub unknown, so no Lovable or Bolt hint.
  assert.match(s2, /\n\*\*Step 2 of 3:\*\* connect your app's code on GitHub so I can match you to the right programs\. Read-only, one click: https:\/\/earnkit\.com\/github\/verify\?n=\S+\n\nDone\?$/, s2);
  const unc = await agent('unc');
  const s3 = String((await mcpCall(unc.ctx, 'find', { identity: { project: { name: 'Unc', repo: `https://github.com/unc${RUN}/unc` } } })).reply?.show_to_builder);
  assert.match(s3, /^You're in, @\S+\. Really glad you're here\.\n\n\*\*Step 2 of 3:\*\* connect your app's code on GitHub so I can match you/);
  for (const s of [s1, s2, s3]) {
    assert.ok(!s.includes(SHIP_ASK), s);
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
  // scoreFits over the stored fit repo: every apply candidate (v3.1 F1), each with its why; the fit lines are the
  // first FITS_MAX by byRelevance (bench-find.ts fitLines): Base first.
  const a = await agent('psf');
  await sql()`UPDATE installations SET fit_repos = ${sql().json([repo] as never)} WHERE id = ${a.id}`;
  const { listPrograms } = await import('./programs');
  const fits = await scoreFits(a.id, key, { cards: await listPrograms(), skip: new Set(), now: new Date() });
  const ids = fits.map((f) => f.card.id);
  for (const id of OPEN) assert.ok(ids.includes(id), JSON.stringify(ids));
  const lines = fitLines(fits);
  assert.equal(lines.length, 3, JSON.stringify(ids));
  assert.equal(lines[0].card.id, 'base-builder-grants', 'byRelevance: Base first');
  assert.equal(fitWhy(lines[0].card, { chains: repo.chains, live: true }), 'You deployed on Base and your app is live.');
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
