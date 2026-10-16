import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { escrowConfig, escrowConfigProblem } from './escrow';
import { FIND_DESCRIPTION, FIND_DESCRIPTION_BENCH, FIND_DESCRIPTION_SCORE, SCORE_DESCRIPTION, TELL_DESCRIPTION, TELL_DESCRIPTION_BENCH, TELL_DESCRIPTION_BENCH_NO_RAISING, TELL_DESCRIPTION_SCORE, OWNERSHIP_FOR_TOKEN, SERVER_INSTRUCTIONS, errorSummary, TOOL_DESCRIPTIONS, createMcpServer, serverInstructions, toolDescriptions, unexpectedErrorText } from './mcp';
import { handlers } from './tools';
import { OLD_TOOL_NAMES, STALE_TOOLS_NOTE, aliasCall, withOlderNames } from './aliases';

/** v2.10.1 B5: a reply object's agent strings in a stale client's words (aliases.ts forOldClient, minus the note). */
const oldWords = (v: unknown, used: string): unknown =>
  typeof v === 'string' ? withOlderNames(v, used) : Array.isArray(v) ? v.map((x) => oldWords(x, used)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /^show_to_|^question$/.test(k) ? x : oldWords(x, used)])) : v;
import { POST } from '../../app/mcp/route';
import { saveInstallation } from './installations';
import { upsertProgram } from './programs';
import { ProgramFile } from './program-file';
import { committedProgram } from './fixtures/program-file';
import { SAFETY_LINES } from './untrusted-text';
import { kitReplyNote, submitKit, type KitProgram } from './submit-kit';
import { awardReply, createReply } from './sponsor-rules';
import { sql } from './db';
import { dropRunPrograms } from './fixtures/programs-cleanup';

// Tool replies read alerts from the database when DATABASE_URL is set: close the pool.
after(async () => {
  // Task 17: this file's programs never outlive the run.
  if (process.env.DATABASE_URL) await dropRunPrograms();
  if (process.env.DATABASE_URL) await sql().end();
});

const FACTORY = '0x00000000000000000000000000000000000000fa';

async function listed(env: Record<string, string | undefined>, opts?: { campaignOpen?: boolean }) {
  const saved = {
    ESCROW_CHAIN: process.env.ESCROW_CHAIN,
    ESCROW_FACTORY_ADDRESS: process.env.ESCROW_FACTORY_ADDRESS,
    ESCROW_LOCAL_TOKEN: process.env.ESCROW_LOCAL_TOKEN,
  };
  for (const k of Object.keys(saved)) delete process.env[k];
  Object.assign(process.env, env);
  const errLog = console.error;
  console.error = () => {}; // partially-configured envs log a line; keep test output clean
  try {
    const server = createMcpServer({ installationId: 1 }, opts);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const { tools } = await client.listTools();
    const instructions = client.getInstructions() ?? '';
    await client.close();
    return { tools, instructions };
  } finally {
    console.error = errLog;
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
}

const toolNames = async (env: Record<string, string | undefined>) =>
  (await listed(env)).tools.map((t) => t.name).sort();

// v2.10 item 4: the 4 builder tools (find, prepare, confirm, tell); the 8 v2.9 names are aliases only.
const FOUR = ['confirm', 'find', 'prepare', 'tell'];
const oldNameRe = new RegExp(`\\b(${OLD_TOOL_NAMES.join('|')})\\b`);

test('9.1 without escrow config the server offers exactly the 4 builder tools; no old name is listed', async () => {
  const { tools } = await listed({});
  assert.deepEqual(tools.map((t) => t.name).sort(), FOUR);
  for (const t of tools) assert.ok(!(OLD_TOOL_NAMES as readonly string[]).includes(t.name), t.name);
});

test('an invalid ESCROW_CHAIN leaves the 4 builder tools', async () => {
  assert.deepEqual(
    await toolNames({
      ESCROW_FACTORY_ADDRESS: FACTORY,
      ESCROW_CHAIN: 'mainnet',
    }),
    FOUR,
  );
});

test('9.1 v2.12: a configured escrow adds nothing (sponsor campaigns are archived); still the 4 builder tools and no old name', async () => {
  assert.deepEqual(await toolNames({ ESCROW_FACTORY_ADDRESS: FACTORY, ESCROW_CHAIN: 'base-sepolia' }), FOUR);
  assert.deepEqual(await toolNames({ ESCROW_FACTORY_ADDRESS: FACTORY }), FOUR);
});

test('4.14 v2.12, 5 v2.12.1: flag off, find is v2.11 (no local_git or identity, the v2.11 description); flag on, it takes identity under 800 characters', async () => {
  const off = (await listed({})).tools.find((t) => t.name === 'find')!;
  assert.ok(!('local_git' in (off.inputSchema.properties ?? {})));
  assert.ok(!('identity' in (off.inputSchema.properties ?? {})));
  assert.equal(off.description, FIND_DESCRIPTION);
  assert.ok(FIND_DESCRIPTION.startsWith('What can I earn? Pass local_repos: repos the builder wrote, from local git remotes. For private repos, report: name, chains, contracts, live link, last_commit_at, my_commits_90d. A yes to the reply prepares lead.program_id; more: true only when they ask for more. build_offer: follow its agent_note. program_id: one program and its guide; repo: whether it fits. '));
  assert.doesNotMatch(FIND_DESCRIPTION, /local_git/);
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  try {
    const on = (await listed({})).tools.find((t) => t.name === 'find')!;
    assert.ok('identity' in (on.inputSchema.properties ?? {}));
    assert.ok(!('local_git' in (on.inputSchema.properties ?? {})));
    assert.equal(on.description, FIND_DESCRIPTION_SCORE);
    assert.ok(FIND_DESCRIPTION_SCORE.length < 800, String(FIND_DESCRIPTION_SCORE.length));
    assert.match(FIND_DESCRIPTION_SCORE, /identity/);
    assert.match(FIND_DESCRIPTION_SCORE, /never ask for it/);
    assert.match(on.description!, /repos the builder wrote/);
  } finally {
    delete process.env.EARNKIT_BUILDER_SCORE;
  }
});

test('7.12 v2.12, v2.12.1 T8: flag off, tell is v2.11 (no profile, card, move_up or x_handle); flag on, it takes profile, card and move_up (no x_handle) under 800 characters', async () => {
  const off = (await listed({})).tools.find((t) => t.name === 'tell')!;
  for (const k of ['profile', 'x_handle', 'card', 'move_up']) assert.ok(!(k in (off.inputSchema.properties ?? {})), k);
  assert.equal(off.description, TELL_DESCRIPTION);
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  try {
    const on = (await listed({})).tools.find((t) => t.name === 'tell')!;
    for (const k of ['profile', 'card', 'move_up']) assert.ok(k in (on.inputSchema.properties ?? {}), k);
    assert.ok(!('x_handle' in (on.inputSchema.properties ?? {})), 'the X claim sets the handle');
    assert.equal(on.description, TELL_DESCRIPTION_SCORE);
    assert.ok(on.description!.length < 800, String(on.description!.length));
    assert.match(on.description!, /profile: "hide" or "show" when they say so\. card: "yes" or "skip" to the card question\. move_up: their answer to the last line/);
    assert.doesNotMatch(on.description!, /x_handle/);
  } finally {
    delete process.env.EARNKIT_BUILDER_SCORE;
  }
});

test('8.6 v2.12: score is listed only with the flag on, its description under 800 characters', async () => {
  assert.deepEqual(await toolNames({}), FOUR);
  assert.doesNotMatch((await listed({})).instructions, /\bscore\b/);
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  try {
    assert.deepEqual(await toolNames({}), [...FOUR, 'score'].sort());
    const { tools, instructions } = await listed({});
    const score = tools.find((t) => t.name === 'score')!;
    assert.equal(score.description, SCORE_DESCRIPTION);
    assert.deepEqual(Object.keys(score.inputSchema.properties ?? {}), []);
    assert.equal(instructions.split('\n')[1], "Call score when they ask how they're doing.");
    assert.ok(instructions.length < 800, String(instructions.length));
    assert.equal(instructions, serverInstructions(false));
    // Fix round 1: with the score on, an open EarnKit campaign adds no sentence (campaigns are archived).
    assert.ok(serverInstructions(true).length <= 800, String(serverInstructions(true).length));
    assert.doesNotMatch(serverInstructions(true), /EarnKit campaign/);
  } finally {
    delete process.env.EARNKIT_BUILDER_SCORE;
  }
  assert.ok(TOOL_DESCRIPTIONS.score.length < 800, String(TOOL_DESCRIPTIONS.score.length));
  assert.doesNotMatch(TOOL_DESCRIPTIONS.score, /—/);
});

test('9.2 the instructions and each of the 4 descriptions: under 800 characters, no old tool name, no em dash', async () => {
  for (const open of [true, false]) {
    const texts: [string, string][] = [
      [`serverInstructions(${open})`, serverInstructions(open)],
      ...Object.entries(toolDescriptions(open)).map(([k, v]): [string, string] => [`${k} (${open})`, v]),
    ];
    for (const [label, text] of texts) {
      assert.ok(text.length < 800, `${label}: ${text.length}`);
      assert.doesNotMatch(text, oldNameRe, label);
      assert.doesNotMatch(text, /—/, label);
    }
  }
  // Pre-flight P21: T4's local_repos sentence and T7's token sentence are carried forward.
  // v2.10.1 fix round 1 (C1): plus the builder's own commit count.
  assert.ok(FIND_DESCRIPTION.includes('For private repos, report: name, chains, contracts, live link, last_commit_at, my_commits_90d.'));
  assert.ok(SERVER_INSTRUCTIONS.includes('Yes submits the entry and launches the token; skip the token submits without one.'));
  // The registered text is the same text.
  const { tools, instructions } = await listed({ ESCROW_FACTORY_ADDRESS: FACTORY });
  assert.equal(instructions, serverInstructions(false));
  for (const t of tools) {
    assert.equal(t.description, toolDescriptions(false)[t.name as keyof ReturnType<typeof toolDescriptions>], t.name);
    assert.doesNotMatch(JSON.stringify(t.inputSchema), oldNameRe, t.name);
  }
});

test('escrow config problems are readable, never a TypeError', () => {
  assert.match(
    escrowConfigProblem({
      ESCROW_FACTORY_ADDRESS: FACTORY,
      ESCROW_CHAIN: 'mainnet',
    }) ?? '',
    /ESCROW_CHAIN must be one of base, base-sepolia, local \(got "mainnet"\)/,
  );
  assert.match(
    escrowConfigProblem({}) ?? '',
    /ESCROW_FACTORY_ADDRESS is not set/,
  );
  assert.match(
    escrowConfigProblem({ ESCROW_FACTORY_ADDRESS: 'nope' }) ?? '',
    /not an address/,
  );
  assert.match(
    escrowConfigProblem({
      ESCROW_FACTORY_ADDRESS: FACTORY,
      ESCROW_CHAIN: 'local',
    }) ?? '',
    /ESCROW_LOCAL_TOKEN/,
  );
  assert.equal(
    escrowConfigProblem({
      ESCROW_FACTORY_ADDRESS: FACTORY,
      ESCROW_CHAIN: 'base',
    }),
    null,
  );
  const saved = process.env.ESCROW_CHAIN;
  process.env.ESCROW_CHAIN = 'mainnet';
  try {
    assert.throws(
      () => escrowConfig(),
      (e: Error) =>
        !(e instanceof TypeError) &&
        /ESCROW_CHAIN must be one of/.test(e.message),
    );
  } finally {
    if (saved === undefined) delete process.env.ESCROW_CHAIN;
    else process.env.ESCROW_CHAIN = saved;
  }
});

test('the safety lines are in the instructions and every tool that carries third-party text', async () => {
  const { tools, instructions } = await listed({
    ESCROW_FACTORY_ADDRESS: FACTORY,
  });
  // find carries program and sponsor text (v2.9 list_programs and get_program).
  for (const line of SAFETY_LINES) {
    assert.ok(instructions.includes(line), line);
    for (const name of ['find'])
      assert.ok(tools.find((t) => t.name === name)!.description!.includes(line), `${name}: ${line}`);
  }
});

async function connected(ctx: Parameters<typeof createMcpServer>[0] = { installationId: 1 }) {
  const server = createMcpServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

test('confirm is strict: a misnamed key is an error, not silently dropped', async () => {
  const client = await connected();
  try {
    // Rejected by the input schema, before the tool runs (so no database is touched).
    for (const args of [
      { project_id: 7, yes: true, ticker: 'KITS' },
      { program_id: 'p', project: { name: 'Kit' }, answers: {}, ticker: 'KITS' },
    ]) {
      const r = await client.callTool({ name: 'confirm', arguments: args });
      assert.equal(r.isError, true);
      assert.match(JSON.stringify(r.content), /Unrecognized key/);
    }
  } finally {
    await client.close();
  }
});

test('an old record_submission call, aliased, passes confirm\'s schema: token.proposed echoed verbatim, null, a bare ticker, any builder_confirmed', async () => {
  const client = await connected();
  const errLog = console.error;
  console.error = () => {};
  try {
    const base = { program_id: 'p', project: { name: 'Kit' }, submission_data: {} };
    for (const extra of [
      // token.proposed from prepare, as is (with `image`).
      { token: { name: 'Chain Kits', symbol: 'CHAIN', image: 'mark' }, builder_confirmed: true },
      { token: null, builder_confirmed: 'yes' },
      { token: 'skip' },
      { token: 'CHAIN', builder_confirmed: true },
      { token: [], builder_confirmed: true },
    ]) {
      const next = aliasCall('record_submission', { ...base, ...extra })!;
      assert.equal(next.name, 'confirm');
      // The schema lets it through to the tool; with no database here the tool itself then fails,
      // which is not an input validation error.
      const r = await client
        .callTool({ name: next.name, arguments: next.args })
        .catch((err: unknown) => ({ isError: true, content: String(err) }));
      assert.doesNotMatch(JSON.stringify(r.content), /Input validation error/, JSON.stringify(extra));
    }
  } finally {
    console.error = errLog;
    await client.close();
  }
});

test('v2.6 Ruling 5 (plan), R16: tell takes submitted (program_id, the entry link, project_id) and says to ask "Did you submit?" first', async () => {
  const { tools } = await listed({});
  const tell = tools.find((t) => t.name === 'tell')!;
  const submitted = (tell.inputSchema.properties as Record<string, { properties?: Record<string, unknown>; required?: string[] }>).submitted;
  for (const k of ['program_id', 'external_submission_url', 'project_id']) assert.ok(k in submitted.properties!, k);
  assert.deepEqual(submitted.required, ['program_id']);
  assert.ok(!(tell.inputSchema.required ?? []).includes('submitted'));
  assert.match(tell.description ?? '', /Did you submit on <program site>\?/);
  assert.match(tell.description ?? '', /a shared agent adds project_id/);
  const pickup = (tell.inputSchema.properties as Record<string, { enum?: string[] }>).pickup;
  assert.deepEqual(pickup.enum, ['yes', 'no']);
});

test('v2.4: the instructions say every reply may open with since_you_last_checked, shown first', async () => {
  const { instructions } = await listed({});
  assert.match(instructions, /since_you_last_checked first/);
});

test('v2.4, v2.10 item 4: while a campaign is open the instructions say confirm is the campaign entry; otherwise not', async () => {
  assert.match((await listed({}, { campaignOpen: true })).instructions, /^EarnKit campaigns: confirm is the entry\.$/m);
  assert.doesNotMatch((await listed({})).instructions, /EarnKit campaign/);
});

test('v2.10 items 4, 5: the instructions: the order of the 4 tools; one yes submits the entry and launches the token', async () => {
  const { instructions } = await listed({});
  assert.equal(instructions.split('\n')[0], "Call find, then prepare until ready, then confirm on the builder's yes, then tell once they submitted.");
  assert.ok(instructions.includes('Yes submits the entry and launches the token; skip the token submits without one.'));
  assert.doesNotMatch(instructions, /token_offer|no token and no builder bonus/);
  assert.match(instructions, /Never name tools, fields or files to the builder, or invent personal details\./);
  // The wallet and earnkit.txt rules are with the tools that use them.
  assert.match(TOOL_DESCRIPTIONS.confirm, /wallet: the shown_wallet they confirmed \(never one they didn't see\)/);
  assert.match(TOOL_DESCRIPTIONS.prepare, /Write and push it yourself; never ask the builder to edit files\./);
});

test('v2.10 item 4: find says a yes prepares lead.program_id, more only when asked, and program_id shows one program and its guide', async () => {
  const { tools } = await listed({});
  const find = tools.find((t) => t.name === 'find')!;
  const d = find.description!;
  assert.match(d, /A yes to the reply prepares lead\.program_id; more: true only when they ask for more\./);
  assert.match(d, /program_id: one program and its guide; repo: whether it fits\./);
  assert.match(d, /last_commit_at/);
  // v2.11 T7: the no-repo lead's offer.
  assert.match(d, /build_offer: follow its agent_note\./);
  const props = find.inputSchema.properties as Record<string, { description?: string }>;
  assert.match(props.more.description ?? '', /never for a yes to the lead/);
  for (const k of ['program_id', 'repo', 'local_repos', 'github_user', 'repos', 'wallet', 'agent_can_build', 'signed_in']) assert.ok(k in props, k);
  assert.equal(find.annotations?.readOnlyHint, true);
  assert.doesNotMatch(d, /token_offer|top prizes/);
});

test('Ruling 13 (plan): the local_repos item schema accepts a url', async () => {
  const { tools } = await listed({});
  const lp = tools.find((t) => t.name === 'find')!;
  const localRepos = (lp.inputSchema.properties as Record<string, unknown>).local_repos as {
    items: { properties: Record<string, unknown> };
  };
  assert.ok('url' in localRepos.items.properties, JSON.stringify(localRepos.items.properties));
});

/** v2.8.1 §B6 (fix round 1, review Critical 1): every odd shape an agent sends to find (v2.9 list_programs). */
const ODD_LIST_INPUTS: Record<string, unknown>[] = [
  { local_repos: [{ chains: ['base'] }] }, // no name
  { local_repos: [{ chains: ['base'], url: 'https://github.com/acme/tipjar' }] }, // no name, a GitHub link
  { wallet: 42 },
  { wallet: 'vitalik.eth' },
  { wallet: { address: '0xabc' } },
  { local_repos: [{ name: 'x', chains: [8453] }] }, // a chain id
  { local_repos: [{ name: 'x', chains: [{ chain: 8453, mainnet: 'yes' }, '84532', null, true] }] },
  { local_repos: [{ name: 'ethapp', chains: [{ chain: 'ethereum', mainnet: true }] }] }, // unknown chain
  { local_repos: [{ name: 'x', chains: 'base' }] }, // one string, not a list
  { local_repos: [{ name: 'x', chains: Array(30).fill('base') }] }, // over the limit: truncated
  { local_repos: [{ name: 'tipjar', chains: ['base'], last_commit_at: '2026-10-01', live_url: 'tipjar.xyz' }] }, // no timezone, no scheme
  { local_repos: [{ name: 'x', chains: [], last_commit_at: 1759300000, live_url: 42, url: null }] },
  { local_repos: [{ name: 'x'.repeat(500), chains: [] }] },
  { local_repos: ['tipjar', 7] },
  { local_repos: Array.from({ length: 40 }, (_, i) => ({ name: `r${i}`, chains: ['base'] })) },
  { local_repos: { name: 'tipjar', chains: ['base'] } }, // one repo, not a list
  // Fix round 2: github_user, repos and agent_can_build.
  { github_user: '@octocat' },
  { github_user: 'https://github.com/octocat' },
  { github_user: 'not a user!!' },
  { github_user: 42 },
  { repos: 'acme/tipjar' },
  { repos: ['https://github.com/acme/tipjar', 5, 'not a repo', null] },
  { repos: { owner: 'acme' } },
  { agent_can_build: 'false' },
  { agent_can_build: 'yes' },
  { agent_can_build: 0 },
  { agent_can_build: 1 },
  { agent_can_build: 'maybe' },
  { agent_can_build: null },
];

test('v2.8.1 §B6 (fix round 1): every odd find input passes the MCP schema; with a database, the call succeeds', async () => {
  const db = Boolean(process.env.DATABASE_URL);
  const installationId = db
    ? (await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t3fix-${process.pid}-${Date.now()}`}) RETURNING id`)[0].id
    : 1;
  // GitHub is never read here: matching is stubbed.
  const client = await connected({
    installationId,
    roundPools: async () => new Map(),
    repoCoins: async () => new Map(),
    matchProjects: async () => ({ checked: 0, fits: [] }),
  });
  const errLog = console.error;
  console.error = () => {};
  try {
    for (const args of ODD_LIST_INPUTS) {
      const r = await client
        .callTool({ name: 'find', arguments: args })
        .catch((err: unknown) => ({ isError: true, content: String(err) }));
      const text = JSON.stringify(r.content);
      assert.doesNotMatch(text, /Input validation error|Invalid option|invalid_type/, JSON.stringify(args).slice(0, 200));
      // With a database the whole call goes through: a reply for the builder, never an error.
      if (db) {
        assert.notEqual(r.isError, true, `${JSON.stringify(args).slice(0, 200)}: ${text.slice(0, 300)}`);
        assert.match(text, /show_to_builder/);
      }
    }
  } finally {
    console.error = errLog;
    await client.close();
    if (db) await sql()`DELETE FROM installations WHERE id = ${installationId}`;
  }
});

test('v2.6: the token needs one ticker-free line the agent pushes; no wallet line, no live link', async () => {
  assert.ok(OWNERSHIP_FOR_TOKEN.includes('token: <code>'));
  assert.ok(OWNERSHIP_FOR_TOKEN.includes('never ask the builder to edit files'));
  for (const gone of ['payout_wallet', '<SYMBOL>', 'live link'])
    assert.ok(!OWNERSHIP_FOR_TOKEN.includes(gone), gone);
  const { tools } = await listed({});
  const confirm = tools.find((t) => t.name === 'confirm')!.description!;
  assert.ok(confirm.includes("project_id instead of program_id: an entry's token, e.g. after you pushed earnkit.txt."));
  assert.ok(tools.find((t) => t.name === 'prepare')!.description!.includes(OWNERSHIP_FOR_TOKEN));
});

test('v2.7 §3, Ruling 15/18 (plan): prepare says to call again until ready; the campaign Token row only while one is open; no tool names Clanker', () => {
  assert.match(TOOL_DESCRIPTIONS.prepare, /Call again until ready is true; then it ends with the confirm line \(token and wallet\)\./);
  assert.match(TOOL_DESCRIPTIONS.prepare, /one Token row \(a token on Base\)/);
  assert.doesNotMatch(toolDescriptions(false).prepare, /Token row|submission link/);
  for (const [name, d] of Object.entries(TOOL_DESCRIPTIONS)) assert.doesNotMatch(d, /clanker|protocol cut/i, name);
});

// ---- v2.8 Ruling 23 (plan): campaign-only agent text, hidden while no EarnKit campaign is open.
test('v2.8 Ruling 23 (plan): SERVER_INSTRUCTIONS never says EarnKit "runs its own campaigns"', () => {
  assert.doesNotMatch(SERVER_INSTRUCTIONS, /runs its own campaigns/);
});

test('v2.8 Ruling 23 (plan): toolDescriptions(false) drops the campaign sentences; (true) keeps them', () => {
  const closed = toolDescriptions(false);
  const open = toolDescriptions(true);
  for (const name of ['prepare', 'confirm'] as const) {
    for (const word of ['EarnKit campaign', 'how_to_submit', 'sign_to_enter', 'EIP-191'])
      assert.ok(!closed[name].includes(word), `${name} (closed): ${word}`);
    assert.match(open[name], /EarnKit campaign/, name);
  }
  // v2.11 T8 review M2: TOOL_DESCRIPTIONS is the longest variant (campaign open, build listed).
  assert.deepEqual(TOOL_DESCRIPTIONS, toolDescriptions(true, true));
  assert.equal(toolDescriptions(true, false).prepare, open.prepare, 'deploys off in the test env');
  // The rest of the text stays.
  assert.match(closed.prepare, /then it ends with the confirm line/);
  assert.match(closed.confirm, /yes: true when they say yes/);
});

async function registered(opts?: { campaignOpen?: boolean }) {
  const server = createMcpServer({ installationId: 1 }, opts);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

test('v2.8 Ruling 23 (plan): createMcpServer with campaignOpen false (the default) registers the closed text', async () => {
  for (const tools of [await registered({ campaignOpen: false }), await registered()]) {
    const confirm = tools.find((t) => t.name === 'confirm')!;
    const props = confirm.inputSchema.properties as Record<string, { description?: string }>;
    assert.ok(props.deployer_signature, 'deployer_signature stays registered');
    assert.ok(props.contracts, 'contracts stays registered');
    assert.doesNotMatch(props.deployer_signature.description ?? '', /EarnKit campaigns/);
    assert.match(props.deployer_signature.description ?? '', /deployed by a wallet other than the entry's wallet/);
    assert.doesNotMatch(props.contracts.description ?? '', /EarnKit campaigns/);
    assert.equal(confirm.description, toolDescriptions(false).confirm);
    assert.equal(tools.find((t) => t.name === 'prepare')!.description, toolDescriptions(false).prepare);
  }
  const open = (await registered({ campaignOpen: true })).find((t) => t.name === 'confirm')!;
  const props = open.inputSchema.properties as Record<string, { description?: string }>;
  assert.match(props.deployer_signature.description ?? '', /EarnKit campaigns/);
  assert.match(props.contracts.description ?? '', /^EarnKit campaigns, and other programs/);
  assert.equal(open.description, toolDescriptions(true).confirm);
});

test('v2.8 Task 5 fix round 1: serverInstructions(false) drops the campaign sentence; the server sends it at initialize', async () => {
  const closed = serverInstructions(false);
  assert.doesNotMatch(closed, /EarnKit campaign/);
  assert.equal(SERVER_INSTRUCTIONS, serverInstructions(true));
  assert.match(SERVER_INSTRUCTIONS, /EarnKit campaigns: confirm is the entry\./);
  assert.equal((await listed({})).instructions, closed);
  assert.equal((await listed({}, { campaignOpen: true })).instructions, SERVER_INSTRUCTIONS);
});

test('v2.8 Part C, R15: confirm is registered, strict, takes yes, skip_token, check and project_id, and says the kit is only in its reply', async () => {
  const tools = await registered();
  const confirm = tools.find((t) => t.name === 'confirm')!;
  assert.equal(confirm.description, toolDescriptions(false).confirm);
  assert.match(confirm.description!, /yes: true when they say yes \(the entry is submitted and the token launches\) or skip_token: true when they say skip the token/);
  assert.match(confirm.description!, /The submit kit is only in this reply\./);
  const props = confirm.inputSchema.properties as Record<string, unknown>;
  for (const k of ['program_id', 'project_id', 'project', 'answers', 'yes', 'skip_token', 'check', 'token', 'wallet', 'agent', 'signed_in', 'image_data', 'image_url', 'builder_x', 'contracts', 'deployer_signature'])
    assert.ok(k in props, k);
  for (const gone of ['decision', 'builder_confirmed', 'check_back', 'creator_wallet', 'offer']) assert.ok(!(gone in props), gone);
  const prep = tools.find((t) => t.name === 'prepare')!.inputSchema.properties as Record<string, unknown>;
  assert.ok('agent' in prep);
  // v2.10 item 15: a shared client's builder passes the sign-in code so their deadline line shows.
  assert.ok('signed_in' in prep);
});

test('3.9, R16: tell writes and find stays read-only; tell takes submitted, pickup and the v2.9 statements; no description names report_outcome', async () => {
  const { tools } = await listed({});
  assert.equal(tools.length, 4);
  assert.equal(tools.find((t) => t.name === 'find')!.annotations?.readOnlyHint, true);
  assert.ok(!tools.some((t) => t.name === 'report_outcome'));
  const tell = tools.find((t) => t.name === 'tell')!;
  assert.equal(tell.annotations?.readOnlyHint, false);
  assert.deepEqual(Object.keys((tell.inputSchema as { properties: object }).properties).sort(), ['pickup', 'program_status', 'repo_facts', 'signed_in', 'submitted', 'weekly_email']);
  assert.match(tell.description!, /call it only with what they said/);
  for (const t of tools) {
    assert.ok(t.description!.length < 800, `${t.name}: ${t.description!.length} characters`);
    assert.doesNotMatch(t.description ?? '', /report_outcome|token_offer/, t.name);
  }
  for (const d of Object.values(TOOL_DESCRIPTIONS)) assert.doesNotMatch(d, /report_outcome/);
});

test('v2.8.1 §C15: an unexpected error is logged on the server with an id; the agent sees a plain message with that id, never the raw error', async () => {
  const client = await connected();
  const original = handlers.tell_earnkit;
  const errLog = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => void logged.push(args);
  (handlers as Record<string, unknown>).tell_earnkit = async () => {
    throw new Error('Connection terminated unexpectedly');
  };
  try {
    const r = await client.callTool({ name: 'tell', arguments: { program_status: [{ program_id: 'p', status: 'won' }] } });
    assert.equal(r.isError, true);
    const text = (r.content as { text: string }[])[0].text;
    const id = /error id ([0-9a-f]{8})\.$/.exec(text)?.[1];
    assert.ok(id, text);
    assert.equal(text, unexpectedErrorText(id!));
    assert.doesNotMatch(text, /Connection terminated|tell_earnkit/);
    // The server log has the tool, the same id and the error's name, message and stack.
    const line = logged.find((l) => String(l[0]).includes(id!));
    assert.ok(line, JSON.stringify(logged.map((l) => String(l[0]))));
    assert.match(String(line![0]), /^\[mcp\] tell error [0-9a-f]{8}$/);
    assert.match((line![1] as { message: string }).message, /Connection terminated unexpectedly/);
    // M6: name, message and stack only.
    assert.deepEqual(Object.keys(line![1] as object).sort(), ['message', 'name', 'stack']);
  } finally {
    (handlers as Record<string, unknown>).tell_earnkit = original;
    console.error = errLog;
    await client.close();
  }
});

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };

test('9.7 (Review Focus 2) the route: an old get_program call returns what find with program_id returns; the log names the alias, never an argument', dbTest, async () => {
  const stamp = `${process.pid}-${Date.now()}`;
  const program = { ...committedProgram('arc-microgrants'), id: `t9-route-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' };
  await upsertProgram(ProgramFile.parse(program));
  const token = `t9-route-token-${stamp}`;
  await saveInstallation(token);
  const post = (id: number, name: string, args: object) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    // A client's content-length is for the body it sent, not the rewritten one.
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'content-length': String(body.length) };
    return POST(new Request('https://earnkit.test/mcp', { method: 'POST', headers, body }));
  };
  // v2.10.1 B5: an old-name call is answered as a stream whose first event is tools/list_changed.
  const events = async (r: Response) =>
    (await r.text())
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice('data: '.length)) as Record<string, unknown>);
  const reply = async (r: Response) => {
    const body = (/event-stream/.test(r.headers.get('content-type') ?? '') ? (await events(r)).at(-1) : await r.json()) as { result?: { content: { text: string }[]; isError?: boolean }; error?: unknown };
    assert.ok(body.result, JSON.stringify(body));
    assert.notEqual(body.result.isError, true, body.result.content[0].text);
    // Alerts are said once per check, so the first reply may open with them: compared without.
    const rest = JSON.parse(body.result.content[0].text) as Record<string, unknown>;
    delete rest.since_you_last_checked;
    return rest;
  };
  const logs: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
  try {
    const freshRes = await post(1, 'find', { program_id: program.id });
    assert.match(freshRes.headers.get('content-type') ?? '', /application\/json/, 'a new-name call is plain JSON');
    const fresh = await reply(freshRes);
    const oldRes = await post(2, 'get_program', { program_id: program.id });
    // v2.10.1 fix round 1 (I3): plain JSON, as before (no list_changed stream).
    assert.match(oldRes.headers.get('content-type') ?? '', /application\/json/);
    const old = await reply(oldRes);
    // v2.10.1 B5: the same reply, each tool named in both forms, plus the refresh note.
    assert.equal(old.tools_note, STALE_TOOLS_NOTE);
    delete old.tools_note;
    assert.deepEqual(old, oldWords(fresh, 'get_program'));
    assert.match(String(fresh.show_to_builder), /^Arc Microgrants/);
    assert.equal(old.show_to_builder, fresh.show_to_builder);
    // tools/list through the route: the 4 tools only, whichever names the client called.
    const list = await POST(new Request('https://earnkit.test/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }),
    }));
    const names = ((await list.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, FOUR);
  } finally {
    console.log = log;
  }
  assert.deepEqual(logs.filter((l) => l.startsWith('[mcp] alias')), ['[mcp] alias get_program -> find']);
  for (const l of logs) assert.ok(!l.includes(program.id), l);
});

test('v2.8.1 §C15: the safety line no longer forbids making a repo public; it says a token needs one', () => {
  const line = SAFETY_LINES.find((l) => l.startsWith('Entering a program never needs'))!;
  assert.doesNotMatch(line, /visibility/);
  // v2.10 Pre-flight P17: a private repo can launch through the read-only App (item 7b).
  assert.match(line, /A token needs a repo you prove is yours; make a repo public only when the builder asks\./);
  assert.ok(SERVER_INSTRUCTIONS.includes(line));
});

test('final fix wave (M6): the unexpected-error log keeps only name, message and stack, never query or parameters', () => {
  const err = Object.assign(new Error('boom'), { query: 'INSERT INTO answer_bank ...', parameters: ['alice@example.com', '0x' + 'a'.repeat(40)] });
  const out = errorSummary(err);
  assert.deepEqual(Object.keys(out).sort(), ['message', 'name', 'stack']);
  assert.equal(out.message, 'boom');
  assert.doesNotMatch(JSON.stringify(out), /alice@example\.com|answer_bank|0xaaaa/);
  assert.deepEqual(errorSummary({ secret: 'x' }), { name: 'object', message: 'non-Error thrown' });
});


test('11.8 (F25): the confirm description under 800 characters; their rules are in the replies', () => {
  assert.ok(TOOL_DESCRIPTIONS.confirm.length < 800, `confirm: ${TOOL_DESCRIPTIONS.confirm.length}`);
  // confirm keeps when to call it, its inputs and to follow agent_note.
  for (const k of ['yes: true', 'skip_token: true', 'wallet', 'token: { name, symbol }', 'check: true', 'project_id', 'agent_note'])
    assert.ok(TOOL_DESCRIPTIONS.confirm.includes(k), k);
  // The kit rules: the kit reply's agent_note (DoraHacks: copy and paste; the builder clicks submit).
  const dora: KitProgram = { title: 'Arc Microgrants', submission_url: 'https://dorahacks.io/hackathon/arc', submission_requirements: [] };
  const note = kitReplyNote(submitKit(dora, {}, { browser: true }), dora);
  assert.match(note, /terms ban automated use/);
  assert.match(note, /The builder always clicks submit/);
  assert.match(note, /The kit is only in this reply; never show a kit any other way\./);
  // The sponsor rules: create's next_step (defaults, verification, brand names, confirm first).
  const create = createReply({
    ref: '0x' + 'a'.repeat(64), title: 'Build on Acme', poolUnits: 100_000_000n, token: { symbol: 'USDC', decimals: 6 }, winners: 3,
    endsAt: '2026-10-20T00:00:00Z', fundUrl: 'https://earnkit.com/fund/0xabc', sponsorWallet: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    identity: { verified: false, host: 'acme.dev' },
  });
  assert.match(create.next_step, /Confirm amounts and wording with the sponsor/);
  assert.match(create.next_step, /\.well-known\/earnkit\.txt/);
  assert.match(create.next_step, /brand/);
  assert.match(awardReply({ winners: [], token: { symbol: 'USDC', decimals: 6 }, feeUnits: 0n, awardUrl: 'https://earnkit.com/award/0xabc' }).next_step, /never send an award transaction the sponsor has not approved/i);
});

test('final fix M4: prepare lists deploy only while deploys are on', async () => {
  const deployProp = async (key: string | undefined) => {
    const old = process.env.DEPLOYER_PRIVATE_KEY;
    if (key === undefined) delete process.env.DEPLOYER_PRIVATE_KEY;
    else process.env.DEPLOYER_PRIVATE_KEY = key;
    try {
      const { tools } = await listed({});
      const prepare = tools.find((t) => t.name === 'prepare')!;
      return (prepare.inputSchema.properties as Record<string, unknown>)?.deploy;
    } finally {
      if (old === undefined) delete process.env.DEPLOYER_PRIVATE_KEY;
      else process.env.DEPLOYER_PRIVATE_KEY = old;
    }
  };
  assert.equal(await deployProp(undefined), undefined, 'no deployer key: no deploy field');
  assert.equal(await deployProp('not-a-key'), undefined, 'a malformed key: no deploy field');
  const on = await deployProp('5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
  assert.match(JSON.stringify(on), /EarnKit pays the gas/);
  // v2.10.3: DEPLOY_CHAINS naming no chain EarnKit deploys on: no deploy field either.
  const oldChains = process.env.DEPLOY_CHAINS;
  process.env.DEPLOY_CHAINS = 'nowhere';
  try {
    assert.equal(await deployProp('5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'), undefined, 'no chain on: no deploy field');
    process.env.DEPLOY_CHAINS = 'base';
    assert.match(JSON.stringify(await deployProp('5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a')), /EarnKit pays the gas/);
  } finally {
    if (oldChains === undefined) delete process.env.DEPLOY_CHAINS;
    else process.env.DEPLOY_CHAINS = oldChains;
  }
});

test('v2.11 T8: prepare lists build only while deploys are on (with deploy); an unknown key inside build reaches prepare and is refused with an agent note', async () => {
  const old = process.env.DEPLOYER_PRIVATE_KEY;
  try {
    delete process.env.DEPLOYER_PRIVATE_KEY;
    let { tools } = await listed({});
    assert.ok(!('build' in (tools.find((t) => t.name === 'prepare')!.inputSchema.properties as object)), 'deploys off: no build field');
    // Review M2: the description names build only while the field is listed.
    assert.doesNotMatch(tools.find((t) => t.name === 'prepare')!.description!, /build_offer/);
    process.env.DEPLOYER_PRIVATE_KEY = '5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
    ({ tools } = await listed({}));
    const build = (tools.find((t) => t.name === 'prepare')!.inputSchema.properties as Record<string, unknown>).build;
    assert.match(JSON.stringify(build), /build_offer/);
    assert.match(tools.find((t) => t.name === 'prepare')!.description!, /build: a build_offer yes\./);
    assert.ok(tools.find((t) => t.name === 'prepare')!.description!.length < 800);
    const server = createMcpServer({ installationId: 1 });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const r = (await client.callTool({ name: 'prepare', arguments: { program_id: 'p', build: { start: true, program_id: 'p', color: 'red' } } })) as {
      content: { text: string }[];
    };
    await client.close();
    const reply = JSON.parse(r.content[0].text) as { show_to_builder: string; agent_note: string };
    assert.equal(reply.show_to_builder, '');
    assert.match(reply.agent_note, /color/);
  } finally {
    if (old === undefined) delete process.env.DEPLOYER_PRIVATE_KEY;
    else process.env.DEPLOYER_PRIVATE_KEY = old;
  }
});

/** v2.12.2's identity field words, byte for byte (the flag off). */
const IDENTITY_WORDS_V2122 =
  "What you can already see; fill it yourself, never ask the builder: { github_login (gh auth status), projects: [{ name, what: a few plain words like 'a tip jar', repo, live_url, package, contracts: ['base:0x..'] }], wallets }";
const identityWords = (t: { inputSchema: { properties?: Record<string, object> } }) =>
  (t.inputSchema.properties?.identity as { description?: string } | undefined)?.description;

test('2.7 flag off: find\'s description and identity field are byte for byte v2.12.2\'s', async () => {
  const saved = process.env.EARNKIT_BENCH;
  const savedScore = process.env.EARNKIT_BUILDER_SCORE;
  delete process.env.EARNKIT_BENCH;
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  try {
    assert.equal(toolDescriptions(false).find, FIND_DESCRIPTION_SCORE);
    const off = (await listed({})).tools.find((t) => t.name === 'find')!;
    assert.equal(off.description, FIND_DESCRIPTION_SCORE);
    assert.equal(identityWords(off), IDENTITY_WORDS_V2122);
  } finally {
    if (savedScore === undefined) delete process.env.EARNKIT_BUILDER_SCORE;
    else process.env.EARNKIT_BUILDER_SCORE = savedScore;
    if (saved === undefined) delete process.env.EARNKIT_BENCH;
    else process.env.EARNKIT_BENCH = saved;
  }
});

test('2.8 flag on: find asks for identity.project (one, never a list) and stays under 800 characters', async () => {
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  process.env.EARNKIT_BENCH = 'on';
  try {
    const d = toolDescriptions(false).find;
    assert.equal(d, FIND_DESCRIPTION_BENCH);
    assert.ok(d.length < 800, `${d.length}`);
    assert.match(d, /identity\.project/);
    assert.match(d, /never a list/);
    const on = (await listed({})).tools.find((t) => t.name === 'find')!;
    assert.equal(on.description, FIND_DESCRIPTION_BENCH);
    assert.match(identityWords(on) ?? '', /project: the project in this folder/);
    assert.match(identityWords(on) ?? '', /One project, never a list\.$/);
  } finally {
    delete process.env.EARNKIT_BENCH;
    delete process.env.EARNKIT_BUILDER_SCORE;
  }
});

test('5.11 flag on: tell lists update and updates and stays under 800 characters; flag off: byte for byte v2.12.2', () => {
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  delete process.env.EARNKIT_BENCH;
  try {
    assert.equal(toolDescriptions(false).tell, TELL_DESCRIPTION_SCORE);
    process.env.EARNKIT_BENCH = 'on';
    // Final fix: EARNKIT_RAISING off, coin takes no { raising } (the description names none).
    assert.equal(toolDescriptions(false).tell, TELL_DESCRIPTION_BENCH_NO_RAISING);
    assert.ok(!TELL_DESCRIPTION_BENCH_NO_RAISING.includes('raising'));
    process.env.EARNKIT_RAISING = 'on';
    const d = toolDescriptions(false).tell;
    assert.equal(d, TELL_DESCRIPTION_BENCH);
    assert.ok(d.length < 800, `${d.length}`);
    // F20: coin { raising } is Task 9's, listed only under the Bench flag.
    for (const w of ['update: { text }', 'hide', 'updates: { on', 'raising']) assert.ok(d.includes(w), w);
    assert.ok(!TELL_DESCRIPTION_SCORE.includes('raising'));
  } finally {
    delete process.env.EARNKIT_RAISING;
    delete process.env.EARNKIT_BENCH;
    delete process.env.EARNKIT_BUILDER_SCORE;
  }
});

test('5.12 flag off: the registered tell input schema is byte for byte the one before v2.13 Task 5 (fix round 1, review 10)', async () => {
  const { createHash } = await import('node:crypto');
  // sha256 of JSON.stringify(tell.inputSchema), taken from mcp.ts before Task 5 (score off, score on).
  const BEFORE = { off: '273e03cf26598f86a2f880818133ec687780af9e35ad9aa8951103860e4b9698', on: 'd5e44c8470bcd030483406eca659289d1dd77a3f6bd263f522e906588def6cb2' };
  const saved = { bench: process.env.EARNKIT_BENCH, score: process.env.EARNKIT_BUILDER_SCORE };
  delete process.env.EARNKIT_BENCH;
  try {
    for (const score of ['off', 'on'] as const) {
      if (score === 'on') process.env.EARNKIT_BUILDER_SCORE = 'on';
      else delete process.env.EARNKIT_BUILDER_SCORE;
      const tell = (await listed({})).tools.find((t) => t.name === 'tell')!;
      assert.equal(createHash('sha256').update(JSON.stringify(tell.inputSchema)).digest('hex'), BEFORE[score], score);
      assert.ok(!('update' in (tell.inputSchema.properties ?? {})) && !('updates' in (tell.inputSchema.properties ?? {})));
    }
    process.env.EARNKIT_BENCH = 'on';
    // Final fix: EARNKIT_RAISING off, coin is v2.12.2's (no raising; project_key and answer required).
    const noRaise = (await listed({})).tools.find((t) => t.name === 'tell')!;
    assert.ok('update' in (noRaise.inputSchema.properties ?? {}) && 'updates' in (noRaise.inputSchema.properties ?? {}));
    const coinOff = (noRaise.inputSchema.properties as Record<string, { properties?: Record<string, unknown>; required?: string[] }>).coin;
    assert.ok(coinOff.properties && !('raising' in coinOff.properties));
    assert.deepEqual([...(coinOff.required ?? [])].sort(), ['answer', 'project_key']);
    process.env.EARNKIT_RAISING = 'on';
    const on = (await listed({})).tools.find((t) => t.name === 'tell')!;
    assert.ok('update' in (on.inputSchema.properties ?? {}) && 'updates' in (on.inputSchema.properties ?? {}));
    // T9 (F20): coin takes raising under the flag (and EARNKIT_RAISING), with project_key and answer optional.
    const coin = (on.inputSchema.properties as Record<string, { properties?: Record<string, unknown>; required?: string[] }>).coin;
    assert.ok(coin.properties && 'raising' in coin.properties);
    assert.deepEqual(coin.required ?? [], []);
  } finally {
    delete process.env.EARNKIT_RAISING;
    if (saved.bench === undefined) delete process.env.EARNKIT_BENCH;
    else process.env.EARNKIT_BENCH = saved.bench;
    if (saved.score === undefined) delete process.env.EARNKIT_BUILDER_SCORE;
    else process.env.EARNKIT_BUILDER_SCORE = saved.score;
  }
});

test('O2.6 flag on: the Bench branch of the server instructions (under 800), no old entry-and-token flow; find names move_up, not build_offer\'s note; flag off byte for byte', async () => {
  const off = serverInstructions(false);
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  process.env.EARNKIT_BENCH = 'on';
  try {
    const on = serverInstructions(false);
    assert.ok(on.length < 800, String(on.length));
    assert.equal(serverInstructions(true), on);
    assert.ok(on.startsWith('Call find first. Show show_to_builder exactly as written and follow every agent_note.\nA yes or no to the last line goes to tell move_up.\nCall score when they ask where they stand.\nNever name tools, fields or files to the builder'));
    assert.doesNotMatch(on, /launches the token|submits the entry|since_you_last_checked|prepare until ready/);
    for (const line of SAFETY_LINES) assert.ok(on.includes(line));
    assert.equal((await listed({})).instructions, on);
    assert.doesNotMatch(FIND_DESCRIPTION_BENCH, /build_offer|A yes prepares/);
    assert.match(FIND_DESCRIPTION_BENCH, /A yes or no to the last line goes to tell move_up\./);
    assert.ok(FIND_DESCRIPTION_BENCH.length < 800);
  } finally {
    delete process.env.EARNKIT_BENCH;
    delete process.env.EARNKIT_BUILDER_SCORE;
  }
  assert.equal(serverInstructions(false), off);
  assert.ok(off.includes('Yes submits the entry and launches the token'));
});
