/**
 * v3.8 G-A item 7: BNB Chain in the chain registry. The acceptance run could not write Binance Wallet x BNB Chain's
 * Agent ID Hackathon because `bnb` was not a known chain; these fail on main and pass with the registry entry.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN_REGISTRY, chainName, chainOfId, chainSlugOf, isKnownChain } from './chains';
import { ProgramFile } from './program-file';
import { programProblems } from './program-checks';
import { apiRuleProblems } from './programs-api';
import { parseProject } from './project-input';
import { detectCode } from './repo-facts';

const NOW = new Date('2026-11-24T12:00:00Z');
const BINANCE = 'https://www.binance.com/en/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf';

/** The Agent ID Hackathon as Growth would write it, from the Binance announcement's title and terms. */
const agentId = {
  id: 'binance-agent-id-hackathon',
  organizer: 'Binance Wallet x BNB Chain',
  title: 'Agent ID Hackathon',
  description: 'A Binance Wallet and BNB Chain hackathon for agents that use an on-chain Agent ID, with 60,000 USDC worth of rewards.',
  source_url: BINANCE,
  submission_url: BINANCE,
  reward: '60,000 USDC in prizes',
  summary: '$60,000 in rewards · rolling',
  pool_usd: 60_000,
  category: 'hackathon',
  starts_at: null,
  ends_at: null,
  status: 'active',
  verified_at: '2026-11-24',
  existing_work: 'new_work_only',
  needs_repo: false,
  chains: ['bnb'],
  chain_required: true,
  in_person: false,
  setup: [],
  each_time: [],
  rules: [],
  submission_requirements: [
    { key: 'project_name', label: 'Project name', type: 'text', required: true, from: 'project', kind: 'name', todo: 'a project name' },
  ],
};

test('G-A 7: bnb is a registered EVM chain: 56 mainnet, 97 testnet, BscScan explorer, no keyless reader', () => {
  assert.equal(isKnownChain('bnb'), true);
  assert.equal(chainName('bnb'), 'BNB Chain');
  assert.deepEqual(chainOfId(56), { chain: 'bnb', mainnet: true });
  assert.deepEqual(chainOfId(97), { chain: 'bnb', mainnet: false });
  assert.equal(CHAIN_REGISTRY.bnb.evm, true);
  assert.equal(CHAIN_REGISTRY.bnb.explorer, 'https://bscscan.com');
  assert.equal(CHAIN_REGISTRY.bnb.explorer_api, null);
});

test('G-A 7: chainSlugOf reads a slug or an alias in any case and spacing, never an unknown name', () => {
  for (const name of ['bnb', 'BNB', 'bsc', 'BSC', 'BNB Chain', 'bnb-chain', 'bnb_chain', 'bnbchain', 'BNB Smart Chain', 'Binance Smart Chain', ' binance-smart-chain '])
    assert.equal(chainSlugOf(name), 'bnb', name);
  assert.equal(chainSlugOf('Base'), 'base');
  assert.equal(chainSlugOf('foo'), null);
  assert.equal(chainSlugOf('toString'), null);
  // An alias is never a slug of its own: a program file names `bnb`.
  assert.equal(isKnownChain('bsc'), false);
});

test('G-A 7: the Binance Agent ID program with chains ["bnb"] passes the schema, programs:check and the API rules', () => {
  const parsed = ProgramFile.safeParse(agentId);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.deepEqual(programProblems(parsed.data, NOW), []);
  assert.deepEqual(apiRuleProblems(parsed.data, NOW), []);
  assert.ok(!ProgramFile.safeParse({ ...agentId, chains: ['bsc'] }).success, 'a program file names the slug, not an alias');
});

test('G-A 7: an agent-reported BNB chain reads as bnb, by alias, network word or chain id', () => {
  const c = '0x' + 'b'.repeat(40);
  const forms: [unknown, boolean][] = [
    [{ chain: 'bnb', mainnet: true, contract: c }, true],
    [{ chain: 'bsc', mainnet: true, contract: c }, true],
    [{ chain: 'BNB Chain', mainnet: true, contract: c }, true],
    [{ chain_id: 56, contract: c }, true],
    [{ chain: 'bsc-testnet', contract: c }, false],
    [{ chain: 'bnb', chain_id: 97, contract: c }, false],
    [{ chain: 'binance smart chain', testnet: true, contract: c }, false],
  ];
  for (const [entry, mainnet] of forms) {
    const r = parseProject({ name: 'Agent', description: 'An agent with an ID.', chains: [entry] });
    assert.ok(r.ok);
    assert.deepEqual(r.problems, [], JSON.stringify(entry));
    assert.deepEqual(r.project.chains?.map((x) => [x.chain, x.mainnet]), [['bnb', mainnet]], JSON.stringify(entry));
  }
});

test('G-A 7: repo code naming BNB Smart Chain is detected: viem imports, RPC and BscScan hosts, testnet hosts kept apart', () => {
  const pick = (cs: { chain: string; mainnet: boolean }[]) => cs.map(({ chain, mainnet }) => ({ chain, mainnet }));
  const chains = (text: string) => pick(detectCode([{ path: 'src/config.ts', text }], []).chains);
  assert.deepEqual(chains("import { bsc } from 'viem/chains';"), [{ chain: 'bnb', mainnet: true }]);
  assert.deepEqual(chains("import { bscTestnet } from 'viem/chains';"), [{ chain: 'bnb', mainnet: false }]);
  assert.deepEqual(chains('const rpc = "https://bsc-dataseed.bnbchain.org";'), [{ chain: 'bnb', mainnet: true }]);
  assert.deepEqual(chains('see https://testnet.bscscan.com/address/0x1'), [{ chain: 'bnb', mainnet: false }]);
  assert.deepEqual(pick(detectCode([], ['broadcast/Deploy.s.sol/56/run-latest.json']).chains), [{ chain: 'bnb', mainnet: true }]);
});
