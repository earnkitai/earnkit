import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { escrowConfig, escrowConfigProblem } from './escrow';
import { OWNERSHIP_FOR_TOKEN, SERVER_INSTRUCTIONS, errorSummary, TOOL_DESCRIPTIONS, createMcpServer, serverInstructions, toolDescriptions, unexpectedErrorText } from './mcp';
import { tools as toolImpls } from './tools';
import { SAFETY_LINES } from './untrusted-text';
import { kitReplyNote, submitKit, type KitProgram } from './submit-kit';
import { awardReply, createReply } from './sponsor-rules';
import { sql } from './db';

// Tool replies read alerts from the database when DATABASE_URL is set: close the pool.
after(async () => {
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

const SIX = [
  'confirm_entry',
  'get_program',
  'launch_token',
  'list_programs',
  // v2.8.1 §E18: the builder's yes or no to picking up earlier entries.
  'pick_up_entries',
  'prepare_submission',
  'record_submission',
  // v2.9 A3: what the builder tells EarnKit (applied, not interested, outcomes, repo facts); it
  // replaced report_outcome, so the count stays 8.
  'tell_earnkit',
];

test('without escrow config the server offers exactly the 8 builder tools', async () => {
  assert.deepEqual(await toolNames({}), SIX);
});

test('an invalid ESCROW_CHAIN keeps sponsor_campaign hidden', async () => {
  assert.deepEqual(
    await toolNames({
      ESCROW_FACTORY_ADDRESS: FACTORY,
      ESCROW_CHAIN: 'mainnet',
    }),
    SIX,
  );
});

test('a configured escrow adds sponsor_campaign', async () => {
  assert.deepEqual(
    await toolNames({
      ESCROW_FACTORY_ADDRESS: FACTORY,
      ESCROW_CHAIN: 'base-sepolia',
    }),
    [...SIX, 'sponsor_campaign'].sort(),
  );
  assert.deepEqual(
    await toolNames({ ESCROW_FACTORY_ADDRESS: FACTORY }), // ESCROW_CHAIN defaults to base
    [...SIX, 'sponsor_campaign'].sort(),
  );
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

test('the three safety lines are in the instructions and every tool that carries third-party text', async () => {
  const { tools, instructions } = await listed({
    ESCROW_FACTORY_ADDRESS: FACTORY,
  });
  const carriers = [
    'list_programs',
    'get_program',
    'record_submission',
    'sponsor_campaign',
  ];
  for (const line of SAFETY_LINES) {
    assert.ok(instructions.includes(line), line);
    for (const name of carriers)
      assert.ok(
        tools.find((t) => t.name === name)!.description!.includes(line),
        `${name}: ${line}`,
      );
  }
});

test('launch_token is strict: a misnamed key is an error, not silently dropped', async () => {
  const server = createMcpServer({ installationId: 1 });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    // Rejected by the input schema, before the tool runs (so no database is touched).
    const r = await client.callTool({
      name: 'launch_token',
      arguments: { project_id: 7, builder_confirmed: true, ticker: 'KITS' },
    });
    assert.equal(r.isError, true);
    assert.match(JSON.stringify(r.content), /Unrecognized key: \\"ticker\\"/);
  } finally {
    await client.close();
  }
});

test('record_submission accepts token.proposed echoed verbatim, null, and any builder_confirmed', async () => {
  const server = createMcpServer({ installationId: 1 });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const errLog = console.error;
  console.error = () => {};
  try {
    const base = { program_id: 'p', project: { name: 'Kit' }, submission_data: {} };
    for (const extra of [
      // token.proposed from prepare_submission, as is (with `image`).
      { token: { name: 'Chain Kits', symbol: 'CHAIN', image: 'monogram' }, builder_confirmed: true },
      { token: null, builder_confirmed: 'yes' },
      { token: 'skip' },
      // Neither "skip" nor an object: EarnKit skips the token with a note, never fails the entry.
      { token: 'CHAIN', builder_confirmed: true },
      { token: [], builder_confirmed: true },
    ]) {
      // The schema lets it through to the tool; with no database here the tool itself then fails,
      // which is not an input validation error.
      const r = await client
        .callTool({ name: 'record_submission', arguments: { ...base, ...extra } })
        .catch((err: unknown) => ({ isError: true, content: String(err) }));
      assert.doesNotMatch(JSON.stringify(r.content), /Input validation error/, JSON.stringify(extra));
    }
    // The schema an agent sees lets extra keys through on the token object.
    const { tools } = await client.listTools();
    const rec = tools.find((t) => t.name === 'record_submission')!;
    const tokenSchema = JSON.stringify((rec.inputSchema.properties as Record<string, unknown>).token);
    assert.doesNotMatch(tokenSchema, /"additionalProperties":false/);
  } finally {
    console.error = errLog;
    await client.close();
  }
});

test('v2.6 Ruling 5 (plan): record_submission takes builder_submitted, and says when it counts', async () => {
  const { tools } = await listed({});
  const rec = tools.find((t) => t.name === 'record_submission')!;
  const field = (rec.inputSchema.properties as Record<string, { type?: string; description?: string }>).builder_submitted;
  assert.ok(field, 'builder_submitted is in the schema');
  assert.equal(field.type, 'boolean');
  assert.match(field.description ?? '', /confirmed the entry is submitted on the program site/);
  assert.ok(!(rec.inputSchema.required ?? []).includes('builder_submitted'));
  assert.match(rec.description ?? '', /builder_submitted: true/);
  assert.match(rec.description ?? '', /no public entry page, or its page blocks EarnKit/);
  assert.match(rec.description ?? '', /Did you submit on <program site>\?/);
});

test('v2.4: the instructions say every reply may open with since_you_last_checked, shown first', async () => {
  const { instructions } = await listed({});
  assert.match(instructions, /since_you_last_checked/);
});

test('v2.4: the instructions say record_submission is the campaign entry (while a campaign is open)', async () => {
  const { instructions } = await listed({}, { campaignOpen: true });
  assert.match(instructions, /EarnKit campaigns: record_submission is the entry; there is no other site\./);
  assert.doesNotMatch(instructions, /Call\s+record_submission only after it was really submitted/);
});

test('v2.8 Part C: the instructions say every entry gets a token by default; one yes launches it and returns the kit; skip costs the bonus', async () => {
  const { instructions } = await listed({});
  assert.ok(
    instructions.includes(
      'Every entry gets a token by default. The builder confirms once: "yes" launches the token and returns the submit kit; "skip" means no token and no builder bonus. Push the token line from prepare_submission with your work, before the builder confirms.',
    ),
  );
  assert.match(instructions, /Pass the wallet shown \(shown_wallet\) back as confirm_entry's wallet\./);
  assert.match(instructions, /Write and push earnkit\.txt yourself; never ask the builder to edit files\./);
  assert.doesNotMatch(instructions, /A token is optional: entering never needs one\./);
});

test('v2.6 §3 fix round 1 (I3): the instructions cover the entry-link ask, wallet memory, and never naming tools to the builder', async () => {
  const { instructions } = await listed({});
  assert.match(
    instructions,
    /ask the builder 'Did you submit on <program site>\?' and, when the site gives each entry a public page, ask for that entry link and pass it as external_submission_url\./,
  );
  assert.match(instructions, /EarnKit remembers the wallet and shows it next time: confirm it, never ask again from scratch\./);
  assert.match(instructions, /Never name EarnKit tools, fields or files to the builder; say what happens in plain words\./);
});

test('v2.6 §1: list_programs says it leads with the qualify hook with repos, or "$X is open right now" without', async () => {
  const { tools } = await listed({});
  const d = tools.find((t) => t.name === 'list_programs')!.description!;
  assert.match(d, /leads with "EarnKit matches you to \$X in prizes you qualify for"/);
  assert.match(d, /or "\$X in prizes open right now" with ideas you can build when there is no repo/);
  assert.match(d, /Every program shows its difficulty; the token and builder bonus line closes the message\./);
  assert.doesNotMatch(d, /top prizes/);
});

test('Ruling 13 (plan): the local_repos item schema accepts a url', async () => {
  const { tools } = await listed({});
  const lp = tools.find((t) => t.name === 'list_programs')!;
  const localRepos = (lp.inputSchema.properties as Record<string, unknown>).local_repos as {
    items: { properties: Record<string, unknown> };
  };
  assert.ok('url' in localRepos.items.properties, JSON.stringify(localRepos.items.properties));
});

/** v2.8.1 §B6 (fix round 1, review Critical 1): every odd shape an agent sends to list_programs. */
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

test('v2.8.1 §B6 (fix round 1): every odd list_programs input passes the MCP schema; with a database, the call succeeds', async () => {
  const db = Boolean(process.env.DATABASE_URL);
  const installationId = db
    ? (await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t3fix-${process.pid}-${Date.now()}`}) RETURNING id`)[0].id
    : 1;
  // GitHub is never read here: matching is stubbed.
  const server = createMcpServer({
    installationId,
    roundPoolsWei: async () => new Map(),
    repoCoins: async () => new Map(),
    matchProjects: async () => ({ checked: 0, fits: [] }),
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const errLog = console.error;
  console.error = () => {};
  try {
    for (const args of ODD_LIST_INPUTS) {
      const r = await client
        .callTool({ name: 'list_programs', arguments: args })
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

test('v2.6: the coin needs one ticker-free line the agent pushes; no wallet line, no live link', async () => {
  assert.ok(OWNERSHIP_FOR_TOKEN.includes('token: <code>'));
  assert.ok(OWNERSHIP_FOR_TOKEN.includes('never ask the builder to edit files'));
  for (const gone of ['payout_wallet', '<SYMBOL>', 'live link'])
    assert.ok(!OWNERSHIP_FOR_TOKEN.includes(gone), gone);
  const { tools } = await listed({});
  const launch = tools.find((t) => t.name === 'launch_token')!.description!;
  assert.ok(launch.includes('after you pushed earnkit.txt or the builder gave a wallet (creator_wallet)'));
  assert.ok(!launch.includes('live link'));
  for (const name of ['prepare_submission', 'record_submission', 'launch_token'])
    assert.ok(tools.find((t) => t.name === name)!.description!.includes(OWNERSHIP_FOR_TOKEN), name);
});

test('v2.7 §2: get_program tells the agent to show guide.text as written', () => {
  assert.match(TOOL_DESCRIPTIONS.get_program, /guide\.text is the program's guide .*show it as written/);
});

test('v2.7 §3, Ruling 15/18 (plan): prepare_submission says what not ready means; no tool names Clanker', () => {
  assert.match(TOOL_DESCRIPTIONS.prepare_submission, /When ready is false/);
  // v2.8 Part C: the offer replaces the row outside campaigns; campaigns keep it (while one is open).
  assert.match(TOOL_DESCRIPTIONS.prepare_submission, /one Token row \(a token on Base\)/);
  assert.match(toolDescriptions(false).prepare_submission, /it ends with the confirmation offer/);
  assert.doesNotMatch(toolDescriptions(false).prepare_submission, /Token row|submission link/);
  for (const [name, d] of Object.entries(TOOL_DESCRIPTIONS)) assert.doesNotMatch(d, /clanker|protocol cut/i, name);
});

// ---- v2.8 Ruling 23 (plan): campaign-only agent text, hidden while no EarnKit campaign is open.
test('v2.8 Ruling 23 (plan): SERVER_INSTRUCTIONS opens with what EarnKit does, never "runs its own campaigns"', () => {
  assert.equal(
    SERVER_INSTRUCTIONS.split('\n')[0],
    'EarnKit finds live grants and hackathons a builder can win, helps them write strong applications, and gives every entry a token whose fees fund the builder bonus.',
  );
  assert.doesNotMatch(SERVER_INSTRUCTIONS, /runs its own campaigns/);
});

test('v2.8 Ruling 23 (plan): toolDescriptions(false) drops the campaign sentences; (true) keeps them', () => {
  const closed = toolDescriptions(false);
  const open = toolDescriptions(true);
  for (const name of ['record_submission', 'prepare_submission'] as const) {
    for (const word of ['EarnKit campaign', 'how_to_submit', 'sign_to_enter', 'EIP-191'])
      assert.ok(!closed[name].includes(word), `${name} (closed): ${word}`);
    assert.match(open[name], /EarnKit campaign/, name);
  }
  assert.match(open.record_submission, /how_to_submit/);
  assert.deepEqual(TOOL_DESCRIPTIONS, open);
  // The rest of the text stays.
  assert.match(closed.record_submission, /Did you submit on <program site>\?/);
  assert.match(closed.prepare_submission, /shown_wallet is the wallet on that line/);
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
    const rec = tools.find((t) => t.name === 'record_submission')!;
    const props = rec.inputSchema.properties as Record<string, { description?: string }>;
    assert.ok(props.deployer_signature, 'deployer_signature stays registered');
    assert.ok(props.contracts, 'contracts stays registered');
    assert.doesNotMatch(props.deployer_signature.description ?? '', /EarnKit campaigns/);
    assert.match(props.deployer_signature.description ?? '', /deployed by a wallet other than payout_wallet/);
    assert.doesNotMatch(props.contracts.description ?? '', /EarnKit campaigns/);
    assert.equal(rec.description, toolDescriptions(false).record_submission);
    assert.equal(tools.find((t) => t.name === 'prepare_submission')!.description, toolDescriptions(false).prepare_submission);
  }
  const open = (await registered({ campaignOpen: true })).find((t) => t.name === 'record_submission')!;
  const props = open.inputSchema.properties as Record<string, { description?: string }>;
  assert.match(props.deployer_signature.description ?? '', /EarnKit campaigns/);
  assert.equal(open.description, toolDescriptions(true).record_submission);
});

test('v2.8 Task 5 fix round 1: serverInstructions(false) drops the campaign sentence; the server sends it at initialize', async () => {
  const closed = serverInstructions(false);
  assert.doesNotMatch(closed, /EarnKit campaign/);
  assert.doesNotMatch(closed, /Other programs:/);
  assert.match(closed, /^Before record_submission, ask the builder 'Did you submit on <program site>\?'/m);
  assert.equal(SERVER_INSTRUCTIONS, serverInstructions(true));
  assert.match(SERVER_INSTRUCTIONS, /EarnKit campaigns: record_submission is the entry; there is no other site\./);
  assert.equal((await listed({})).instructions, closed);
  assert.equal((await listed({}, { campaignOpen: true })).instructions, SERVER_INSTRUCTIONS);
  // payout_wallet: no "Other programs:" contrast while no campaign is open.
  const pw = (open?: boolean) => {
    const rec = (open === undefined ? listed({}) : listed({}, { campaignOpen: open })).then((l) => l.tools.find((t) => t.name === 'record_submission')!);
    return rec.then((r) => (r.inputSchema.properties as Record<string, { description?: string }>).payout_wallet.description ?? '');
  };
  assert.match(await pw(), /^The wallet the builder confirmed/);
  assert.match(await pw(true), /^Other programs: the wallet the builder confirmed/);
});

test('v2.8 Part C: confirm_entry is registered, strict, and says the kit is only in its reply', async () => {
  const tools = await registered();
  const ce = tools.find((t) => t.name === 'confirm_entry')!;
  assert.equal(ce.description, TOOL_DESCRIPTIONS.confirm_entry);
  assert.match(ce.description!, /builder_confirmed: true and decision: 'go' once the builder says yes/);
  assert.match(ce.description!, /decision: 'skip' only when the builder says skip/);
  assert.match(ce.description!, /The kit is only in this reply; never show a kit any other way\./);
  const props = ce.inputSchema.properties as Record<string, unknown>;
  for (const k of ['program_id', 'project', 'answers', 'decision', 'builder_confirmed', 'token', 'wallet', 'agent']) assert.ok(k in props, k);
  assert.ok('agent' in ((tools.find((t) => t.name === 'prepare_submission')!.inputSchema.properties) as Record<string, unknown>));
  const server = createMcpServer({ installationId: 1 });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const r = await client.callTool({ name: 'confirm_entry', arguments: { program_id: 'p', project: { name: 'Kit' }, answers: {}, ticker: 'KITS' } });
    assert.equal(r.isError, true);
    assert.match(JSON.stringify(r.content), /Unrecognized key/);
  } finally {
    await client.close();
  }
});

test('3.9 tell_earnkit replaces report_outcome: 8 tools, it writes, list_programs stays read-only; no description names report_outcome', async () => {
  const { tools } = await listed({});
  assert.equal(tools.length, 8);
  const list = tools.find((t) => t.name === 'list_programs')!;
  assert.equal(list.annotations?.readOnlyHint, true);
  assert.ok(!tools.some((t) => t.name === 'report_outcome'));
  const tell = tools.find((t) => t.name === 'tell_earnkit')!;
  assert.deepEqual(tell.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.deepEqual(Object.keys((tell.inputSchema as { properties: object }).properties).sort(), ['program_status', 'repo_facts', 'signed_in', 'weekly_email']);
  // v2.9 B10 (Pre-flight P45): launch_token takes the first reply's offer, the answer and the agent.
  const launch = tools.find((t) => t.name === 'launch_token')!;
  const props = (launch.inputSchema as { properties: object; required?: string[] });
  for (const k of ['offer', 'decision', 'agent', 'project_id']) assert.ok(k in props.properties, k);
  assert.ok(!(props.required ?? []).includes('project_id'));
  assert.ok(launch.description!.length < 800, `${launch.description!.length} characters`);
  assert.match(launch.description!, /After the first reply's token offer, pass offer \(program_id, repo_url, project_name from token_offer\) and decision: 'go' on yes, 'skip' on skip\./);
  assert.match(list.description!, /pass their answer to tell_earnkit/);
  assert.ok(tell.description!.length < 800, `${tell.description!.length} characters`);
  assert.match(tell.description!, /Call it only with what the builder said/);
  for (const t of tools) assert.doesNotMatch(t.description ?? '', /report_outcome/, t.name);
  for (const d of Object.values(TOOL_DESCRIPTIONS)) assert.doesNotMatch(d, /report_outcome/);
});

test('v2.8.1 §C15: an unexpected error is logged on the server with an id; the agent sees a plain message with that id, never the raw error', async () => {
  const server = createMcpServer({ installationId: 1 });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const original = toolImpls.tell_earnkit;
  const errLog = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => void logged.push(args);
  (toolImpls as Record<string, unknown>).tell_earnkit = async () => {
    throw new Error('Connection terminated unexpectedly');
  };
  try {
    const r = await client.callTool({ name: 'tell_earnkit', arguments: { program_status: [{ program_id: 'p', status: 'won' }] } });
    assert.equal(r.isError, true);
    const text = (r.content as { text: string }[])[0].text;
    const id = /error id ([0-9a-f]{8})\.$/.exec(text)?.[1];
    assert.ok(id, text);
    assert.equal(text, unexpectedErrorText(id!));
    assert.doesNotMatch(text, /Connection terminated|tell_earnkit/);
    // The server log has the tool, the same id and the error's name, message and stack.
    const line = logged.find((l) => String(l[0]).includes(id!));
    assert.ok(line, JSON.stringify(logged.map((l) => String(l[0]))));
    assert.match(String(line![0]), /^\[mcp\] tell_earnkit error [0-9a-f]{8}$/);
    assert.match((line![1] as { message: string }).message, /Connection terminated unexpectedly/);
    // M6: name, message and stack only.
    assert.deepEqual(Object.keys(line![1] as object).sort(), ['message', 'name', 'stack']);
  } finally {
    (toolImpls as Record<string, unknown>).tell_earnkit = original;
    console.error = errLog;
    await client.close();
  }
});

test('v2.8.1 §C15: the safety line no longer forbids making a repo public; it says a token needs one', () => {
  const line = SAFETY_LINES.find((l) => l.startsWith('Entering a program never needs'))!;
  assert.doesNotMatch(line, /visibility/);
  assert.match(line, /A token needs a public repo; make a repo public only when the builder asks\./);
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

test('11.8 (F25): confirm_entry and sponsor_campaign descriptions under 800 characters; their rules are in the replies', () => {
  assert.ok(TOOL_DESCRIPTIONS.confirm_entry.length < 800, `confirm_entry: ${TOOL_DESCRIPTIONS.confirm_entry.length}`);
  assert.ok(TOOL_DESCRIPTIONS.sponsor_campaign.length < 800, `sponsor_campaign: ${TOOL_DESCRIPTIONS.sponsor_campaign.length}`);
  // confirm_entry keeps when to call it, its inputs and "show show_to_builder as written".
  for (const k of ["decision: 'go'", "decision: 'skip'", 'wallet', 'token: { name, symbol }', 'agent: { browser, can_push }', 'show_to_builder exactly as written'])
    assert.ok(TOOL_DESCRIPTIONS.confirm_entry.includes(k), k);
  // sponsor_campaign keeps its three actions and their inputs.
  for (const k of ['action=create', 'action=status', 'action=award', 'sponsor_name', 'sponsor_wallet', 'replaces=', 'winners'])
    assert.ok(TOOL_DESCRIPTIONS.sponsor_campaign.includes(k), k);
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
