import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN_NAMES, detectChains, pickFiles } from './match';
import {
  DEFAULT_README,
  INVESTMENT_NOTE,
  TUTORIAL,
  matchRepo,
  ownerOk,
  productScore,
  reportedFacts,
  type ProductFacts,
  type ProgramFacts,
  type RepoFacts,
} from './match';
import { LocalReposInput, ReportedRepoInput, reportedChain, reportedDate, reportedUrl } from './match-projects';

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
    any_chain: false,
    investment: false,
    min_product_score: 0,
    starts_at: null,
  },
  {
    id: 'circle',
    title: 'Circle Developer Grants',
    chains: ['arc'],
    existing_work: 'allowed',
    tag: 'needs a live product',
    any_chain: false,
    investment: false,
    min_product_score: 0,
    starts_at: null,
  },
  {
    id: 'monad',
    title: 'Monad Metropolis',
    chains: ['monad'],
    existing_work: 'new_work_only',
    tag: 'long shot',
    any_chain: false,
    investment: false,
    min_product_score: 0,
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

test('fix round 1, finding 3: Ruling 13 (plan) — a url over 300 characters is dropped, never rejected', () => {
  const tooLong = `https://github.com/acme/${'a'.repeat(290)}`;
  assert.ok(tooLong.length > 300, tooLong.length.toString());
  const r = ReportedRepoInput.safeParse({ name: 'tipjar', chains: [], url: tooLong });
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.url, undefined);
  // At exactly 300 it's kept (and still parses as a GitHub link via reportedFacts).
  const atLimit = `https://github.com/acme/${'a'.repeat(300 - 'https://github.com/acme/'.length)}`;
  assert.equal(atLimit.length, 300);
  const kept = ReportedRepoInput.safeParse({ name: 'tipjar', chains: [], url: atLimit });
  assert.equal(kept.success && kept.data.url, atLimit);
});

// ---- v2.8 Task 6: any_chain programs and Avalanche ----

const speedrun: ProgramFacts = {
  id: 'speedrun',
  title: 'a16z speedrun',
  chains: [],
  any_chain: true,
  existing_work: 'allowed',
  tag: 'long shot',
  investment: false,
  min_product_score: 0,
  starts_at: null,
};

test('v2.8 Ruling 13: an any_chain program fits a repo with no detected chains; only the live link applies', () => {
  const live = matchRepo(repo({ homepage: 'https://app.x' }), [speedrun]);
  assert.equal(live.length, 1);
  assert.equal(live[0].status, 'likely');
  const noLink = matchRepo(repo({}), [speedrun]);
  assert.equal(noLink[0].status, 'after_step');
  assert.deepEqual(noLink[0].missing, ['live_url']);
  assert.equal(noLink[0].note, 'needs a live link');
  // A testnet-only repo is not asked for a mainnet deploy.
  const testnet = matchRepo(repo({ homepage: 'https://app.x', chains: { arc: { mainnet: false, testnet: true, evidence: 'x' } } }), [speedrun]);
  assert.equal(testnet[0].status, 'likely');
  // existing_work still applies.
  const fresh = matchRepo(repo({ homepage: 'https://app.x' }), [{ ...speedrun, existing_work: 'new_work_only' }]);
  assert.equal(fresh[0].status, 'after_step');
});

test('v2.8 Ruling 14: chain ids 43114 and 43113 are Avalanche mainnet and Fuji testnet', () => {
  assert.deepEqual(detectChains([{ path: 'hardhat.config.ts', text: 'chainId: 43114' }]).avalanche, {
    mainnet: true, testnet: false, evidence: 'hardhat.config.ts: chain id 43114',
  });
  assert.deepEqual(detectChains([{ path: 'hardhat.config.ts', text: 'chainId: 43113' }]).avalanche, {
    mainnet: false, testnet: true, evidence: 'hardhat.config.ts: chain id 43113',
  });
  const hosts = detectChains([{ path: '.env.example', text: 'RPC=https://api.avax-test.network/ext/bc/C/rpc' }]);
  assert.equal(hosts.avalanche?.testnet, true);
  assert.equal(hosts.avalanche?.mainnet, false);
  assert.equal(CHAIN_NAMES.avalanche, 'Avalanche');
});

test('v2.8 fix round 1: a testnet-only explorer host is not a mainnet signal; viem Avalanche names', () => {
  const fuji = detectChains([{ path: 'README.md', text: 'see https://testnet.snowtrace.io/address/0x1' }]);
  assert.deepEqual([fuji.avalanche?.mainnet, fuji.avalanche?.testnet], [false, true]);
  const sepolia = detectChains([{ path: 'README.md', text: 'https://sepolia.basescan.org/tx/0x1' }]);
  assert.deepEqual([sepolia.base?.mainnet, sepolia.base?.testnet], [false, true]);
  const both = detectChains([{ path: 'a.ts', text: 'https://snowtrace.io and https://testnet.snowtrace.io' }]);
  assert.deepEqual([both.avalanche?.mainnet, both.avalanche?.testnet], [true, true]);
  const viem = detectChains([{ path: 'wagmi.ts', text: "import { avalanche, avalancheFuji } from 'viem/chains'" }]);
  assert.deepEqual([viem.avalanche?.mainnet, viem.avalanche?.testnet], [true, true]);
});

// ---- v2.8.1 §B6: "What can I earn?" never fails on what an agent reports ----

test('v2.8.1 §B6: any chain string is accepted; unknown chains are ignored, known ones kept once', () => {
  const r = ReportedRepoInput.safeParse({
    name: 'ethapp',
    chains: ['ethereum', 'solana', { chain: 'arbitrum', mainnet: true }, 'Base', { chain: 'base-sepolia', mainnet: true }],
  });
  assert.equal(r.success, true);
  assert.deepEqual(r.success && r.data.chains, [{ chain: 'base', mainnet: true }]);
  // An Ethereum-only repo: no known chain, still a repo.
  const eth = ReportedRepoInput.safeParse({ name: 'ethapp', chains: [{ chain: 'ethereum', mainnet: true }] });
  assert.deepEqual(eth.success && eth.data.chains, []);
  // A plain string names mainnet unless it names a testnet; an object without mainnet is testnet.
  assert.deepEqual(reportedChain('Avalanche Fuji'), { chain: 'avalanche', mainnet: false });
  assert.deepEqual(reportedChain('robinhood chain'), { chain: 'robinhood', mainnet: true });
  assert.deepEqual(reportedChain({ chain: 'monad' }), { chain: 'monad', mainnet: false });
  assert.deepEqual(reportedChain({ chain: 'AVAX', mainnet: 'true' }), { chain: 'avalanche', mainnet: true });
  assert.equal(reportedChain(42), null);
  assert.equal(reportedChain('b'.repeat(61)), null);
  // A single string instead of a list, or no chains at all.
  assert.deepEqual(ReportedRepoInput.parse({ name: 'x', chains: 'base' }).chains, [{ chain: 'base', mainnet: true }]);
  assert.deepEqual(ReportedRepoInput.parse({ name: 'x' }).chains, []);
  // Fix round 1: past 20, chains are truncated; the repo is kept.
  const many = ReportedRepoInput.safeParse({ name: 'x', chains: [...Array(20).fill('solana'), 'base'] });
  assert.equal(many.success, true);
  assert.deepEqual(many.success && many.data.chains, []);
  // Fix round 1: chain ids, as numbers or digit strings, alone or in an object.
  assert.deepEqual(reportedChain(8453), { chain: 'base', mainnet: true });
  assert.deepEqual(reportedChain('84532'), { chain: 'base', mainnet: false });
  assert.deepEqual(reportedChain({ chain: 43114 }), { chain: 'avalanche', mainnet: true });
  assert.equal(reportedChain(1), null);
  assert.equal(reportedChain(1e20), null);
});

test('v2.8.1 §B6: dates without a timezone count as UTC; unreadable ones are dropped, never an error', () => {
  assert.equal(reportedDate('2026-10-01'), '2026-10-01T00:00:00.000Z');
  assert.equal(reportedDate('2026-10-01T12:30:00'), '2026-10-01T12:30:00.000Z');
  assert.equal(reportedDate('2026-10-01 12:30'), '2026-10-01T12:30:00.000Z');
  assert.equal(reportedDate('2026-10-01T12:30:00+02:00'), '2026-10-01T10:30:00.000Z');
  assert.equal(reportedDate('Wed Oct 8 14:20:00 2026 +0200'), '2026-10-08T12:20:00.000Z');
  assert.equal(reportedDate('last tuesday'), undefined);
  assert.equal(reportedDate('2'.repeat(101)), undefined);
  const r = ReportedRepoInput.parse({ name: 'x', chains: [], last_commit_at: 'yesterday' });
  assert.equal(r.last_commit_at, undefined);
  assert.equal(ReportedRepoInput.parse({ name: 'x', chains: [], last_commit_at: '2026-10-01' }).last_commit_at, '2026-10-01T00:00:00.000Z');
});

test('v2.8.1 §B6: a live link without a scheme is kept; a bad one is dropped; extra keys are ignored', () => {
  assert.equal(reportedUrl('tipjar.xyz'), 'https://tipjar.xyz');
  assert.equal(reportedUrl('http://tipjar.xyz/app'), 'http://tipjar.xyz/app');
  for (const bad of ['not a url', 'localhost', 'ftp://x.y', `https://${'a'.repeat(300)}.com`]) assert.equal(reportedUrl(bad), undefined, bad);
  const r = ReportedRepoInput.safeParse({ name: 'x', chains: [], live_url: 'nope', branch: 'main', url: null });
  assert.equal(r.success, true);
  assert.deepEqual(r.success && JSON.parse(JSON.stringify(r.data)), { name: 'x', chains: [] });
});

test('v2.8.1 §B6 (fix round 1): a repo without a name takes the name in its GitHub link; a bare string is a name; a long name is cut', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(LocalReposInput.parse([{ chains: ['base'], url: 'https://github.com/acme/tipjar.git' }, 'ethapp', { name: 'n'.repeat(150), chains: [] }]))),
    [
      { name: 'tipjar', chains: [{ chain: 'base', mainnet: true }], url: 'https://github.com/acme/tipjar.git' },
      { name: 'ethapp', chains: [] },
      { name: 'n'.repeat(100), chains: [] },
    ],
  );
});

test('v2.8.1 §B6: local_repos never fails list_programs: an unreadable repo is skipped; past 20 are ignored', () => {
  const out = LocalReposInput.parse([{ chains: ['base'] }, { name: 'ok', chains: ['ethereum'] }, 7, null]);
  assert.deepEqual(out, [{ name: 'ok', chains: [] }]);
  assert.equal(LocalReposInput.parse(Array.from({ length: 25 }, (_, i) => ({ name: `r${i}`, chains: [] }))).length, 20);
  // What it outputs parses again unchanged (list_programs remembers it and re-reads it later).
  const once = LocalReposInput.parse([{ name: 'a', chains: ['Base', 'avax'], live_url: 'a.xyz', last_commit_at: '2026-10-01' }]);
  assert.deepEqual(LocalReposInput.parse(once), once);
});

// ---- v2.9 A1, A2: owned repos and the real-product score ----

test('2.1 ownerOk: EarnKit orgs never; the builder; others only with 5+ commits that are 30%+ of the last 100', () => {
  assert.equal(ownerOk('earnkitai', 'earnkitai'), false);
  assert.equal(ownerOk('EarnKitAI', null), false);
  assert.equal(ownerOk('Alice', 'alice'), true);
  assert.equal(ownerOk('acme', 'alice', { userCommits: 4, recentCommits: 10 }), false);
  assert.equal(ownerOk('acme', 'alice', { userCommits: 5, recentCommits: 20 }), false);
  assert.equal(ownerOk('acme', 'alice', { userCommits: 6, recentCommits: 20 }), true);
  assert.equal(ownerOk('acme', 'alice'), false);
});

const allFacts: ProductFacts = { active: true, young: true, original: true, readme: true, deployed: true, owned: true };

test('2.2 productScore: tiers', () => {
  assert.deepEqual(productScore(allFacts), { score: 6, tier: 'product', missing: [] });
  const noDeploy = productScore({ ...allFacts, deployed: false });
  assert.equal(noDeploy.score, 5);
  assert.equal(noDeploy.tier, 'project');
  assert.deepEqual(noDeploy.missing, ['deployed']);
  const three = productScore({ active: true, owned: true, deployed: true, young: false, original: false, readme: false });
  assert.equal(three.tier, 'project');
  const two = productScore({ active: true, owned: true, deployed: false, young: false, original: false, readme: false });
  assert.equal(two.tier, 'noise');
});

test('2.3 TUTORIAL: tutorial names match, product names do not', () => {
  for (const n of ['covid-19-tracker', 'todo-app', 'antivirus-tutorial', 'nextjs-starter', 'udemy-course']) assert.match(n, TUTORIAL, n);
  for (const n of ['tipjar', 'arcpay']) assert.doesNotMatch(n, TUTORIAL, n);
  assert.match('Getting Started with Create React App', DEFAULT_README);
});

const product = (f: Partial<ProductFacts> = {}) => productScore({ ...allFacts, ...f });
const arcMain = { arc: { mainnet: true, testnet: false, evidence: 'x' } };

test('2.4 a noise repo matches nothing', () => {
  const noise = product({ active: false, young: false, original: false, readme: false });
  assert.equal(noise.tier, 'noise');
  assert.deepEqual(matchRepo(repo({ homepage: 'https://app.x', chains: arcMain, product: noise }), programs), []);
  assert.deepEqual(matchRepo(repo({ homepage: 'https://app.x', product: noise }), [{ ...speedrun, investment: true, min_product_score: 5 }]), []);
});

test('2.5 a project-tier repo is never likely: after_step with its most actionable missing signal', () => {
  const p = product({ deployed: false, readme: false, young: false });
  assert.equal(p.tier, 'project');
  const v = matchRepo(repo({ homepage: 'https://app.x', chains: arcMain, product: p }), programs).find((x) => x.program_id === 'arc-micro')!;
  assert.equal(v.status, 'after_step');
  assert.equal(v.note, 'no live site or contract found');
  // The same repo as product tier is likely.
  const full = matchRepo(repo({ homepage: 'https://app.x', chains: arcMain, product: product(), live_verified: true }), programs);
  assert.equal(full.find((x) => x.program_id === 'arc-micro')!.status, 'likely');
});

test('2.6 a16z (any_chain, investment, min 5): products only, after_step with the investment note', () => {
  const a16z: ProgramFacts = { ...speedrun, investment: true, min_product_score: 5 };
  const project = product({ deployed: false });
  assert.deepEqual(matchRepo(repo({ homepage: 'https://app.x', product: project }), [a16z]), []);
  const [v] = matchRepo(repo({ homepage: 'https://app.x', product: product() }), [a16z]);
  assert.equal(v.status, 'after_step');
  assert.equal(v.note, INVESTMENT_NOTE);
  assert.deepEqual(v.missing, []);
  assert.equal(v.effort, 'weeks');
});

test('2.3b a docs repo is not original, so it never makes an a16z row', () => {
  for (const n of ['docs', 'project-docs', 'documentation-site']) assert.match(n, TUTORIAL, n);
  const docs = product({ original: false, readme: false });
  assert.equal(docs.tier, 'project');
  assert.deepEqual(matchRepo(repo({ name: 'docs', homepage: 'https://docs.x', product: docs }), [{ ...speedrun, investment: true, min_product_score: 5 }]), []);
});

test('2.7 needs a live product: never likely; a verified link leaves only real users', () => {
  const base: ProgramFacts = { ...programs[1], id: 'base', title: 'Base Builder Grants', chains: ['base'] };
  const baseMain = { base: { mainnet: true, testnet: false, evidence: 'x' } };
  const [unverified] = matchRepo(repo({ homepage: 'https://app.x', chains: baseMain, product: product(), live_verified: false }), [base]);
  assert.equal(unverified.status, 'after_step');
  assert.deepEqual(unverified.missing, ['live_url', 'real_users']);
  const [verified] = matchRepo(repo({ homepage: 'https://app.x', chains: baseMain, product: product(), live_verified: true }), [base]);
  assert.equal(verified.status, 'after_step');
  assert.deepEqual(verified.missing, ['real_users']);
  assert.equal(verified.effort, 'weeks');
});
