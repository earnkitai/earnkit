import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { escrowConfig, escrowConfigProblem } from './escrow';
import { CONFIRM_BACKING_DESCRIPTION, FIND_DESCRIPTION_BENCH, TELL_DESCRIPTION_BENCH, TELL_DESCRIPTION_BENCH_NO_RAISING, SERVER_INSTRUCTIONS, errorSummary, TOOL_DESCRIPTIONS, createMcpServer, serverInstructions, toolDescriptions, unexpectedErrorText } from './mcp';
import { handlers } from './tools';
import { OLD_TOOL_NAMES, STALE_TOOLS_NOTE, aliasCall, withOlderNames } from './aliases';
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
import { withEnv } from './fixtures/find';

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

test('confirm is strict: a misnamed key is an error, not silently dropped (v3.1: a program_id too)', () => withEnv({ EARNKIT_RAISING: 'on' }, async () => {
  const client = await connected();
  try {
    // Rejected by the input schema, before the tool runs (so no database is touched).
    for (const args of [
      { project_id: 7, yes: true, ticker: 'KITS' },
      { project_id: 7, program_id: 'p', yes: true },
    ]) {
      const r = await client.callTool({ name: 'confirm', arguments: args });
      assert.equal(r.isError, true);
      assert.match(JSON.stringify(r.content), /Unrecognized key/);
    }
  } finally {
    await client.close();
  }
}));

test('v3.1 (spec 3.4): an old record_submission call, aliased to confirm, never enters: confirm is not listed (flag off) or refuses program_id (flag on)', async () => {
  const next = aliasCall('record_submission', { program_id: 'p', project: { name: 'Kit' }, submission_data: {}, builder_confirmed: true })!;
  assert.equal(next.name, 'confirm');
  for (const raising of [undefined, 'on']) {
    const r = await withEnv({ EARNKIT_RAISING: raising }, async () => {
      const client = await connected();
      try {
        return await client.callTool({ name: next.name, arguments: next.args }).catch((err: unknown) => ({ isError: true, content: String(err) }));
      } finally {
        await client.close();
      }
    });
    assert.equal(r.isError, true, String(raising));
    assert.match(JSON.stringify(r.content), raising ? /Unrecognized keys: \\"program_id\\"/ : /Tool confirm not found/, String(raising));
  }
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

test('v3.1 (spec 3.4): prepare only drafts (never submits, never the confirm line, no Token row); no tool names Clanker', () => {
  assert.match(TOOL_DESCRIPTIONS.prepare, /^Draft an application from the ship log\. .* It never submits: the builder sends the form\. Follow agent_note\./);
  for (const d of [TOOL_DESCRIPTIONS.prepare, toolDescriptions(false).prepare, toolDescriptions(true).prepare])
    assert.doesNotMatch(d, /confirm|Token row|submission link|coach_asked|ready is true/);
  for (const [name, d] of Object.entries(TOOL_DESCRIPTIONS)) assert.doesNotMatch(d, /clanker|protocol cut/i, name);
});

// ---- v2.8 Ruling 23 (plan): campaign-only agent text, hidden while no EarnKit campaign is open.
test('v2.8 Ruling 23 (plan): SERVER_INSTRUCTIONS never says EarnKit "runs its own campaigns"', () => {
  assert.doesNotMatch(SERVER_INSTRUCTIONS, /runs its own campaigns/);
});

test('v3.1 (spec 3.4): no tool text depends on an open campaign; prepare names build only while deploys are on', () => {
  assert.deepEqual(toolDescriptions(true), toolDescriptions(false));
  for (const word of ['EarnKit campaign', 'how_to_submit', 'sign_to_enter', 'EIP-191'])
    for (const [name, d] of Object.entries(TOOL_DESCRIPTIONS)) assert.ok(!d.includes(word), `${name}: ${word}`);
  // v2.11 T8 review M2: TOOL_DESCRIPTIONS is the longest variant (build listed), confirm kept for the copy scan.
  assert.deepEqual(TOOL_DESCRIPTIONS, { ...toolDescriptions(true, true), confirm: CONFIRM_BACKING_DESCRIPTION });
  assert.equal(toolDescriptions(true, false).prepare, toolDescriptions(false).prepare, 'deploys off in the test env');
  assert.match(toolDescriptions(false, true).prepare, / build: a build_offer yes\.$/);
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

test('v3.1 (spec 3.4, D1): confirm is listed only with EARNKIT_RAISING on, strict, for Backing only (project_id required, no entry fields)', async () => {
  for (const opts of [{ campaignOpen: false }, { campaignOpen: true }, undefined])
    assert.ok(!(await withEnv({ EARNKIT_RAISING: undefined }, () => registered(opts))).some((t) => t.name === 'confirm'));
  for (const opts of [{ campaignOpen: false }, { campaignOpen: true }]) {
    const tools = await withEnv({ EARNKIT_RAISING: 'on' }, () => registered(opts));
    const confirm = tools.find((t) => t.name === 'confirm')!;
    assert.equal(confirm.description, CONFIRM_BACKING_DESCRIPTION);
    assert.deepEqual(confirm.inputSchema.required, ['project_id']);
    const props = confirm.inputSchema.properties as Record<string, unknown>;
    assert.deepEqual(Object.keys(props).sort(), ['agent', 'builder_x', 'check', 'image_data', 'image_url', 'project_id', 'signed_in', 'token', 'wallet', 'yes']);
    // v2.14 final fix: an older agent's sign-in code is still accepted (confirm is strict), and only said to be ignored.
    assert.deepEqual(props.signed_in, { description: 'Not used any more; ignored.' });
    assert.equal(tools.find((t) => t.name === 'prepare')!.description, toolDescriptions(false).prepare);
  }
  const prep = (await registered()).find((t) => t.name === 'prepare')!.inputSchema.properties as Record<string, unknown>;
  assert.ok('agent' in prep);
  // v2.14 final fix: the shared client's GitHub sign-in code is gone (Ruling T6-2).
  assert.ok(!('signed_in' in prep));
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
  // v3.1 (spec 3.4): confirm keeps when to call it (Backing), its inputs and to follow agent_note; never an entry.
  for (const k of ['Backing', 'yes: true', 'wallet', 'token', 'check: true', 'project_id', 'agent_note'])
    assert.ok(TOOL_DESCRIPTIONS.confirm.includes(k), k);
  assert.doesNotMatch(TOOL_DESCRIPTIONS.confirm, /program_id|skip_token|entry|submit/);
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

const identityWords = (t: { inputSchema: { properties?: Record<string, object> } }) =>
  (t.inputSchema.properties?.identity as { description?: string } | undefined)?.description;

test('2.8 flag on: find asks for identity.project (one, never a list) and stays under 800 characters', async () => {
  const d = toolDescriptions(false).find;
  assert.equal(d, FIND_DESCRIPTION_BENCH);
  assert.ok(d.length < 800, `${d.length}`);
  assert.match(d, /identity\.project/);
  assert.match(d, /never a list/);
  const on = (await listed({})).tools.find((t) => t.name === 'find')!;
  assert.equal(on.description, FIND_DESCRIPTION_BENCH);
  assert.match(identityWords(on) ?? '', /project: the project in this folder/);
  assert.match(identityWords(on) ?? '', /One project, never a list\.$/);
});

test('5.11 tell lists update and updates and stays under 800 characters', () => {
  try {
    // Final fix: EARNKIT_RAISING off, coin takes no { raising } (the description names none).
    assert.equal(toolDescriptions(false).tell, TELL_DESCRIPTION_BENCH_NO_RAISING);
    assert.ok(!TELL_DESCRIPTION_BENCH_NO_RAISING.includes('raising'));
    process.env.EARNKIT_RAISING = 'on';
    const d = toolDescriptions(false).tell;
    assert.equal(d, TELL_DESCRIPTION_BENCH);
    assert.ok(d.length < 800, `${d.length}`);
    // F20: coin { raising } is Task 9's, listed only with EARNKIT_RAISING on.
    for (const w of ['update: { text }', 'hide', 'updates: { titles', 'raising']) assert.ok(d.includes(w), w);
  } finally {
    delete process.env.EARNKIT_RAISING;
  }
});

test('O2.6 the server instructions (under 800), no old entry-and-token flow; find names move_up, not build_offer\'s note', async () => {
  {
    const on = serverInstructions();
    assert.ok(on.length < 800, String(on.length));
    assert.ok(on.startsWith('Call find first. Show show_to_builder exactly as written and follow every agent_note.\nA yes or no to the last line goes to tell move_up.\nCall score when they ask where they stand.\nNever name tools, fields or files to the builder'));
    assert.doesNotMatch(on, /launches the token|submits the entry|since_you_last_checked|prepare until ready/);
    for (const line of SAFETY_LINES) assert.ok(on.includes(line));
    assert.equal((await listed({})).instructions, on);
    assert.doesNotMatch(FIND_DESCRIPTION_BENCH, /build_offer|A yes prepares/);
    assert.match(FIND_DESCRIPTION_BENCH, /A yes or no to the last line goes to tell move_up\./);
    assert.ok(FIND_DESCRIPTION_BENCH.length < 800);
  }
});

// ---- Restored in v2.14 T3 fix round 1: the tool list's live rules (four tools, no old name, the alias route) ----
const toolNames = async (env: Record<string, string | undefined>) =>
  (await listed(env)).tools.map((t) => t.name).sort();

// v2.10 item 4, v2.14, v3.1 (spec 3.4): the 4 builder tools (find, prepare, tell, score; confirm only with EARNKIT_RAISING
// on); the 8 v2.9 names are aliases only.
const FOUR = ['find', 'prepare', 'score', 'tell'];
const oldNameRe = new RegExp(`\\b(${OLD_TOOL_NAMES.join('|')})\\b`);
/** v2.10.1 B5: a reply object's agent strings in a stale client's words (aliases.ts forOldClient, minus the note). */
const oldWords = (v: unknown, used: string): unknown =>
  typeof v === 'string' ? withOlderNames(v, used) : Array.isArray(v) ? v.map((x) => oldWords(x, used)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /^show_to_|^question$/.test(k) ? x : oldWords(x, used)])) : v;
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };

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

test('9.2 the instructions and each description: under 800 characters, no old tool name, no em dash', async () => {
  for (const open of [true, false]) {
    const texts: [string, string][] = [
      ['serverInstructions()', serverInstructions()],
      ...Object.entries(toolDescriptions(open)).map(([k, v]): [string, string] => [`${k} (${open})`, v]),
    ];
    for (const [label, text] of texts) {
      assert.ok(text.length < 800, `${label}: ${text.length}`);
      assert.doesNotMatch(text, oldNameRe, label);
      assert.doesNotMatch(text, /—/, label);
    }
  }
  // The registered text is the same text.
  const { tools, instructions } = await listed({ ESCROW_FACTORY_ADDRESS: FACTORY });
  assert.equal(instructions, serverInstructions());
  for (const t of tools) {
    assert.equal(t.description, toolDescriptions(false)[t.name as keyof ReturnType<typeof toolDescriptions>], t.name);
    assert.doesNotMatch(JSON.stringify(t.inputSchema), oldNameRe, t.name);
  }
});

test('3.9, R16: tell writes and find stays read-only; tell takes submitted and the v2.9 statements (v2.14 T7: no pickup); no description names report_outcome', async () => {
  const { tools } = await listed({});
  assert.equal(tools.length, 4);
  assert.equal(tools.find((t) => t.name === 'find')!.annotations?.readOnlyHint, true);
  assert.ok(!tools.some((t) => t.name === 'report_outcome'));
  const tell = tools.find((t) => t.name === 'tell')!;
  assert.equal(tell.annotations?.readOnlyHint, false);
  const props = Object.keys((tell.inputSchema as { properties: object }).properties);
  for (const k of ['program_status', 'repo_facts', 'submitted', 'weekly_email']) assert.ok(props.includes(k), k);
  assert.ok(props.includes('signed_in'), 'v2.14 final fix: an older agent\'s signed_in is accepted (strict schema) and ignored');
  assert.ok(!props.includes('pickup'), 'v2.14 T7: no pickup');
  assert.match(tell.description!, /call it only with what they said/);
  for (const t of tools) {
    assert.ok(t.description!.length < 800, `${t.name}: ${t.description!.length} characters`);
    assert.doesNotMatch(t.description ?? '', /report_outcome|token_offer/, t.name);
  }
  for (const d of Object.values(TOOL_DESCRIPTIONS)) assert.doesNotMatch(d, /report_outcome/);
});

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
