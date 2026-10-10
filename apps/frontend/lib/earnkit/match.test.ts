import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN_NAMES, DEPLOY_FIRST, creditsMainnet, deployConfigChains, detectChains, pickFiles } from './match';
import {
  BELOW_FLOOR_NOTE,
  DEFAULT_README,
  INVESTMENT_NOTE,
  fitsWideProgram,
  TUTORIAL,
  CLAIMED_MAINNET,
  applyBuilderFacts,
  confirmMainnets,
  matchRepo,
  ownerOk,
  productScore,
  reportedFacts,
  GOOD_ODDS_TRACTION,
  SIGNAL_WORDS,
  productOdds,
  rowOdds,
  MISSING_REASON,
  USERS_UNKNOWN,
  traction,
  type ProductFacts,
  type ProgramFacts,
  type RepoFacts,
  type Verdict,
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
      // v2.10 item 9: in a deploy config (a mention alone gives no fit).
      chains: { arc: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' } },
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
  // v2.10 Pre-flight P8: an agent-reported mainnet is a claim (v2.9 A3) until a contract check backs it.
  assert.deepEqual(live.claims, ['mainnet']);
  const arc = matchRepo(live, programs).find((x) => x.program_id === 'arc-micro')!;
  assert.equal(arc.status, 'after_step');
  assert.equal(arc.note, 'confirm: mainnet');
  assert.equal(matchRepo(confirmMainnets(live, ['arc']), programs).find((x) => x.program_id === 'arc-micro')!.status, 'likely');

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
  // v2.10 item 9, Ruling H2: a mainnet id in a hardhat network entry is a deploy config; outside one
  // (or a testnet id) it stays a mention.
  assert.deepEqual(detectChains([{ path: 'hardhat.config.ts', text: 'networks: { avalanche: { chainId: 43114 } }' }]).avalanche, {
    mainnet: true, testnet: false, evidence: 'hardhat.config.ts: deploy config', basis: 'deploy_config',
  });
  assert.deepEqual(detectChains([{ path: 'hardhat.config.ts', text: 'chainId: 43114' }]).avalanche, {
    mainnet: true, testnet: false, evidence: 'hardhat.config.ts: chain id 43114', basis: 'mention',
  });
  assert.deepEqual(detectChains([{ path: 'hardhat.config.ts', text: 'chainId: 43113' }]).avalanche, {
    mainnet: false, testnet: true, evidence: 'hardhat.config.ts: chain id 43113', basis: 'mention',
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
// v2.10 item 9: a credited mainnet needs a deploy config (or a deployment); a mention gives no fit.
const arcMain = { arc: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' as const } };

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
  // v2.10.1 B3: products only: with measured users (50+ transactions) it is the company step.
  const [v] = matchRepo(repo({ homepage: 'https://app.x', product: product(), tx_count: 120 }), [a16z]);
  assert.equal(v.status, 'after_step');
  assert.equal(v.note, INVESTMENT_NOTE);
  assert.deepEqual(v.missing, []);
  assert.equal(v.effort, 'weeks');
  // Without them, never a fit: it needs real users first, and says so.
  const [u] = matchRepo(repo({ homepage: 'https://app.x', product: product() }), [a16z]);
  assert.deepEqual([u.status, u.note, u.missing, u.effort], ['after_step', 'needs real users first', ['real_users'], 'weeks']);
});

test('2.3b a docs repo is not original, so it never makes an a16z row', () => {
  for (const n of ['docs', 'project-docs', 'documentation-site']) assert.match(n, TUTORIAL, n);
  const docs = product({ original: false, readme: false });
  assert.equal(docs.tier, 'project');
  assert.deepEqual(matchRepo(repo({ name: 'docs', homepage: 'https://docs.x', product: docs }), [{ ...speedrun, investment: true, min_product_score: 5 }]), []);
});

test('G15 I2: a tutorial-like product (original missing) still matches a chain program, never any_chain or investment', () => {
  const covid = product({ original: false });
  assert.equal(covid.tier, 'product');
  const covidRepo = repo({ name: 'covid-19-tracker', homepage: 'https://covid.x', chains: arcMain, product: covid, live_verified: true });
  assert.deepEqual(matchRepo(covidRepo, [{ ...speedrun, investment: true, min_product_score: 5 }]), []);
  assert.deepEqual(matchRepo(covidRepo, [speedrun]), []);
  assert.ok(matchRepo(covidRepo, programs).some((v) => v.program_id === 'arc-micro'));
  assert.equal(fitsWideProgram(covid), false);
  assert.equal(fitsWideProgram(product()), true);
});

test('2.7 needs a live product: never likely; a verified link leaves only real users', () => {
  const base: ProgramFacts = { ...programs[1], id: 'base', title: 'Base Builder Grants', chains: ['base'] };
  const baseMain = { base: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' as const } };
  const [unverified] = matchRepo(repo({ homepage: 'https://app.x', chains: baseMain, product: product(), live_verified: false }), [base]);
  assert.equal(unverified.status, 'after_step');
  assert.deepEqual(unverified.missing, ['live_url', 'real_users']);
  const [verified] = matchRepo(repo({ homepage: 'https://app.x', chains: baseMain, product: product(), live_verified: true }), [base]);
  assert.equal(verified.status, 'after_step');
  assert.deepEqual(verified.missing, ['real_users']);
  assert.equal(verified.effort, 'weeks');
});

// ---- v2.9 A3: the builder's statements (tell_earnkit) ----

const saidNothing = { mainnet: [], testnet: [], live_url: null, has_users: null, not_mine: false } as const;
const said = (over: Partial<{ mainnet: ('arc' | 'monad' | 'base')[]; testnet: ('arc' | 'monad' | 'base')[]; live_url: string | null; has_users: boolean | null; not_mine: boolean }>) => ({
  ...saidNothing,
  mainnet: [],
  testnet: [],
  ...over,
});

test('3.1 applyBuilderFacts: a repo the builder says is not theirs is dropped', () => {
  assert.equal(applyBuilderFacts(repo({ chains: arcMain }), said({ not_mine: true })), null);
  assert.deepEqual(applyBuilderFacts(repo({ chains: arcMain }), undefined)!.claims, []);
});

test('3.2 testnet only wins over mainnet code: Arc needs the mainnet deploy, hours of work', () => {
  const f = applyBuilderFacts(repo({ homepage: 'https://app.x', chains: arcMain, product: product(), live_verified: true }), said({ testnet: ['arc'] }))!;
  assert.equal(f.chains.arc!.mainnet, false);
  assert.deepEqual(f.claims, []);
  const v = matchRepo(f, programs).find((x) => x.program_id === 'arc-micro')!;
  assert.equal(v.status, 'after_step');
  assert.ok(v.missing.includes('mainnet_deploy'));
  assert.equal(v.effort, 'hours');
  // Testnet only with no live link either: the deploy is the long step, the link is not a separate minutes step.
  const bare = applyBuilderFacts(repo({ chains: arcMain }), said({ testnet: ['arc'] }))!;
  assert.equal(matchRepo(bare, programs).find((x) => x.program_id === 'arc-micro')!.effort, 'hours');
});

test('3.3 a mainnet the code does not show is a claim: after_step "confirm: mainnet", never likely, even for a product', () => {
  const monad: ProgramFacts = { ...programs[0], id: 'monad-live', title: 'Monad Live', chains: ['monad'] };
  const f = applyBuilderFacts(repo({ homepage: 'https://app.x', product: product(), live_verified: true }), said({ mainnet: ['monad'] }))!;
  assert.deepEqual(f.claims, ['mainnet']);
  assert.equal(f.chains.monad!.mainnet, true);
  const [v] = matchRepo(f, [monad]);
  assert.equal(v.status, 'after_step');
  assert.equal(v.note, 'confirm: mainnet');
  assert.deepEqual(v.missing, []);
  // A mainnet the code already shows is no claim.
  const shown = applyBuilderFacts(repo({ homepage: 'https://app.x', chains: arcMain, product: product(), live_verified: true }), said({ mainnet: ['arc'] }))!;
  assert.deepEqual(shown.claims, []);
  assert.equal(matchRepo(shown, programs).find((x) => x.program_id === 'arc-micro')!.status, 'likely');
});

test('3.3b a claimed live link waits on "confirm: live link" until it loads from here', () => {
  const f = applyBuilderFacts(repo({ chains: arcMain, product: product() }), said({ live_url: 'https://tipjar.xyz' }))!;
  assert.equal(f.homepage, 'https://tipjar.xyz');
  assert.deepEqual(f.claims, ['live']);
  const v = matchRepo({ ...f, live_verified: false }, programs).find((x) => x.program_id === 'arc-micro')!;
  assert.equal(v.status, 'after_step');
  assert.equal(v.note, 'confirm: live link');
  assert.equal(matchRepo({ ...f, live_verified: true }, programs).find((x) => x.program_id === 'arc-micro')!.status, 'likely');
  // A homepage already there is kept; the statement's link is no claim then.
  assert.deepEqual(applyBuilderFacts(repo({ homepage: 'https://own.xyz' }), said({ live_url: 'https://tipjar.xyz' }))!.claims, []);
});

test('3.4 users on a "needs a live product" program: real_users leaves missing, the row waits on "confirm: users"', () => {
  const base: ProgramFacts = { ...programs[1], id: 'base', title: 'Base Builder Grants', chains: ['base'] };
  const baseMain = { base: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' as const } };
  const f = applyBuilderFacts(repo({ homepage: 'https://app.x', chains: baseMain, product: product(), live_verified: true }), said({ has_users: true }))!;
  assert.deepEqual(f.claims, ['users']);
  const [v] = matchRepo(f, [base]);
  assert.ok(!v.missing.includes('real_users'));
  assert.equal(v.status, 'after_step');
  assert.equal(v.note, 'confirm: users');
  // Without a verified link the link is still missing, and users never make it likely.
  const [unverified] = matchRepo({ ...f, live_verified: false }, [base]);
  assert.deepEqual(unverified.missing, ['live_url']);
  assert.equal(unverified.status, 'after_step');
  // Users don't matter where the program doesn't ask for them.
  assert.equal(matchRepo({ ...f, chains: arcMain }, programs).find((x) => x.program_id === 'arc-micro')!.status, 'likely');
});

test('3.F2 a mainnet claim taken back is no claim; code on the claimed chain clears it', () => {
  const claimedArc = { arc: { mainnet: true, testnet: false, evidence: CLAIMED_MAINNET } };
  const back = applyBuilderFacts(repo({ chains: claimedArc, claims: ['mainnet'] }), said({ testnet: ['arc'] }))!;
  assert.deepEqual(back.claims, []);
  const f = applyBuilderFacts(repo({ homepage: 'https://app.x', product: product(), live_verified: true }), said({ mainnet: ['arc', 'monad'] }))!;
  const arcOnly = confirmMainnets(f, ['arc']);
  assert.deepEqual(arcOnly.claims, ['mainnet'], 'Monad is still a claim');
  assert.equal(matchRepo(arcOnly, programs).find((x) => x.program_id === 'arc-micro')!.status, 'likely');
  assert.deepEqual(confirmMainnets(f, ['arc', 'monad']).claims, []);
});

test('4.12 a repo below the program match floor is at most after_step, with the floor note', () => {
  const arcProgram = programs.find((p) => p.id === 'arc-micro')!;
  const four = product({ readme: false, young: false });
  assert.equal(four.score, 4);
  const [below] = matchRepo(repo({ homepage: 'https://app.x', chains: arcMain, product: four, live_verified: true }), [{ ...arcProgram, match_floor: 5 }]);
  assert.equal(below.status, 'after_step');
  assert.equal(below.note, BELOW_FLOOR_NOTE);
  // At or over the floor, a product stays likely; no floor (null) changes nothing.
  const six = repo({ homepage: 'https://app.x', chains: arcMain, product: product(), live_verified: true });
  assert.equal(matchRepo(six, [{ ...arcProgram, match_floor: 6 }])[0].status, 'likely');
  assert.equal(matchRepo(six, [{ ...arcProgram, match_floor: null }])[0].status, 'likely');
  // A row that is already a step away keeps its own note.
  const noLink = matchRepo(repo({ chains: arcMain, product: four }), [{ ...arcProgram, match_floor: 5 }])[0];
  assert.equal(noLink.status, 'after_step');
  assert.notEqual(noLink.note, BELOW_FLOOR_NOTE);
});

// ---- v2.10 item 9: a chain counts only when something is deployed there ----

const baseGrants: ProgramFacts = { ...programs[1], id: 'base-builder-grants', title: 'Base Builder Grants', chains: ['base'] };
const baseOpen: ProgramFacts = { ...programs[0], id: 'base-open', title: 'Base Open', chains: ['base'] };
const wagmi = [{ path: 'src/wagmi.ts', text: "import { base } from 'wagmi/chains'" }];

test('1.1 a wagmi import of base is a mention: Base Builder Grants is "deploy to Base first", hours, never likely', () => {
  const d = detectChains(wagmi);
  assert.equal(d.base!.mainnet, true);
  assert.equal(d.base!.basis, 'mention');
  assert.equal(creditsMainnet(d.base), false);
  assert.equal(DEPLOY_FIRST('base'), 'deploy to Base first');
  for (const over of [{}, { homepage: 'https://app.x', product: product(), live_verified: true }, { homepage: 'https://app.x', claims: ['users' as const] }])
    for (const prog of [baseGrants, baseOpen]) {
      const [v] = matchRepo(repo({ chains: d, ...over }), [prog]);
      assert.equal(v.status, 'after_step', prog.id);
      assert.equal(v.note, 'deploy to Base first');
      assert.equal(v.effort, 'hours');
      assert.ok(v.missing.includes('mainnet_deploy'));
    }
});

test('1.2 a deploy folder makes the chain a deploy config; the Base row can be likely (R6 folder names)', () => {
  const d = detectChains(wagmi, ['broadcast/Deploy.s.sol/8453/run-latest.json']);
  assert.equal(d.base!.basis, 'deploy_config');
  assert.equal(d.base!.evidence, 'broadcast/Deploy.s.sol/8453/run-latest.json');
  assert.equal(creditsMainnet(d.base), true);
  const [v] = matchRepo(repo({ chains: d, homepage: 'https://app.x', product: product(), live_verified: true }), [baseOpen]);
  assert.equal(v.status, 'likely');
  for (const p of ['ignition/deployments/chain-8453/deployed_addresses.json', 'deployments/base/TipJar.json', 'deployments/base-mainnet/x.json', 'deployments/BaseMainnet/x.json'])
    assert.deepEqual(Object.keys(deployConfigChains([], [p])), ['base'], p);
  for (const p of ['deployments/basesepolia/x.json', 'deployments/mainnet/x.json', 'broadcast/Deploy.s.sol/84532/run-latest.json'])
    assert.deepEqual(deployConfigChains([], [p]), {}, p);
  // Ruling H2 (I2): at any depth (monorepos), never inside a dependency folder.
  for (const p of ['src/deployments/base/x.json', 'contracts/broadcast/Deploy.s.sol/8453/run-latest.json', 'packages/hardhat/deployments/base/TipJar.json', 'packages/foundry/ignition/deployments/chain-8453/deployed_addresses.json'])
    assert.deepEqual(Object.keys(deployConfigChains([], [p])), ['base'], p);
  for (const p of ['node_modules/@acme/kit/deployments/base/x.json', 'lib/openzeppelin/broadcast/D.s.sol/8453/run.json', 'packages/foundry/lib/x/broadcast/D.s.sol/8453/run.json', 'vendor/x/deployments/base/x.json'])
    assert.deepEqual(deployConfigChains([], [p]), {}, p);
  assert.equal(detectChains(wagmi, ['deployments/basesepolia/x.json']).base!.basis, 'mention');
});

test('1.3 a mainnet in hardhat.config or foundry [rpc_endpoints] is a deploy config; the same host elsewhere is a mention', () => {
  const hh = detectChains([{ path: 'hardhat.config.ts', text: "networks: { base: { url: 'https://mainnet.base.org', chainId: 8453 } }" }]);
  assert.equal(hh.base!.basis, 'deploy_config');
  assert.equal(detectChains([{ path: 'src/constants.ts', text: "export const RPC = 'https://mainnet.base.org'" }]).base!.basis, 'mention');
  const rpc = detectChains([{ path: 'foundry.toml', text: '[profile.default]\nsrc = "src"\n\n[rpc_endpoints]\nbase = "https://mainnet.base.org"\n' }]);
  assert.equal(rpc.base!.basis, 'deploy_config');
  const profile = detectChains([{ path: 'foundry.toml', text: '[profile.default]\nbase = "https://mainnet.base.org"\n\n[fmt]\nline_length = 100\n' }]);
  assert.equal(profile.base!.basis, 'mention');
  // A testnet in a deploy config credits no mainnet.
  assert.deepEqual(deployConfigChains([{ path: 'hardhat.config.ts', text: 'chainId: 84532' }], []), {});
});

test('1.4 confirmMainnets: code on a chain makes it deployed; a claim not backed stays a claim', () => {
  const mention = detectChains(wagmi).base!;
  const f = repo({ chains: { base: mention, monad: { mainnet: true, testnet: false, evidence: CLAIMED_MAINNET, basis: 'mention' } }, claims: ['mainnet'] });
  const c = confirmMainnets(f, ['base']);
  assert.equal(c.chains.base!.basis, 'deployed');
  assert.equal(c.chains.base!.evidence, 'a contract with code on Base mainnet');
  assert.equal(creditsMainnet(c.chains.base), true);
  // Monad stays a claim: credited as v2.9 A3 (the row waits on "confirm"), claims keep 'mainnet'.
  assert.equal(c.chains.monad!.evidence, CLAIMED_MAINNET);
  assert.equal(creditsMainnet(c.chains.monad), true);
  assert.deepEqual(c.claims, ['mainnet']);
  const both = confirmMainnets(f, ['base', 'monad']);
  assert.equal(both.chains.monad!.basis, 'deployed');
  assert.deepEqual(both.claims, []);
});

test('1.5 a cached chains entry without basis (a v2.9 row) reads as a mention (R6)', () => {
  const old = { base: { mainnet: true, testnet: false, evidence: 'src/wagmi.ts: imports base from viem/wagmi' } };
  assert.equal(creditsMainnet(old.base), false);
  const [v] = matchRepo(repo({ chains: old, homepage: 'https://app.x', product: product(), live_verified: true }), [baseOpen]);
  assert.equal(v.note, 'deploy to Base first');
  // A v2.9 claim (no basis, CLAIMED_MAINNET) is still credited as a claim.
  assert.equal(creditsMainnet({ mainnet: true, testnet: false, evidence: CLAIMED_MAINNET }), true);
  // The builder's word over a mention becomes a claim (Pre-flight P8).
  const f = applyBuilderFacts(repo({ chains: old }), said({ mainnet: ['base'] }))!;
  assert.equal(f.chains.base!.evidence, CLAIMED_MAINNET);
  assert.deepEqual(f.claims, ['mainnet']);
});

// ---- v2.10 Ruling H2: deploy configs are network entries, never imports, comments or templates ----

test('H2 I1: a hardhat config credits only its network entries: never an import, a comment or etherscan customChains', () => {
  const credited = (text: string) => Object.keys(deployConfigChains([{ path: 'hardhat.config.ts', text }], []));
  const importOnly = "import { base, avalanche } from 'viem/chains';\nexport default { networks: { hardhat: {} } };";
  assert.deepEqual(credited(importOnly), []);
  assert.equal(detectChains([{ path: 'hardhat.config.ts', text: importOnly }]).base!.basis, 'mention');
  assert.deepEqual(credited("networks: {\n  hardhat: {},\n  // base: { url: 'https://mainnet.base.org' },\n  /* avalanche: { chainId: 43114 } */\n}"), []);
  assert.deepEqual(
    credited("networks: { hardhat: {} },\netherscan: { customChains: [{ network: 'base', chainId: 8453, urls: { apiURL: 'https://api.basescan.org/api' } }] }"),
    [],
  );
  // A real entry still counts, with the URL's // kept (strings are not comments).
  assert.deepEqual(credited("networks: { base: { url: 'https://mainnet.base.org', accounts: [pk] }, baseSepolia: { url: 'https://sepolia.base.org' } }"), ['base']);
  assert.deepEqual(credited('networks: { "base-mainnet": { url: `https://base-mainnet.g.alchemy.com/v2/${key}` } }'), ['base']);
});

test('H2: a config naming more than 2 mainnet networks is a template (Scaffold-ETH style): no credit; 1 or 2 count', () => {
  const scaffold = `const config = {
  defaultNetwork: 'localhost',
  networks: {
    hardhat: { forking: { url: \`https://eth-mainnet.alchemyapi.io/v2/\${key}\`, enabled: false } },
    mainnet: { url: \`https://eth-mainnet.alchemyapi.io/v2/\${key}\`, accounts: [pk] },
    sepolia: { url: \`https://eth-sepolia.g.alchemy.com/v2/\${key}\`, accounts: [pk] },
    arbitrum: { url: \`https://arb-mainnet.g.alchemy.com/v2/\${key}\`, accounts: [pk] },
    optimism: { url: \`https://opt-mainnet.g.alchemy.com/v2/\${key}\`, accounts: [pk] },
    polygon: { url: \`https://polygon-mainnet.g.alchemy.com/v2/\${key}\`, accounts: [pk] },
    base: { url: 'https://mainnet.base.org', accounts: [pk] },
    baseSepolia: { url: 'https://sepolia.base.org', accounts: [pk] },
  },
};`;
  assert.deepEqual(deployConfigChains([{ path: 'packages/hardhat/hardhat.config.ts', text: scaffold }], []), {});
  assert.equal(detectChains([{ path: 'packages/hardhat/hardhat.config.ts', text: scaffold }]).base!.basis, 'mention');
  const two = "networks: { hardhat: {}, avalanche: { url: 'https://api.avax.network/ext/bc/C/rpc' }, base: { chainId: 8453 }, baseSepolia: { chainId: 84532 } }";
  assert.deepEqual(Object.keys(deployConfigChains([{ path: 'hardhat.config.ts', text: two }], [])).sort(), ['avalanche', 'base']);
  // The same template rule in foundry.toml.
  const many = '[rpc_endpoints]\nmainnet = "${ETH_RPC}"\narbitrum = "${ARB_RPC}"\noptimism = "${OP_RPC}"\nbase = "https://mainnet.base.org"\n';
  assert.deepEqual(deployConfigChains([{ path: 'foundry.toml', text: many }], []), {});
});

test('H2: foundry [rpc_endpoints] by name (env URLs), comments out; a dry run and an avax folder', () => {
  const credited = (text: string) => Object.keys(deployConfigChains([{ path: 'foundry.toml', text }], []));
  assert.deepEqual(credited('[rpc_endpoints]\nbase = "${BASE_RPC_URL}"\nbase_sepolia = "${BASE_SEPOLIA_RPC_URL}"\n'), ['base']);
  assert.deepEqual(credited('[rpc_endpoints]\n# base = "https://mainnet.base.org"\nlocal = "http://127.0.0.1:8545"\n'), []);
  assert.deepEqual(credited('[rpc_endpoints]\nbase = "https://mainnet.base.org" # prod\n\n[etherscan]\navalanche = { key = "${KEY}", chain = 43114 }\n'), ['base']);
  assert.deepEqual(deployConfigChains([], ['broadcast/Deploy.s.sol/8453/dry-run/run-latest.json']), {});
  assert.deepEqual(Object.keys(deployConfigChains([], ['deployments/avax/TipJar.json'])), ['avalanche']);
});

test('Task 1 review: on a multi-chain program a credited chain wins over a mention listed first', () => {
  const multi: ProgramFacts = { ...programs[0], id: 'multi', title: 'Multi', chains: ['base', 'arc'] };
  const chains = { base: detectChains(wagmi).base!, arc: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' as const } };
  const [v] = matchRepo(repo({ chains, homepage: 'https://app.x', product: product(), live_verified: true }), [multi]);
  assert.equal(v.status, 'likely');
});

// ---- v2.10 item 6: traction and odds ----

test('3.1 traction: 3·band(tx) + 2·live + band(commits), 0 to 10 (R1); unknown counts score 0', () => {
  assert.equal(traction({ tx_count: 0, live_ok: false, commits_90d: 0 }), 0);
  assert.equal(traction({ tx_count: 1, live_ok: true, commits_90d: 1 }), 6);
  assert.equal(traction({ tx_count: 50, live_ok: true, commits_90d: 10 }), 10);
  assert.equal(traction({ tx_count: null, live_ok: true, commits_90d: 10 }), 4);
  assert.equal(traction({ tx_count: 49, live_ok: false, commits_90d: 9 }), 4);
  assert.equal(traction({ tx_count: null, live_ok: false, commits_90d: null }), 0);
});

test('3.2 productOdds: product tier and traction 4+ is good; else low with the first reason (R2)', () => {
  const product = { tier: 'product' as const, missing: [] };
  assert.deepEqual(productOdds(product, { tx_count: null, live_ok: true, commits_90d: 10 }, 4), { odds: 'good', low_reason: null });
  // Traction 3: tx 1-49 without a live link, tx 0 with one, unknown tx with one.
  assert.deepEqual(productOdds(product, { tx_count: 5, live_ok: false, commits_90d: 0 }, 3), { odds: 'low', low_reason: 'live link not loading' });
  assert.deepEqual(productOdds(product, { tx_count: 0, live_ok: true, commits_90d: 1 }, 3), { odds: 'low', low_reason: 'no users yet' });
  // Ruling H5 (I1): with the count unknown, a live link and a commit in 90 days are good odds; never
  // "little recent activity".
  assert.deepEqual(productOdds(product, { tx_count: null, live_ok: true, commits_90d: 1 }, 3), { odds: 'good', low_reason: null });
  assert.deepEqual(productOdds(product, { tx_count: null, live_ok: true, commits_90d: null }, 2), { odds: 'good', low_reason: null }, 'an unknown commit count: product tier already needs activity');
  assert.deepEqual(productOdds(product, { tx_count: null, live_ok: false, commits_90d: 20 }, 2), { odds: 'low', low_reason: 'live link not loading' });
  assert.deepEqual(productOdds(product, { tx_count: null, live_ok: true, commits_90d: 0 }, 2), { odds: 'low', low_reason: SIGNAL_WORDS.active });
  // Ruling H5 (I2): a copy or starter is low, whatever its traction.
  assert.deepEqual(productOdds({ tier: 'product', missing: ['original'] }, { tx_count: 120, live_ok: true, commits_90d: 20 }, 10), {
    odds: 'low',
    low_reason: SIGNAL_WORDS.original,
  });
  assert.deepEqual(productOdds({ tier: 'product', missing: ['original'] }, { tx_count: null, live_ok: true, commits_90d: 20 }, 4).odds, 'low');
  // A project-tier repo: its missingSignalNote, even with high traction.
  const project = { tier: 'project' as const, missing: ['readme' as const] };
  assert.deepEqual(productOdds(project, { tx_count: 60, live_ok: true, commits_90d: 20 }, 10), { odds: 'low', low_reason: SIGNAL_WORDS.readme });
  assert.deepEqual(productOdds({ tier: 'project', missing: [] }, { tx_count: 0, live_ok: false, commits_90d: 0 }, 0), {
    odds: 'low',
    low_reason: 'not enough signs of a real product yet',
  });
});

test('3.3 rowOdds: a good-odds product whose row waits on a chain it only mentions is low, "not deployed yet"', () => {
  const good = { score: 6, tier: 'product' as const, missing: [], traction: 8, odds: 'good' as const, low_reason: null };
  const verdict = (missing: Verdict['missing']): Verdict => ({ program_id: 'base-x', program: 'Base X', status: 'after_step', missing, effort: 'hours', note: null });
  const mention = { base: { mainnet: true, testnet: false, evidence: 'imports base', basis: 'mention' as const } };
  assert.deepEqual(rowOdds(good, verdict(['mainnet_deploy']), mention), { odds: 'low', low_reason: 'not deployed yet' });
  // A v2.9 row without basis reads as a mention (R6); a claim is not a mention.
  assert.deepEqual(rowOdds(good, verdict(['mainnet_deploy']), { base: { mainnet: true, testnet: false, evidence: 'x' } }).odds, 'low');
  assert.deepEqual(rowOdds(good, verdict(['mainnet_deploy']), { base: { mainnet: true, testnet: false, evidence: CLAIMED_MAINNET, basis: 'mention' } }), { odds: 'good', low_reason: null });
  assert.deepEqual(rowOdds(good, verdict([]), mention), { odds: 'good', low_reason: null });
  // The repo's own odds: low with its reason; unscored or older (no odds) reads as low.
  assert.deepEqual(rowOdds({ ...good, odds: 'low', low_reason: 'no users yet' }, verdict([]), {}), { odds: 'low', low_reason: 'no users yet' });
  assert.equal(rowOdds({ score: 6, tier: 'product', missing: [] }, verdict([]), {}).odds, 'low');
  assert.deepEqual(rowOdds(undefined, verdict([]), {}), { odds: 'low', low_reason: 'not enough signs of a real product yet' });
  // A project-tier repo's reason comes before the mention (R2 order).
  assert.deepEqual(rowOdds({ score: 4, tier: 'project', missing: ['readme'], odds: 'low', low_reason: SIGNAL_WORDS.readme }, verdict(['mainnet_deploy']), mention), {
    odds: 'low',
    low_reason: SIGNAL_WORDS.readme,
  });
  assert.equal(GOOD_ODDS_TRACTION, 4);
});

// ---- v2.11 T1 (v2.10.2): the odds fixes ----

test('v2.11 8b (1.1), fix round 1 (I1, I2): rowOdds: new work or users missing is low for every repo; a deploy or link missing is low only below product tier ("not on mainnet yet" on a testnet)', () => {
  const p = { score: 6, tier: 'product' as const, missing: [], traction: 6, odds: 'good' as const, low_reason: null };
  const v = (missing: ('new_work' | 'live_url' | 'mainnet_deploy' | 'real_users')[]) =>
    ({ program_id: 'x', program: 'X', status: 'after_step' as const, missing, effort: 'days' as const, note: null });
  assert.deepEqual(rowOdds(p, v(['new_work']), {}), { odds: 'low', low_reason: 'only new work counts' });
  // A product one live link or one mainnet deploy away keeps its odds (EarnKit does those steps).
  assert.deepEqual(rowOdds(p, v(['live_url']), {}), { odds: 'good', low_reason: null });
  assert.deepEqual(rowOdds(p, v(['mainnet_deploy']), {}), { odds: 'good', low_reason: null });
  assert.deepEqual(rowOdds(p, v(['mainnet_deploy', 'live_url']), {}), { odds: 'good', low_reason: null });
  assert.deepEqual(rowOdds(p, v(['real_users']), {}), { odds: 'low', low_reason: 'no users yet' });
  assert.deepEqual(rowOdds(p, v(['live_url', 'new_work']), {}), { odds: 'low', low_reason: 'only new work counts' });
  assert.deepEqual(rowOdds(p, v([]), {}), { odds: 'good', low_reason: null });
  assert.deepEqual(MISSING_REASON, { new_work: 'only new work counts', live_url: 'no live link yet', mainnet_deploy: 'not deployed yet', real_users: 'no users yet' });
  // An unknown repo: users unknown while it waits only on users; any other missing requirement is low.
  const u = { score: 4, tier: 'project' as const, missing: [], unchecked: ['owned' as const, 'readme' as const], traction: 3, odds: 'unknown' as const, low_reason: null };
  assert.deepEqual(rowOdds(u, v(['real_users']), {}), { odds: 'unknown', low_reason: USERS_UNKNOWN });
  assert.deepEqual(rowOdds(u, v(['new_work']), {}), { odds: 'low', low_reason: 'only new work counts' });
  // I1: on a row that doesn't need users, no reason at all (never "users unknown").
  assert.deepEqual(rowOdds(u, v([]), {}), { odds: 'unknown', low_reason: null });
  // Below product tier a missing deploy or link is low; on a testnet only, "not on mainnet yet".
  assert.deepEqual(rowOdds(u, v(['live_url']), {}), { odds: 'low', low_reason: 'no live link yet' });
  assert.deepEqual(rowOdds(u, v(['mainnet_deploy']), {}), { odds: 'low', low_reason: 'not deployed yet' });
  const testnet = { arc: { mainnet: false, testnet: true, evidence: 'said: testnet' } };
  assert.deepEqual(rowOdds(u, v(['mainnet_deploy']), testnet), { odds: 'low', low_reason: 'not on mainnet yet' });
  // A mention-only chain on a product, with a testnet deploy elsewhere: "not on mainnet yet" too.
  const mentionAndTestnet = { base: { mainnet: true, testnet: false, evidence: 'imports base', basis: 'mention' as const }, arc: { mainnet: false, testnet: true, evidence: 'x' } };
  assert.deepEqual(rowOdds(p, v(['mainnet_deploy']), mentionAndTestnet), { odds: 'low', low_reason: 'not on mainnet yet' });
});

test('v2.11 8a (1.6, S4): productOdds: a repo GitHub hides (404), live and active, is unknown; with 0 measured transactions it stays low "no users yet"', () => {
  const hidden = productScore({ active: true, young: true, original: true, readme: false, deployed: true, owned: false }, ['readme', 'owned']);
  assert.equal(hidden.tier, 'project');
  const t = { tx_count: null, live_ok: true, commits_90d: 1 };
  assert.deepEqual(productOdds(hidden, t, 3, { ownerHidden: true }), { odds: 'unknown', low_reason: null });
  assert.deepEqual(productOdds(hidden, { ...t, tx_count: 0 }, 3, { ownerHidden: true }), { odds: 'low', low_reason: 'no users yet' });
  // Not hidden (a rate limit), not live, a copy or not active: never unknown.
  // Fix round 1 (M3): a rate limit (not hidden) is low, but never "not enough signs of a real product".
  assert.deepEqual(productOdds(hidden, t, 3), { odds: 'low', low_reason: 'owner not checked yet' });
  assert.equal(productOdds(hidden, { ...t, live_ok: false }, 3, { ownerHidden: true }).odds, 'low');
  const copy = productScore({ active: true, young: true, original: false, readme: false, deployed: true, owned: false }, ['readme', 'owned']);
  assert.equal(productOdds(copy, t, 3, { ownerHidden: true }).odds, 'low');
  const stale = productScore({ active: false, young: false, original: true, readme: false, deployed: true, owned: false }, ['readme', 'owned']);
  assert.equal(productOdds(stale, t, 3, { ownerHidden: true }).odds, 'low');
});
