import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectChains, pickFiles } from './match';
import {
  matchRepo,
  reportedFacts,
  type ProgramFacts,
  type RepoFacts,
} from './match';
import { ReportedRepoInput } from './match-projects';

test('detects chains from ids, rpc hosts, and viem imports; ignores stray numbers', () => {
  const d = detectChains([
    {
      path: 'hardhat.config.ts',
      text: 'networks: { arc: { url: "https://rpc.testnet.arc.io", chainId: 5042002 } }',
    },
    {
      path: 'src/wagmi.ts',
      text: "import { base, baseSepolia as bs } from 'viem/chains'",
    },
    { path: 'src/math.ts', text: 'const limit = 143; const x = [8453];' },
  ]);
  assert.deepEqual(Object.keys(d).sort(), ['arc', 'base']);
  assert.equal(d.arc!.testnet, true);
  assert.equal(d.arc!.mainnet, false);
  assert.equal(d.base!.mainnet, true);
  assert.equal(d.base!.testnet, true);
  assert.equal(d.monad, undefined);
});

test('picks config-like files, skips dependencies, prefers shallow paths', () => {
  const picked = pickFiles([
    { path: 'node_modules/viem/chains.ts', size: 10 },
    { path: 'lib/forge-std/foundry.toml', size: 10 },
    { path: 'src/lib/chains.ts', size: 10 },
    { path: 'package.json', size: 10 },
    { path: 'src/components/Button.tsx', size: 10 },
    { path: 'foundry.toml', size: 10 },
  ]);
  assert.deepEqual(picked, [
    'package.json',
    'foundry.toml',
    'src/lib/chains.ts',
  ]);
});

const programs: ProgramFacts[] = [
  {
    id: 'arc-micro',
    title: 'Arc Microgrants',
    chains: ['arc'],
    existing_work: 'allowed',
    tag: null,
    starts_at: null,
  },
  {
    id: 'circle',
    title: 'Circle Developer Grants',
    chains: ['arc'],
    existing_work: 'allowed',
    tag: 'needs a live product',
    starts_at: null,
  },
  {
    id: 'monad',
    title: 'Monad Metropolis',
    chains: ['monad'],
    existing_work: 'new_work_only',
    tag: 'long shot',
    starts_at: new Date('2026-09-01T00:00:00Z'),
  },
];

const repo = (over: Partial<RepoFacts>): RepoFacts => ({
  name: 'r',
  url: 'https://github.com/u/r',
  homepage: null,
  created_at: '2026-01-01T00:00:00Z',
  chains: {},
  commits_in_window: {},
  ...over,
});

test('arc testnet repo without a live link: one step away, names both steps', () => {
  const v = matchRepo(
    repo({ chains: { arc: { mainnet: false, testnet: true, evidence: 'x' } } }),
    programs,
  );
  assert.deepEqual(
    v.find((x) => x.program_id === 'arc-micro'),
    {
      program_id: 'arc-micro',
      program: 'Arc Microgrants',
      status: 'after_step',
      missing: ['mainnet_deploy', 'live_url'],
      effort: 'hours',
      note: 'needs a deploy on Arc mainnet and a live link',
    },
  );
  assert.equal(v.find((x) => x.program_id === 'circle')!.status, 'after_step');
});

test('arc mainnet repo with a homepage likely qualifies, with a check', () => {
  const v = matchRepo(
    repo({
      homepage: 'https://app.x',
      chains: { arc: { mainnet: true, testnet: false, evidence: 'x' } },
    }),
    programs,
  );
  assert.equal(v.find((x) => x.program_id === 'arc-micro')!.status, 'likely');
  assert.match(v.find((x) => x.program_id === 'circle')!.note!, /real users/);
});

test('new-work-only programs: active repos need new work, stale ones are out', () => {
  const chains = { monad: { mainnet: false, testnet: true, evidence: 'x' } };
  assert.equal(
    matchRepo(
      repo({ chains, commits_in_window: { monad: false } }),
      programs,
    )[0].status,
    'no',
  );
  const active = matchRepo(
    repo({ chains, commits_in_window: { monad: true } }),
    programs,
  )[0];
  assert.equal(active.status, 'after_step');
  assert.equal(active.note, 'only new work since Sep 1 counts');
});

test('repos on no program chain produce no verdicts', () => {
  assert.deepEqual(matchRepo(repo({}), programs), []);
});

test('agent-reported repos match like public ones, without reading any code', () => {
  const live = reportedFacts(
    {
      name: 'private-tipjar',
      chains: [{ chain: 'arc', mainnet: true }],
      live_url: 'https://tipjar.app',
    },
    programs,
  );
  assert.equal(live.homepage, 'https://tipjar.app');
  assert.equal(
    matchRepo(live, programs).find((x) => x.program_id === 'arc-micro')!.status,
    'likely',
  );

  const testnetOnly = reportedFacts(
    { name: 'wip', chains: [{ chain: 'arc', mainnet: false }] },
    programs,
  );
  assert.deepEqual(
    matchRepo(testnetOnly, programs).find((x) => x.program_id === 'arc-micro')!
      .missing,
    ['mainnet_deploy', 'live_url'],
  );

  // Last commit before a new-work-only program started: out. Unknown date: still a candidate.
  const monad = [{ chain: 'monad' as const, mainnet: false }];
  const stale = reportedFacts(
    { name: 's', chains: monad, last_commit_at: '2020-01-01T00:00:00Z' },
    programs,
  );
  assert.equal(matchRepo(stale, programs)[0].status, 'no');
  assert.equal(
    matchRepo(
      reportedFacts({ name: 'u', chains: monad }, programs),
      programs,
    )[0].status,
    'after_step',
  );
});

test('Ruling 13 (plan): reportedFacts keeps a GitHub repo link, drops anything else', () => {
  assert.equal(
    reportedFacts({ name: 'tipjar', chains: [], url: 'https://github.com/Acme/TipJar.git' }, [])
      .url,
    'https://github.com/Acme/TipJar',
  );
  assert.equal(
    reportedFacts({ name: 'tipjar', chains: [], url: 'https://gitlab.com/a/b' }, []).url,
    '',
  );
  assert.equal(reportedFacts({ name: 'tipjar', chains: [] }, []).url, '');
});

test('Ruling 13 (plan): ReportedRepoInput accepts an item with url and with no url', () => {
  assert.equal(
    ReportedRepoInput.safeParse({ name: 'tipjar', chains: [], url: 'https://github.com/acme/tipjar' })
      .success,
    true,
  );
  assert.equal(ReportedRepoInput.safeParse({ name: 'tipjar', chains: [] }).success, true);
});
