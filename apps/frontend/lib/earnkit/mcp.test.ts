import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { escrowConfig, escrowConfigProblem } from './escrow';
import { createMcpServer } from './mcp';
import { SAFETY_LINES } from './untrusted-text';

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

test('a misnamed token key is an error, not silently dropped', async () => {
  const server = createMcpServer({ installationId: 1 });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const errorText = async (name: string, args: Record<string, unknown>) => {
    try {
      const r = await client.callTool({ name, arguments: args });
      assert.equal(r.isError, true);
      return JSON.stringify(r.content);
    } catch (err) {
      return String(err);
    }
  };
  try {
    // Rejected by the input schema, before the tool runs (so no database is touched).
    assert.match(
      await errorText('launch_token', { project_id: 7, builder_confirmed: true, ticker: 'KITS' }),
      /Unrecognized key: \\"ticker\\"/,
    );
    assert.match(
      await errorText('record_submission', {
        program_id: 'p',
        project: { name: 'Kit' },
        submission_data: {},
        token: { name: 'Kit', ticker: 'KITS' },
      }),
      /Unrecognized key: \\"ticker\\" at token/,
    );
  } finally {
    await client.close();
  }
});
