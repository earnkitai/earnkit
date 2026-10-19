import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { bindX } from './claim';
import { EVENT_LOG_FLAG } from './events';
import { COIN_NOTE, COIN_PROGRAM, coinAllowed, coinLine, coinNo, coinPitchAllowed, coinYes, offerCoin, raiseLine, showBuiltLive } from './coin-moments';
import { offerKey, readShownOffer, recordDecline } from './token-offers';
import { proposeToken } from './token-proposal';
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
 * a coin is offered only when its yes can launch), read public (v2.13.3 I1); `repo_url: null`: no repo.
 */
const repoFor = (key: string) => `https://github.com/${key.includes('/') ? key : `lee/${key}`}`;
async function usedProject(id: number, key: string, name: string, people: number, o: { repo_url?: string | null } = {}) {
  await sql()`
    INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people, last_active_at)
    VALUES (${id}, ${key}, ${name}, 'app', true, true, ${people}, now())`;
  o = { repo_url: repoFor(key), ...o };
  if (o.repo_url)
    await sql()`
      INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at, public_at)
      VALUES (${id}, 'repo', ${o.repo_url.replace(/^https:\/\/github\.com\//, '')}, ${key}, 'repo_owner', 'verified', 'server', now(), now())`;
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

/** A fake token flow: the gate passes (the App proved the repo), the deploy records what tokens.ts would. */
function tokenDeps(id: number, repo: string) {
  const calls = { deploy: 0, wallets: [] as string[] };
  const deps = {
    available: () => true,
    limit: async () => {},
    check: async () => true,
    gate: {
      repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
      // v2.14 spec 2: the read-only App proved the coin's repo.
      appProven: async () => true,
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
  // The Bench: the first project is the one project, and the page is claimed with X.
  await sql()`UPDATE builder_profiles SET standing_seen = ${sql().json(seen as never)}, main_project_key = ${projects[0]?.key ?? null},
    x_user_id = ${`x${id}`}, x_handle = ${`cm${id}`} WHERE builder_id = ${id}`;
  await sql()`
    INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at, read_at)
    VALUES (${id}, 0, '{}'::jsonb, false, ${projects.length}, 0, 'v2', 'v2-launch', now(), now())`;
  for (const p of projects) await usedProject(id, p.key, p.name, p.people);
  return id;
}
const offline = new Proxy({}, { get: (_t, k) => (k === 'now' ? NOW : async () => { throw new Error('offline'); }) });
type Found = { show_to_builder: string; move_up?: { kind: string; project_key: string | null; agent_note: string } };
const find = (id: number) => tools.find({}, { installationId: id, readerDeps: offline } as never) as Promise<Found>;

// ---- Restored for the Bench (v2.14 T3 fix round 1): the live coin path's safety rules ---------

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
  const pair = await proposeToken('tokens.fun', async () => null, repoFor('a'));
  // Fix round 1 (ruling 5, v2.8.1 A2): the line names the coin that launches, before the yes.
  assert.equal((await offerCoin(id, 'a', 'has_people'))!.line,
    `tokens.fun has people using it. A coin pays you 40% of its trading fees, paid to 0xabcd…1234. Want to launch a coin, $${pair.symbol} (${pair.name}), for it?`);
  const tip = { name: 'PodTips', symbol: 'PODTIP' };
  // No wallet known (final fix wave): the line asks only the yes; the wallet is asked in the next
  // reply (coinYes: COIN_WALLET_ASK). A known wallet is shown as a statement.
  // Fix round 1 (ruling 6): the build path's no still enters, and the line says so (one question).
  assert.equal(coinLine('built_live', 'PodTips', null, tip), "It's live, and your entry is ready either way. A coin pays you 40% of its trading fees. Want to launch a coin, $PODTIP (PodTips), for it?");
  assert.equal(coinLine('countable', 'PodTips', null, tip), 'A coin pays you 40% of its trading fees. Want to launch a coin, $PODTIP (PodTips), for PodTips?');
  assert.equal(coinLine('first_five', 'PodTips', null, tip), '5 people have used PodTips. A coin pays you 40% of its trading fees. Want to launch a coin, $PODTIP (PodTips), for it?');
  for (const m of ['built_live', 'countable', 'first_five', 'has_people'] as const) {
    assert.doesNotMatch(coinLine(m, 'X', '0x' + 'a'.repeat(40), tip), /—|token|contract|wallet address|onchain|repo/i);
    for (const w of [null, '0x' + 'a'.repeat(40)]) {
      const line = coinLine(m, 'X', w, tip);
      assert.equal((line.match(/\?/g) ?? []).length, 1);
      assert.doesNotMatch(line, /send me|tell me|which wallet|what wallet/i, 'one ask: the yes, never a wallet too');
    }
  }
});

test('10.3 a yes makes a coin entry the confirm path launches; nothing else changes', dbTest, async () => {
  const id = await claimed('coin_yes');
  await usedProject(id, 'lee/app', 'App', 7, { repo_url: 'https://github.com/lee/app' });
  await offerCoin(id, 'lee/app', 'has_people');
  const shown = await readShownOffer(id, 'earnkit-coin', offerKey('https://github.com/lee/app', 'App'));
  const r = await coinYes(id, 'lee/app', '0x' + 'b'.repeat(40), noCheck);
  assert.ok('project_id' in r, JSON.stringify(r));
  // The pair the line named is the one that launches.
  assert.deepEqual(r.token, { name: shown!.name, symbol: shown!.symbol });
  const [p] = await sql()`SELECT program_id, repo_url FROM projects WHERE id = ${r.project_id}`;
  assert.deepEqual({ ...p }, { program_id: 'earnkit-coin', repo_url: 'https://github.com/lee/app' });
  assert.ok(await readShownOffer(id, 'earnkit-coin', offerKey('https://github.com/lee/app', 'App')));
  // A repeat yes reuses the entry; a yes with no offer made (or after a no) changes nothing.
  const again = await coinYes(id, 'lee/app', '0x' + 'b'.repeat(40), noCheck);
  assert.equal('project_id' in again && again.project_id, r.project_id);
  await usedProject(id, 'lee/b', 'B', 3);
  assert.deepEqual(await coinYes(id, 'lee/b', '0x' + 'b'.repeat(40), noCheck), { show_to_builder: 'Okay.' });
  // No wallet given and none known: the line asked only the yes; the yes's reply asks the wallet,
  // and the wallet the builder sends next is the answer (it launches to that one).
  const nw = await claimed('coin_nw');
  await usedProject(nw, 'a', 'A', 3, { repo_url: 'https://github.com/lee/a' });
  const offered = await offerCoin(nw, 'a', 'has_people');
  assert.ok(offered && !/wallet/i.test(offered.line), offered?.line);
  assert.deepEqual(await coinYes(nw, 'a', null, noCheck), { show_to_builder: 'Send me the wallet the fees should go to.' });
  const sent = await coinYes(nw, 'a', '0x' + 'c'.repeat(40), noCheck);
  assert.ok('project_id' in sent && sent.wallet === '0x' + 'c'.repeat(40), JSON.stringify(sent));
});

test('10.5 the coin yes works end to end: tell coin, then confirm by project_id launches exactly the pair and wallet saved', dbTest, async () => {
  const id = await claimed('e2e_dev');
  const repo = `https://github.com/lee/e2e${randomBytes(3).toString('hex')}`;
  const key = repo.replace('https://github.com/', '');
  await usedProject(id, key, 'Tip Jar', 9, { repo_url: repo });
  const W = '0x' + 'c'.repeat(40);
  const { calls, deps } = tokenDeps(id, repo);
  const ctx = { installationId: id, tokenDeps: deps } as never;
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

test('10.6 tell coin reaches the coin answer through the MCP schema', dbTest, async () => {
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
});

test('10.7 find: a project with people and no bigger step gets the coin as the one yes, once; the wallet is in the line', dbTest, async () => {
  const id = await person([{ key: 'lee/notes', name: 'Notes', people: 7 }]);
  const W = '0x' + randomBytes(20).toString('hex');
  await sql()`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${id}, ${W})`;
  const r = await find(id);
  assert.match(r.show_to_builder, new RegExp(`How to move up\\nNotes has people using it\\. A coin pays you 40% of its trading fees, paid to ${W.slice(0, 6)}…${W.slice(-4)}\\. Want to launch a coin, \\$[A-Z0-9]+ \\([^)]+\\), for it\\?$`), r.show_to_builder);
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
  assert.match(r.show_to_builder, /How to move up\n5 people have used Five\. A coin pays you 40% of its trading fees\. Want to launch a coin, \$[A-Z0-9]+ \([^)]+\), for it\?$/, r.show_to_builder);
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

test('F1 (critical) a yes naming another wallet than the one shown launches nothing: the line is shown again with it; the next yes launches to it', dbTest, async () => {
  const id = await claimed('f1_dev');
  const repo = `https://github.com/lee/f1${randomBytes(3).toString('hex')}`;
  const key = repo.replace('https://github.com/', '');
  await usedProject(id, key, 'Tip Jar', 9, { repo_url: repo });
  const W = '0xaaaa' + randomBytes(16).toString('hex') + 'aaaa';
  const W2 = '0x' + 'e'.repeat(40);
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${W}, ${id})`;
  const { calls, deps } = tokenDeps(id, repo);
  const ctx = { installationId: id, tokenDeps: deps } as never;
  const offer = await offerCoin(id, key, 'has_people');
  assert.match(offer!.line, /paid to 0xaaaa…aaaa\. Want to launch a coin, \$[A-Z0-9]+ \([^)]+\), for it\?$/);
  const first = (await tools.tell({ coin: { project_key: key, answer: 'yes', wallet: W2 } }, ctx)) as { show_to_builder: string; project_id?: number; agent_note?: string };
  assert.equal(first.project_id, undefined, 'no entry, nothing to launch');
  assert.match(first.show_to_builder, /A coin pays you 40% of its trading fees, paid to 0xeeee…eeee\. Want to launch a coin, \$[A-Z0-9]+ \([^)]+\), for it\?$/);
  assert.match(String(first.agent_note), /tell with coin/);
  assert.equal((await sql()`SELECT 1 FROM projects WHERE installation_id = ${id}`).length, 0);
  const yes = (await tools.tell({ coin: { project_key: key, answer: 'yes', wallet: W2 } }, ctx)) as { project_id: number; token: { name: string; symbol: string }; wallet: string };
  assert.equal(yes.wallet, W2);
  const launched = (await tools.confirm({ project_id: yes.project_id, yes: true, wallet: yes.wallet, token: yes.token }, ctx)) as { status: string };
  assert.equal(launched.status, 'launched');
  assert.deepEqual(calls.wallets, [W2]);
  // The agent passing the first wallet now (not the one shown last) launches nothing more.
  assert.equal(calls.deploy, 1);
});

test('F2 a coin entry is refused once the person is held (confirm by project_id and the old launch route)', dbTest, async () => {
  const id = await claimed('f2_dev');
  const repo = `https://github.com/lee/f2${randomBytes(3).toString('hex')}`;
  const key = repo.replace('https://github.com/', '');
  await usedProject(id, key, 'Tip Jar', 9, { repo_url: repo });
  const W = '0x' + 'c'.repeat(40);
  const { calls, deps } = tokenDeps(id, repo);
  const ctx = { installationId: id, tokenDeps: deps } as never;
  await offerCoin(id, key, 'has_people');
  const yes = (await tools.tell({ coin: { project_key: key, answer: 'yes', wallet: W } }, ctx)) as { project_id: number; token: { name: string; symbol: string }; wallet: string };
  await sql()`UPDATE builder_profiles SET held = true WHERE builder_id = ${id}`;
  const r = (await tools.confirm({ project_id: yes.project_id, yes: true, wallet: W, token: yes.token }, ctx)) as { status: string };
  assert.equal(r.status, 'skipped');
  const { handlers } = await import('./tools');
  const old = (await handlers.launch_token({ project_id: yes.project_id, builder_confirmed: true, creator_wallet: W }, ctx)) as { status: string };
  assert.equal(old.status, 'skipped');
  assert.equal(calls.deploy, 0);
  assert.equal(await coinPitchAllowed(id, { program_id: COIN_PROGRAM, build: false, project_id: yes.project_id }), false);
  await sql()`UPDATE builder_profiles SET held = false WHERE builder_id = ${id}`;
  assert.equal(await coinPitchAllowed(id, { program_id: COIN_PROGRAM, build: false, project_id: yes.project_id }), true);
  // An entry of the coin program no accepted offer names: refused.
  assert.equal(await coinPitchAllowed(id, { program_id: COIN_PROGRAM, build: false, project_id: 2_000_000_000 }), false);
});

async function coinSetup(tag: string) {
  const id = await claimed(tag);
  const repo = `https://github.com/lee/${tag}${randomBytes(3).toString('hex')}`;
  const key = repo.replace('https://github.com/', '');
  await usedProject(id, key, 'Tip Jar', 9, { repo_url: repo });
  // person_wallets.wallet is unique across people: a fresh one per run.
  const W = '0xaaaa' + randomBytes(16).toString('hex') + 'aaaa';
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${W}, ${id})`;
  const t = tokenDeps(id, repo);
  const ctx = { installationId: id, tokenDeps: t.deps, roundPools: async () => new Map(), repoCoins: async () => new Map() } as never;
  assert.ok(await offerCoin(id, key, 'has_people'));
  type Yes = { show_to_builder: string; project_id?: number; token?: { name: string; symbol: string }; wallet?: string; agent_note?: string };
  const yes = (wallet?: string) => tools.tell({ coin: { project_key: key, answer: 'yes', ...(wallet && { wallet }) } }, ctx) as Promise<Yes>;
  return { id, repo, key, W, ctx, calls: t.calls, yes };
}

test('G1 a yes after the coin launched changes nothing: "Your coin is already live."', dbTest, async () => {
  const c = await coinSetup('g1');
  const y = await c.yes();
  await tools.confirm({ project_id: y.project_id, yes: true, wallet: y.wallet, token: y.token }, c.ctx);
  assert.equal(c.calls.deploy, 1);
  const before = await readShownOffer(c.id, COIN_PROGRAM, offerKey(c.repo, 'Tip Jar'));
  const again = await c.yes('0x' + 'e'.repeat(40));
  assert.equal(again.show_to_builder, 'Your coin is already live.');
  assert.equal(again.project_id, undefined);
  assert.deepEqual(await readShownOffer(c.id, COIN_PROGRAM, offerKey(c.repo, 'Tip Jar')), before, 'the offer is never rewritten');
  const [m] = await sql()`SELECT answer, wallet FROM coin_moments WHERE builder_id = ${c.id}`;
  assert.deepEqual({ ...m }, { answer: 'yes', wallet: c.W });
});

test('G2 a new wallet after a yes needs a fresh yes: confirm by project_id launches nothing until then', dbTest, async () => {
  const c = await coinSetup('g2');
  const first = await c.yes();
  assert.equal(typeof first.project_id, 'number');
  const W2 = '0x' + 'e'.repeat(40);
  const reshown = await c.yes(W2);
  assert.equal(reshown.project_id, undefined);
  assert.match(reshown.show_to_builder, /paid to 0xeeee…eeee\. Want to launch a coin, \$[A-Z0-9]+ \([^)]+\), for it\?$/);
  // The agent goes straight to confirm with the new wallet: nothing launches.
  const early = (await tools.confirm({ project_id: first.project_id, yes: true, wallet: W2, token: first.token }, c.ctx)) as { status: string };
  assert.notEqual(early.status, 'launched');
  assert.equal(c.calls.deploy, 0);
  // The builder's yes to the line that showed it: then it launches to W2.
  const yes = await c.yes(W2);
  assert.equal(yes.project_id, first.project_id);
  const launched = (await tools.confirm({ project_id: yes.project_id, yes: true, wallet: yes.wallet, token: yes.token }, c.ctx)) as { status: string };
  assert.equal(launched.status, 'launched');
  assert.deepEqual(c.calls.wallets, [W2]);
});

test('G3 no saved offer at the yes: the line is shown again with a fresh pair, and only the next yes goes on', dbTest, async () => {
  const c = await coinSetup('g3');
  await sql()`DELETE FROM token_offers WHERE installation_id = ${c.id} AND program_id = ${COIN_PROGRAM}`;
  const r = await c.yes();
  assert.equal(r.project_id, undefined);
  assert.match(r.show_to_builder, /A coin pays you 40% of its trading fees, paid to 0xaaaa…aaaa\. Want to launch a coin, \$[A-Z0-9]+ \([^)]+\), for it\?$/);
  assert.equal((await sql()`SELECT 1 FROM projects WHERE installation_id = ${c.id}`).length, 0);
  const shown = await readShownOffer(c.id, COIN_PROGRAM, offerKey(c.repo, 'Tip Jar'));
  assert.ok(shown);
  const yes = await c.yes();
  assert.equal(typeof yes.project_id, 'number');
  assert.deepEqual(yes.token, { name: shown.name, symbol: shown.symbol });
});


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
