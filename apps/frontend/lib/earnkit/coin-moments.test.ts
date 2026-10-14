import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { bindX } from './claim';
import { EVENT_LOG_FLAG } from './events';
import { COIN_NOTE, COIN_PROGRAM, coinAllowed, coinLine, coinNo, coinPitchAllowed, coinYes, offerCoin } from './coin-moments';
import { offerKey, readShownOffer } from './token-offers';
import { tokenLineFor } from './token-gate';
import { entriesLine, enteredIds } from './present';
import { openEntries } from './projects';
import { outcomeToAsk } from './outcomes';
import { tools } from './tools';
import type { TokenFlowDeps } from './token-launch';

/**
 * v2.12.1 T10 (spec 3b): the coin is offered as the reply's one yes only at its moments, at most
 * once per project, never after two declines, the wallet shown before the yes, never to a shared
 * client or a held profile; the yes makes a coin entry that confirm launches. DB-gated; no network.
 */

process.env.EARNKIT_BUILDER_SCORE = 'on';
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
/** A shipped project with `people` people using it (with repo_url: a confirmed repo for it). */
async function usedProject(id: number, key: string, name: string, people: number, o: { repo_url?: string } = {}) {
  await sql()`
    INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people, last_active_at)
    VALUES (${id}, ${key}, ${name}, 'app', true, true, ${people}, now())`;
  if (o.repo_url)
    await sql()`
      INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at)
      VALUES (${id}, 'repo', ${o.repo_url.replace(/^https:\/\/github\.com\//, '')}, ${key}, 'repo_owner', 'verified', 'server', now())`;
}

test('10.1 a coin is offered at most once per project, never after two declines, never held or shared', dbTest, async () => {
  const id = await claimed('coin_dev');
  await usedProject(id, 'a', 'tokens.fun', 7);
  await usedProject(id, 'b', 'Notes', 3);
  await usedProject(id, 'c', 'Shop', 2);
  assert.ok(await offerCoin(id, 'a', 'has_people'));
  assert.equal(await offerCoin(id, 'a', 'first_five'), null);
  await coinNo(id, 'a');
  assert.ok(await offerCoin(id, 'b', 'has_people'));
  await coinNo(id, 'b');
  assert.equal(await offerCoin(id, 'c', 'has_people'), null);
  const held = await claimed('held_dev');
  await usedProject(held, 'a', 'App', 5);
  await sql()`UPDATE builder_profiles SET held = true WHERE builder_id = ${held}`;
  assert.equal(await offerCoin(held, 'a', 'has_people'), null);
  // A shared client never sees it.
  const shared = await profile();
  await sql()`UPDATE installations SET shared_client = true WHERE id = ${shared}`;
  await usedProject(shared, 'a', 'App', 5);
  assert.equal(await coinAllowed(shared, 'a'), false);
  // A project with a coin already: none.
  const coined = await profile();
  await usedProject(coined, 'a', 'App', 5);
  await sql()`UPDATE builder_projects SET has_coin = true WHERE builder_id = ${coined}`;
  assert.equal(await offerCoin(coined, 'a', 'has_people'), null);
});

test('10.2 the wallet is shown before the yes', dbTest, async () => {
  const id = await claimed('coin_w');
  await usedProject(id, 'a', 'tokens.fun', 7);
  await sql()`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${id}, ${'0xabcd' + '0'.repeat(32) + '1234'})`;
  assert.equal((await offerCoin(id, 'a', 'has_people'))!.line,
    "tokens.fun has people using it. Want to launch a coin for it? You'd get 40% of its trading fees, paid to 0xabcd…1234.");
  // No wallet known: the line asks for one in the same sentence; the copy for every moment.
  assert.equal(coinLine('built_live', 'PodTips', null), "It's live. Want to launch a coin for it? You'd get 40% of its trading fees. Send me the wallet they should go to.");
  assert.equal(coinLine('countable', 'PodTips', null), "Want to launch a coin for PodTips? You'd get 40% of its trading fees. Send me the wallet they should go to.");
  assert.equal(coinLine('first_five', 'PodTips', null), "5 people have used PodTips. Want to launch a coin for it? You'd get 40% of its trading fees. Send me the wallet they should go to.");
  for (const m of ['built_live', 'countable', 'first_five', 'has_people'] as const)
    assert.doesNotMatch(coinLine(m, 'X', '0x' + 'a'.repeat(40)), /—|token|contract|wallet address|onchain|repo/i);
});

test('10.3 a yes makes a coin entry the confirm path launches; nothing else changes', dbTest, async () => {
  const id = await claimed('coin_yes');
  await usedProject(id, 'lee/app', 'App', 7, { repo_url: 'https://github.com/lee/app' });
  await offerCoin(id, 'lee/app', 'has_people');
  const r = await coinYes(id, 'lee/app', '0x' + 'b'.repeat(40), noCheck);
  assert.ok('project_id' in r);
  const [p] = await sql()`SELECT program_id, repo_url FROM projects WHERE id = ${r.project_id}`;
  assert.deepEqual({ ...p }, { program_id: 'earnkit-coin', repo_url: 'https://github.com/lee/app' });
  assert.ok(await readShownOffer(id, 'earnkit-coin', offerKey('https://github.com/lee/app', 'App')));
  // A repeat yes reuses the entry; a yes with no offer made (or after a no) changes nothing.
  const again = await coinYes(id, 'lee/app', '0x' + 'b'.repeat(40), noCheck);
  assert.equal('project_id' in again && again.project_id, r.project_id);
  await usedProject(id, 'lee/b', 'B', 3);
  assert.deepEqual(await coinYes(id, 'lee/b', '0x' + 'b'.repeat(40), noCheck), { show_to_builder: 'Okay.' });
  // No wallet given and none known: the builder is asked.
  const nw = await claimed('coin_nw');
  await usedProject(nw, 'a', 'A', 3);
  await offerCoin(nw, 'a', 'has_people');
  assert.deepEqual(await coinYes(nw, 'a', null, noCheck), { show_to_builder: 'Send me the wallet the fees should go to.' });
});

test('10.4 with the flag on, a program entry\'s confirm never pitches a token; the build path and coin entries do', dbTest, async () => {
  const id = await claimed('pitch_dev');
  assert.equal(await coinPitchAllowed(id, { program_id: 'arc-microgrants', build: false }), false);
  assert.equal(await coinPitchAllowed(id, { program_id: 'arc-microgrants', build: true }), true);
  assert.equal(await coinPitchAllowed(id, { program_id: 'earnkit-coin', build: false }), true);
  delete process.env.EARNKIT_BUILDER_SCORE;
  try {
    assert.equal(await coinPitchAllowed(id, { program_id: 'arc-microgrants', build: false }), true); // v2.11
  } finally {
    process.env.EARNKIT_BUILDER_SCORE = 'on';
  }
});

test('10.4b the build entry\'s moment is recorded once and stays open through its confirm; declined, it is gone; a held person never', dbTest, async () => {
  const id = await claimed('build_dev');
  const entry = { program_id: 'arc-microgrants', build: true, project_key: 'lee/podtips' };
  assert.equal(await coinPitchAllowed(id, entry), true);
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

test('10.5 the coin yes works end to end: tell coin, then confirm by project_id launches exactly the pair and wallet saved', dbTest, async () => {
  const id = await claimed('e2e_dev');
  const repo = `https://github.com/lee/e2e${randomBytes(3).toString('hex')}`;
  const key = repo.replace('https://github.com/', '');
  await usedProject(id, key, 'Tip Jar', 9, { repo_url: repo });
  const W = '0x' + 'c'.repeat(40);
  const { calls, deps } = tokenDeps(id, repo);
  const ctx = { installationId: id, tokenDeps: deps, roundPools: async () => new Map(), repoCoins: async () => new Map() } as never;
  assert.ok(await offerCoin(id, key, 'has_people'));
  const yes = (await tools.tell({ coin: { project_key: key, answer: 'yes', wallet: W } }, ctx)) as { project_id: number; token: { name: string; symbol: string }; wallet: string; agent_note: string; show_to_builder: string };
  assert.equal(typeof yes.project_id, 'number');
  assert.equal(yes.wallet, W);
  assert.match(yes.agent_note, /Call confirm with project_id, yes: true, wallet and token exactly as given/);
  const launched = (await tools.confirm({ project_id: yes.project_id, yes: true, wallet: yes.wallet, token: yes.token }, ctx)) as { status: string; tokens_fun?: string };
  assert.equal(launched.status, 'launched', JSON.stringify(launched));
  assert.equal(calls.deploy, 1);
  assert.deepEqual(calls.wallets, [W]);
  const [m] = await sql()`SELECT answer, project_id FROM coin_moments WHERE builder_id = ${id}`;
  assert.deepEqual({ ...m }, { answer: 'yes', project_id: yes.project_id });
  const [p] = await sql()<{ token_status: string; creator_wallet: string }[]>`SELECT token_status, creator_wallet FROM projects WHERE id = ${yes.project_id}`;
  assert.deepEqual({ ...p }, { token_status: 'launched', creator_wallet: W });
  // The old launch_token route by project_id is never held back for a coin entry (no score gate in the way).
  const { handlers } = await import('./tools');
  const again = (await handlers.launch_token({ project_id: yes.project_id, builder_confirmed: true, creator_wallet: W }, ctx)) as { status: string; note?: string };
  assert.notEqual(again.note, 'No token for this entry.');
});

test('10.5b move_up with kind coin reaches the coin yes and no (never "not available yet")', dbTest, async () => {
  const id = await claimed('mu_dev');
  await usedProject(id, 'lee/mu', 'Mu', 4, { repo_url: 'https://github.com/lee/mu' });
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${'0x' + randomBytes(20).toString('hex')}, ${id})`;
  assert.ok(await offerCoin(id, 'lee/mu', 'has_people'));
  const ctx = { installationId: id, tokenDeps: { check: async () => true } } as never;
  const yes = (await tools.tell({ move_up: { kind: 'coin', project_key: 'lee/mu', answer: 'yes' } }, ctx)) as { project_id?: number; agent_note?: string };
  assert.equal(typeof yes.project_id, 'number', JSON.stringify(yes));
  assert.doesNotMatch(String(yes.agent_note), /not available yet/);
  const other = await claimed('mu_no');
  await usedProject(other, 'k', 'K', 4);
  await offerCoin(other, 'k', 'has_people');
  const no = (await tools.tell({ move_up: { kind: 'coin', project_key: 'k', answer: 'no' } }, { installationId: other } as never)) as { show_to_builder: string };
  assert.equal(no.show_to_builder, 'Okay.');
  const [m] = await sql()`SELECT answer FROM coin_moments WHERE builder_id = ${other}`;
  assert.equal(m.answer, 'no');
  const [d] = await sql()<{ count: number }[]>`SELECT count FROM token_declines WHERE installation_id = ${other}`;
  assert.equal(d.count, 1, 'counted as the confirm line\'s skip is');
  // A shared client: nothing.
  const shared = await profile();
  await sql()`UPDATE installations SET shared_client = true WHERE id = ${shared}`;
  const s = (await tools.tell({ coin: { project_key: 'k', answer: 'yes' } }, { installationId: shared, sharedClient: true } as never)) as { show_to_builder: string };
  assert.equal(s.show_to_builder, '');
});

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

test('10.6 tell coin reaches the coin answer through the MCP schema; flag off does not list it', dbTest, async () => {
  const id = await claimed('mcp_coin');
  await usedProject(id, 'k', 'K', 4);
  await offerCoin(id, 'k', 'has_people');
  const client = await mcpClient(id);
  try {
    const { tools: listed } = await client.listTools();
    const tell = listed.find((t) => t.name === 'tell')!;
    assert.ok('coin' in (tell.inputSchema.properties as Record<string, unknown>));
    assert.ok(tell.description!.length < 800, String(tell.description!.length));
    const r = textOf(await client.callTool({ name: 'tell', arguments: { coin: { project_key: 'k', answer: 'no' } } }));
    assert.equal(r.show_to_builder, 'Okay.');
  } finally {
    await client.close();
  }
  const [m] = await sql()`SELECT answer FROM coin_moments WHERE builder_id = ${id}`;
  assert.equal(m.answer, 'no', 'the answer arrived (stripped, nothing would change)');
  delete process.env.EARNKIT_BUILDER_SCORE;
  try {
    const off = await mcpClient(id);
    const { tools: listed } = await off.listTools();
    await off.close();
    assert.ok(!('coin' in (listed.find((t) => t.name === 'tell')!.inputSchema.properties as Record<string, unknown>)));
  } finally {
    process.env.EARNKIT_BUILDER_SCORE = 'on';
  }
});

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

test('10.7 find: a project with people and no bigger step gets the coin as the one yes, once; the wallet is in the line', dbTest, async () => {
  const id = await person([{ key: 'lee/notes', name: 'Notes', people: 7 }]);
  const W = '0x' + randomBytes(20).toString('hex');
  await sql()`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${id}, ${W})`;
  const r = await find(id);
  assert.ok(r.show_to_builder.endsWith(`How to move up\nNotes has people using it. Want to launch a coin for it? You'd get 40% of its trading fees, paid to ${W.slice(0, 6)}…${W.slice(-4)}.`), r.show_to_builder);
  assert.equal(r.move_up?.kind, 'coin');
  assert.equal(r.move_up?.project_key, 'lee/notes');
  assert.match(r.move_up!.agent_note, /tell with coin/);
  assert.ok((r.show_to_builder.match(/\?/g) ?? []).length <= 1);
  // At most once per project: the next find never offers it again.
  const two = await find(id);
  assert.doesNotMatch(two.show_to_builder, /coin/);
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events WHERE type = 'coin_offered' AND installation_id = ${id}`;
  assert.equal(n, 1);
});

test('10.8 find: the reply that reports a project\'s first 5 people offers the coin in place of the step, and the news asks no card', dbTest, async () => {
  const seen = { people: { 'lee/five': 2 }, at: new Date(NOW.getTime() - 3 * DAY).toISOString() };
  const id = await person([{ key: 'lee/five', name: 'Five', people: 6 }], seen);
  const r = await find(id);
  assert.ok(r.show_to_builder.startsWith('Since you last checked: 4 new people used Five this week.\n\n'), r.show_to_builder);
  assert.ok(r.show_to_builder.endsWith("How to move up\n5 people have used Five. Want to launch a coin for it? You'd get 40% of its trading fees. Send me the wallet they should go to."), r.show_to_builder);
  const [m] = await sql()`SELECT moment FROM coin_moments WHERE builder_id = ${id}`;
  assert.equal(m.moment, 'first_five');
  // Without the launch key (production before tokens are on): no coin anywhere, the v2.12.1 step as before.
  const key = process.env.TOKENSFUN_DEPLOY_API_KEY;
  delete process.env.TOKENSFUN_DEPLOY_API_KEY;
  try {
    const plain = await person([{ key: 'lee/p', name: 'P', people: 6 }], seen);
    assert.doesNotMatch((await find(plain)).show_to_builder, /coin/);
  } finally {
    process.env.TOKENSFUN_DEPLOY_API_KEY = key;
  }
});

test('10.9 a coin entry never shows in "Your entries", the entered programs or an outcome question', dbTest, async () => {
  const id = await claimed('filter_dev');
  await usedProject(id, 'lee/f', 'F', 4, { repo_url: 'https://github.com/lee/f' });
  await offerCoin(id, 'lee/f', 'has_people');
  const r = await coinYes(id, 'lee/f', '0x' + 'd'.repeat(40), noCheck);
  assert.ok('project_id' in r);
  assert.deepEqual(await openEntries(id), []);
  const entries = [{ id: r.project_id, program_id: COIN_PROGRAM, title: 'Your coin', name: 'F', ends_at: null, submitted: false }];
  assert.equal(entriesLine({ entries, cards: [] }), null);
  assert.equal(enteredIds({ entries }).has(COIN_PROGRAM), false);
  assert.equal(await outcomeToAsk(id), null);
});

test('10.10 flag off: no coin is ever offered, and tell coin changes nothing (v2.11)', dbTest, async () => {
  const id = await claimed('off_dev');
  await usedProject(id, 'k', 'K', 9);
  delete process.env.EARNKIT_BUILDER_SCORE;
  try {
    assert.equal(await coinAllowed(id, 'k'), false);
    assert.equal(await offerCoin(id, 'k', 'has_people'), null);
    // Ignored, as move_up is with the flag off (the MCP schema doesn't list it, so no agent sends it).
    await assert.rejects(tools.tell({ coin: { project_key: 'k', answer: 'yes' } }, { installationId: id } as never), /Pass at least one/);
  } finally {
    process.env.EARNKIT_BUILDER_SCORE = 'on';
  }
  assert.equal((await sql()`SELECT 1 FROM coin_moments WHERE builder_id = ${id}`).length, 0);
});

test('10.11 COIN_NOTE is plain for the agent and names the tell field', () => {
  assert.match(COIN_NOTE, /tell with coin: \{ project_key, answer: 'yes' \}/);
  assert.doesNotMatch(COIN_NOTE, /—/);
});
