import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { bindX } from './claim';
import { EVENT_LOG_FLAG } from './events';
import { COIN_NOTE, COIN_PROGRAM, coinAllowed, coinLine, coinPitchAllowed, coinYes, offerCoin, raiseLine, showBuiltLive } from './coin-moments';
import { offerKey, readShownOffer, recordDecline } from './token-offers';
import { tokenLineFor } from './token-gate';
import { tools } from './tools';
import type { TokenFlowDeps } from './token-launch';

/**
 * v2.12.1 T10 (spec 3b): the coin is offered as the reply's one yes only at its moments, at most
 * once per project, never after two declines, the wallet shown before the yes, never to a shared
 * client or a held profile; the yes makes a coin entry that confirm launches. DB-gated; no network.
 */

// coinAllowed needs tokenLaunchesAvailable(); test-guard clears the key.
process.env.TOKENSFUN_DEPLOY_API_KEY = 'test';
process.env.EARNKIT_AUTH_SECRET ||= 'v2121-t10-secret';
process.env[EVENT_LOG_FLAG] = 'on';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
const NOW = new Date();
const DAY = 86_400_000;
const noCheck = { check: async () => true };

async function profile(): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v2121-t10-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`t10-${id}`})`;
  return id;
}
/** A person with a page (X claimed). */
async function claimed(handle: string): Promise<number> {
  const id = await profile();
  const r = await bindX(id, { id: `t10${randomBytes(6).toString('hex')}`, username: `${handle}${randomBytes(2).toString('hex')}`, name: handle, avatar: null }, NOW);
  assert.equal(r.ok, true);
  return id;
}
/**
 * A shipped project with `people` people using it and a confirmed repo for it (fix round 1, ruling 3:
 * a coin is offered only when its yes can launch); `repo_url: null`: no repo.
 */
const repoFor = (key: string) => `https://github.com/${key.includes('/') ? key : `lee/${key}`}`;
async function usedProject(id: number, key: string, name: string, people: number, o: { repo_url?: string | null } = {}) {
  await sql()`
    INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people, last_active_at)
    VALUES (${id}, ${key}, ${name}, 'app', true, true, ${people}, now())`;
  o = { repo_url: repoFor(key), ...o };
  if (o.repo_url)
    await sql()`
      INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at)
      VALUES (${id}, 'repo', ${o.repo_url.replace(/^https:\/\/github\.com\//, '')}, ${key}, 'repo_owner', 'verified', 'server', now())`;
}

test('10.4 a program entry\'s confirm never pitches a token; the build path and coin entries do', dbTest, async () => {
  const id = await claimed('pitch_dev');
  assert.equal(await coinPitchAllowed(id, { program_id: 'arc-microgrants', build: false }), false);
  assert.equal(await coinPitchAllowed(id, { program_id: 'arc-microgrants', build: true }), true);
  // Fix round 2: a coin entry is only ever checked by its project_id (an accepted offer names it).
  assert.equal(await coinPitchAllowed(id, { program_id: 'earnkit-coin', build: false }), false);
});

test('10.4b the build entry\'s moment is recorded once and stays open through its confirm; declined, it is gone; a held person never', dbTest, async () => {
  const id = await claimed('build_dev');
  const entry = { program_id: 'arc-microgrants', build: true, project_key: 'lee/podtips' };
  assert.equal(await coinPitchAllowed(id, entry), true);
  await showBuiltLive(id, 'lee/podtips', null);
  assert.equal(await coinPitchAllowed(id, entry), true, 'the confirm after the live reply still pitches it');
  const rows = await sql()`SELECT moment, answer FROM coin_moments WHERE builder_id = ${id}`;
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ moment: 'built_live', answer: null }]);
  const { builtLiveAnswer } = await import('./coin-moments');
  await builtLiveAnswer(id, 'lee/podtips', 'no');
  assert.equal(await coinPitchAllowed(id, entry), false);
  const held = await claimed('build_held');
  await sql()`UPDATE builder_profiles SET held = true WHERE builder_id = ${held}`;
  assert.equal(await coinPitchAllowed(held, entry), false);
});

/** A fake token flow: the gate passes (the line is the repo's), the deploy records what tokens.ts would. */
function tokenDeps(id: number, repo: string) {
  const calls = { deploy: 0, wallets: [] as string[] };
  const deps = {
    available: () => true,
    limit: async () => {},
    check: async () => true,
    gate: {
      repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
      owner: async () => ({ status: 'ok' as const, text: tokenLineFor(id, repo)! }),
      screen: async () => {},
    },
    deploy: async (d: { projectId: number; name: string; symbol: string; creatorWallet: string }) => {
      calls.deploy++;
      calls.wallets.push(d.creatorWallet);
      const url = `https://tokens.fun/coin/0x${randomBytes(20).toString('hex')}`;
      await sql()`UPDATE projects SET token_url = ${url}, token_status = 'launched', coin_launched_at = now(), token_name = ${d.name}, token_symbol = ${d.symbol} WHERE id = ${d.projectId}`;
      return { status: 'launched' as const, name: d.name, symbol: d.symbol, tokens_fun: url };
    },
  } as unknown as TokenFlowDeps;
  return { calls, deps };
}

async function mcpClient(installationId: number) {
  const { createMcpServer } = await import('./mcp');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const server = createMcpServer({ installationId });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't10', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const textOf = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content[0]).text) as Record<string, unknown>;

/** A person as Task 4's rescore leaves them (refreshed just now), with their projects. */
async function person(projects: { key: string; name: string; people: number }[], seen: Record<string, unknown> = {}): Promise<number> {
  const id = await profile();
  await sql()`UPDATE builder_profiles SET standing_seen = ${sql().json(seen as never)} WHERE builder_id = ${id}`;
  await sql()`
    INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at, read_at)
    VALUES (${id}, 0, '{}'::jsonb, false, ${projects.length}, 0, 'v2', 'v2-launch', now(), now())`;
  for (const p of projects) await usedProject(id, p.key, p.name, p.people);
  return id;
}
const offline = new Proxy({}, { get: (_t, k) => (k === 'now' ? NOW : async () => { throw new Error('offline'); }) });
type Found = { show_to_builder: string; move_up?: { kind: string; project_key: string | null; agent_note: string } };
const find = (id: number) => tools.find({}, { installationId: id, readerDeps: offline } as never) as Promise<Found>;

test('10.11 COIN_NOTE is plain for the agent and names the tell field', () => {
  assert.match(COIN_NOTE, /tell with coin: \{ project_key, answer: 'yes' \}/);
  assert.doesNotMatch(COIN_NOTE, /—/);
});

// ---- Fix round 1 -------------------------------------------------------------------------------

test('F3 a coin is offered only when its yes can launch: no confirmed repo, no offer', dbTest, async () => {
  const id = await claimed('f3_dev');
  await usedProject(id, 'norepo', 'No Repo', 9, { repo_url: null });
  assert.equal(await offerCoin(id, 'norepo', 'has_people'), null);
  const p = await person([]);
  await usedProject(p, 'site-only', 'Site', 9, { repo_url: null });
  await sql()`UPDATE builder_live SET shipped = 1 WHERE builder_id = ${p}`;
  assert.doesNotMatch((await find(p)).show_to_builder, /launch a coin/);
});

test('F4 two skips of the older confirm-line offer for the repo count: no coin offered', dbTest, async () => {
  const id = await claimed('f4_dev');
  await usedProject(id, 'lee/f4', 'F4', 9);
  await recordDecline(id, 'lee/f4', new Date(), { login: '', offer: 'p1' });
  await recordDecline(id, 'lee/f4', new Date(), { login: '', offer: 'p2' });
  assert.equal(await coinAllowed(id, 'lee/f4'), false);
  assert.equal(await offerCoin(id, 'lee/f4', 'has_people'), null);
});

test('F5 the build moment is recorded only when its line is shown (a pitch check records nothing)', dbTest, async () => {
  const id = await claimed('f5_dev');
  const entry = { program_id: 'arc-microgrants', build: true, project_key: 'lee/f5' };
  assert.equal(await coinPitchAllowed(id, entry), true);
  assert.equal((await sql()`SELECT 1 FROM coin_moments WHERE builder_id = ${id}`).length, 0);
  await showBuiltLive(id, 'lee/f5', '0x' + 'a'.repeat(40));
  const [m] = await sql()`SELECT moment, wallet FROM coin_moments WHERE builder_id = ${id}`;
  assert.deepEqual({ ...m }, { moment: 'built_live', wallet: '0x' + 'a'.repeat(40) });
  assert.equal(await coinPitchAllowed(id, entry), true);
});

// ---- Fix round 2 -------------------------------------------------------------------------------

async function coinSetup(tag: string) {
  const id = await claimed(tag);
  const repo = `https://github.com/lee/${tag}${randomBytes(3).toString('hex')}`;
  const key = repo.replace('https://github.com/', '');
  await usedProject(id, key, 'Tip Jar', 9, { repo_url: repo });
  // person_wallets.wallet is unique across people: a fresh one per run.
  const W = '0xaaaa' + randomBytes(16).toString('hex') + 'aaaa';
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${W}, ${id})`;
  const t = tokenDeps(id, repo);
  const ctx = { installationId: id, tokenDeps: t.deps } as never;
  assert.ok(await offerCoin(id, key, 'has_people'));
  type Yes = { show_to_builder: string; project_id?: number; token?: { name: string; symbol: string }; wallet?: string; agent_note?: string };
  const yes = (wallet?: string) => tools.tell({ coin: { project_key: key, answer: 'yes', ...(wallet && { wallet }) } }, ctx) as Promise<Yes>;
  return { id, repo, key, W, ctx, calls: t.calls, yes };
}

test('9.7 every coin moment but built_live says the raise line', () => {
  // Final fix: the raise line is EARNKIT_RAISING's (v213-final-fix F10: off keeps the v2.12.1 line).
  process.env.EARNKIT_RAISING = 'on';
  const coin = { name: 'Recipe planner', symbol: 'RECIPE' };
  try {
    for (const m of ['countable', 'first_five', 'has_people', 'streak_five'] as const)
      assert.equal(coinLine(m, 'Recipe planner', null, coin), raiseLine('Recipe planner', 'RECIPE', null));
    assert.match(coinLine('built_live', 'Recipe planner', null, coin), /^It's live\b/);
  } finally {
    delete process.env.EARNKIT_RAISING;
  }
});

test('9.7b five weeks in a row is a coin moment (once); the yes sets raising_at and logs raising_on', dbTest, async () => {
  const id = await claimed('streak_dev');
  const key = `lee/streak${randomBytes(3).toString('hex')}`;
  await usedProject(id, key, 'Tip Jar', 0);
  // v2.13.3 review (I1): a community round only for a repo read public.
  const markPublic = () => sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${id} AND kind = 'repo'`;
  await markPublic();
  process.env.EARNKIT_RAISING = 'on';
  try {
    const { coinAskBench } = await import('./bench-find');
    const p = { key, name: 'Tip Jar', confirmed: true, live: true, weeks: 5, people: 0, has_coin: false, streak: 5, shipped: true };
    // v2.13.3 owner ruling A: four weeks and no people is no moment, but nothing fits, so a community round (countable), once.
    const other = `lee/four${randomBytes(3).toString('hex')}`;
    await usedProject(id, other, 'Four Weeks', 0);
    await markPublic();
    const four = await coinAskBench(id, { ...p, key: other, name: 'Four Weeks', streak: 4 }, {}, noCheck);
    assert.equal(four?.kind, 'coin');
    assert.match(four?.line ?? '', /Want to open a community round for Four Weeks\?$/);
    const [c] = await sql()<{ moment: string }[]>`SELECT moment FROM coin_moments WHERE builder_id = ${id} AND project_key = ${other}`;
    assert.equal(c.moment, 'countable');
    const ask = await coinAskBench(id, p, {}, noCheck);
    assert.equal(ask?.kind, 'coin');
    const [m] = await sql()<{ moment: string }[]>`SELECT moment FROM coin_moments WHERE builder_id = ${id} AND project_key = ${key}`;
    assert.equal(m.moment, 'streak_five');
    const shown = await readShownOffer(id, COIN_PROGRAM, offerKey(repoFor(key), 'Tip Jar'));
    assert.equal(ask?.line, raiseLine('Tip Jar', shown!.symbol, null));
    assert.equal(await coinAskBench(id, p, {}, noCheck), null, 'once per project');
    const yes = await coinYes(id, key, `0x${'d'.repeat(40)}`, noCheck);
    assert.ok('project_id' in yes, JSON.stringify(yes));
    const [x] = await sql()<{ raising: boolean }[]>`SELECT raising_at IS NOT NULL AS raising FROM projects WHERE id = ${yes.project_id}`;
    assert.equal(x.raising, true);
    assert.equal((await sql()`SELECT 1 FROM builder_events WHERE installation_id = ${id} AND type = 'raising_on'`).length, 1);
  } finally {
    delete process.env.EARNKIT_RAISING;
  }
});
