import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { escrowConfig, escrowConfigProblem } from './escrow';
import { OWNERSHIP_FOR_TOKEN, TOOL_DESCRIPTIONS, createMcpServer } from './mcp';
import { SAFETY_LINES } from './untrusted-text';
import { sql } from './db';

// Tool replies read alerts from the database when DATABASE_URL is set: close the pool.
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const FACTORY = '0x00000000000000000000000000000000000000fa';

async function listed(env: Record<string, string | undefined>) {
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
    const server = createMcpServer({ installationId: 1 });
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

const FIVE = [
  'get_program',
  'launch_token',
  'list_programs',
  'prepare_submission',
  'record_submission',
];

test('without escrow config the server offers exactly the 5 builder tools', async () => {
  assert.deepEqual(await toolNames({}), FIVE);
});

test('an invalid ESCROW_CHAIN keeps sponsor_campaign hidden', async () => {
  assert.deepEqual(
    await toolNames({
      ESCROW_FACTORY_ADDRESS: FACTORY,
      ESCROW_CHAIN: 'mainnet',
    }),
    FIVE,
  );
});

test('a configured escrow adds sponsor_campaign', async () => {
  assert.deepEqual(
    await toolNames({
      ESCROW_FACTORY_ADDRESS: FACTORY,
      ESCROW_CHAIN: 'base-sepolia',
    }),
    [...FIVE, 'sponsor_campaign'].sort(),
  );
  assert.deepEqual(
    await toolNames({ ESCROW_FACTORY_ADDRESS: FACTORY }), // ESCROW_CHAIN defaults to base
    [...FIVE, 'sponsor_campaign'].sort(),
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

test('v2.4: the instructions say record_submission is the campaign entry', async () => {
  const { instructions } = await listed({});
  assert.match(instructions, /EarnKit campaigns: record_submission is the entry; there is no other site\./);
  assert.doesNotMatch(instructions, /Call\s+record_submission only after it was really submitted/);
});

test('v2.6 §3: the instructions say every entry gets a coin by default and one yes confirms the coin and the wallet', async () => {
  const { instructions } = await listed({});
  assert.match(instructions, /Every entry gets a coin by default; the builder can skip it in one word\./);
  assert.match(instructions, /One yes confirms the coin and the wallet\./);
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
  assert.match(d, /leads with "EarnKit matches you to \$X in open money you qualify for"/);
  assert.match(d, /or "\$X is open right now" with ideas you can build when there is no repo/);
  assert.match(d, /Every program shows its difficulty; the builder bonus closes the message\./);
});

test('Ruling 13 (plan): the local_repos item schema accepts a url', async () => {
  const { tools } = await listed({});
  const lp = tools.find((t) => t.name === 'list_programs')!;
  const localRepos = (lp.inputSchema.properties as Record<string, unknown>).local_repos as {
    items: { properties: Record<string, unknown> };
  };
  assert.ok('url' in localRepos.items.properties, JSON.stringify(localRepos.items.properties));
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
  assert.match(TOOL_DESCRIPTIONS.prepare_submission, /one Token row \(a token on Base\)/);
  for (const [name, d] of Object.entries(TOOL_DESCRIPTIONS)) assert.doesNotMatch(d, /clanker|protocol cut/i, name);
});
