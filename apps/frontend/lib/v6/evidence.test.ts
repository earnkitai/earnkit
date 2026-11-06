import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { replayFetch } from '../v5/fixtures/github';
import { blockscout, type Explorer } from './explorers';
import { countedBy, deployFiles, deployRun, flattenRows, MAX_DEPLOY_BYTES, readCapped, readEvidence, repoSince } from './evidence';
import { contract } from './fixtures/evidence-builder';
import { replayExplorer } from './fixtures/explorer';
import { fakeRdap, fakeSite } from './fixtures/site';

after(() => sql().end());
// Each test starts from an empty cache and sets up what it needs.
beforeEach(async () => {
  await sql()`DELETE FROM evidence_cache`;
});

const NOW = new Date('2026-11-06T12:00:00Z');
const BASE = 'https://base.blockscout.com/api/v2';
const FAST = { gapMs: 0, sleep: async () => {} };
const CONTRACT = '0x426e2ca323fa707bd1921eccce0a27ad7804b2a2';
const replay = (slug: string) => replayFetch(`../../../v6/fixtures/repos/${slug}`);
const baseOnly = (chain: string, f: typeof fetch) => (chain === 'base' ? blockscout(BASE, f, FAST) : null);
const cached = async () => (await sql()<{ key: string }[]>`SELECT key FROM evidence_cache ORDER BY key`).map((r) => r.key);
const deps = (gh: typeof fetch, explorerFetch: typeof fetch) => ({
  gh, explorer: baseOnly, explorerFetch, probe: fakeSite().probe, rdap: fakeRdap().rdap, now: NOW,
});
const SUBJECT = {
  repo_url: 'https://github.com/Shijas786/onchain-reaction',
  live_url: 'https://onchainreaction.vercel.app/',
  contracts: [{ chain: 'base', address: CONTRACT.toUpperCase().replace('0X', '0x') }],
};

test('onchain-reaction and its Base contract fill every block; the second call reads only the repo object (cache hit)', async () => {
  const e = await readEvidence(SUBJECT, deps(replay('onchain-reaction').fetch, replayExplorer('onchain-reaction').fetch));
  assert.equal(e.partial, false);
  assert.equal(e.repo, 'shijas786/onchain-reaction');
  assert.equal(e.live.url_ok, true);
  assert.equal(e.onchain.length, 1);
  assert.equal(e.onchain[0].address, CONTRACT);
  assert.equal(e.onchain[0].is_contract, true);
  assert.equal(e.onchain[0].mainnet, true);
  assert.equal(typeof e.onchain[0].senders_90d, 'number');
  assert.ok(e.code && e.code.last_push_at && e.code.commits_90d === 0);
  assert.deepEqual(e.team?.logins, []);
  assert.ok(e.depth?.integrations.includes('wagmi'));
  assert.ok(e.reads.github > 1 && e.reads.explorer > 0);
  // One probe; a vercel.app host has no RDAP read of its own.
  assert.equal(e.reads.site, 1);
  assert.deepEqual(e.notes, []);
  assert.deepEqual(await cached(), [`contract:base:${CONTRACT}`, 'repo:shijas786/onchain-reaction']);

  const again = await readEvidence(SUBJECT, deps(replay('onchain-reaction').fetch, replayExplorer('onchain-reaction').fetch));
  assert.equal(again.reads.github, 1);
  assert.equal(again.reads.explorer, 0);
  assert.deepEqual(again.code, e.code);
  assert.deepEqual(again.team, e.team);
  assert.deepEqual(again.depth, e.depth);
  assert.deepEqual(again.onchain, e.onchain);
  assert.equal(again.partial, false);
  // The cached rows keep the time they were read.
  assert.equal(again.read_times.repo, e.read_times.repo);

  // A push since the read is a miss.
  const pushed = replayFetch('../../../v6/fixtures/repos/onchain-reaction', (u, b) =>
    u.toLowerCase().endsWith('/repos/shijas786/onchain-reaction') ? b.replace(/"pushed_at":\s*"[^"]+"/, '"pushed_at":"2026-11-06T10:00:00Z"') : b,
  );
  const third = await readEvidence(SUBJECT, deps(pushed.fetch, replayExplorer('onchain-reaction').fetch));
  assert.ok(third.reads.github > 2);
  assert.equal(third.code?.last_push_at, '2026-11-06T10:00:00Z');
});

test('budget stop keeps what was read and does not cache', async () => {
  const rec = replay('earnkit');
  // The team's own reads (accounts and their repos) are refused for the hour.
  const gh = (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes('/users/')
      ? new Response('{"message":"API rate limit exceeded"}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })
      : rec.fetch(input, init)) as typeof fetch;
  const e = await readEvidence({ repo_url: 'https://github.com/earnkitai/earnkit' }, deps(gh, replayExplorer('onchain-reaction').fetch));
  assert.equal(e.code?.commits_90d, 300);
  assert.ok(e.code?.has_tests);
  assert.match(e.team?.note ?? '', /(^|; )not read: budget/);
  assert.equal(e.partial, true);
  assert.deepEqual(await cached(), []);
});

test('a subject with only a live url: live filled, no code, no contracts', async () => {
  const e = await readEvidence({ live_url: 'https://earnkit.com/' }, deps(replay('earnkit').fetch, replayExplorer('onchain-reaction').fetch));
  assert.equal(e.code, null);
  assert.equal(e.team, null);
  assert.equal(e.depth, null);
  assert.deepEqual(e.onchain, []);
  assert.equal(e.live.url_ok, true);
  assert.equal(e.live.is_app, true);
  assert.equal(typeof e.live.domain_age_days, 'number');
  assert.equal(e.reads.github, 0);
  assert.equal(e.partial, false);
});

test('a private repo: no code, a note, not partial; the contracts and the site are still read', async () => {
  const e = await readEvidence(
    { repo_url: 'https://github.com/someone/secret', live_url: 'https://earnkit.com/', contracts: [{ chain: 'base', address: CONTRACT }] },
    deps(replay('onchain-reaction').fetch, replayExplorer('onchain-reaction').fetch),
  );
  assert.equal(e.code, null);
  assert.equal(e.team, null);
  assert.equal(e.depth, null);
  assert.deepEqual(e.notes, ['not read: private or missing']);
  assert.equal(e.partial, false);
  assert.equal(e.live.url_ok, true);
  assert.equal(e.onchain[0].is_contract, true);
});

test('a repo link not on GitHub is no repo; a chain without a reader is noted, not partial', async () => {
  const e = await readEvidence(
    { repo_url: 'https://gitlab.com/a/b', contracts: [{ chain: 'avalanche', address: `0x${'a'.repeat(40)}` }] },
    deps(replay('earnkit').fetch, replayExplorer('onchain-reaction').fetch),
  );
  assert.equal(e.repo, null);
  assert.equal(e.code, null);
  assert.deepEqual(e.notes, ['repo not on github']);
  assert.equal(e.onchain[0].mainnet, null);
  assert.equal(e.onchain[0].note, 'not read: no explorer for avalanche');
  assert.equal(e.partial, false);
  assert.equal(e.live.note, 'no live url');
});

test('an explorer 429 is partial and the contract is not cached', async () => {
  const busy = (async () => new Response('slow down', { status: 429 })) as typeof fetch;
  const e = await readEvidence({ contracts: [{ chain: 'base', address: CONTRACT }] }, deps(replay('earnkit').fetch, busy));
  assert.equal(e.onchain[0].note, 'not read: explorer 429');
  assert.equal(e.partial, true);
  assert.deepEqual(await cached(), []);
});

test('contracts: the subject first, de-duplicated by chain and address, at most 10', async () => {
  const many = [...Array(12)].map((_, i) => ({ chain: 'Tempo', address: `0x${String(i).padStart(40, '0')}` }));
  const e = await readEvidence({ contracts: [many[1], { ...many[1], address: many[1].address.toUpperCase().replace('0X', '0x') }, ...many] }, deps(replay('earnkit').fetch, replayExplorer('onchain-reaction').fetch));
  assert.equal(e.onchain.length, 10);
  assert.equal(e.onchain[0].address, many[1].address);
  assert.equal(e.onchain[0].chain, 'tempo');
  assert.equal(new Set(e.onchain.map((c) => c.address)).size, 10);
});

test('flattenRows: one row per scalar, arrays as arrays, each with its basis and read time', async () => {
  const e = await readEvidence(SUBJECT, deps(replay('onchain-reaction').fetch, replayExplorer('onchain-reaction').fetch));
  const rows = flattenRows(e);
  assert.deepEqual(rows, e.rows);
  const by = new Map(rows.map((r) => [r.key, r]));
  assert.equal(by.get('live.url_ok')?.value, true);
  assert.equal(by.get('live.url_ok')?.basis, 'site');
  assert.match(by.get('live.is_app')?.note ?? '', /heuristic/);
  assert.match(by.get('live.domain_age_days')?.note ?? '', /from RDAP/);
  // A null row names why, and only its own why: a loaded page has no failing status.
  assert.equal(by.get('live.domain_age_days')?.note, 'from RDAP; domain_age_days: shared host');
  assert.equal(by.get('live.status')?.note, null);
  assert.equal(by.get('onchain[0].senders_90d')?.basis, 'explorer');
  assert.equal(by.get('onchain[0].senders_90d')?.value, e.onchain[0].senders_90d);
  assert.equal(by.get('code.commits_90d')?.basis, 'github');
  assert.ok(Array.isArray(by.get('depth.integrations')?.value));
  assert.ok(Array.isArray(by.get('team.logins')?.value));
  assert.ok(!by.has('code.note'));
  for (const r of rows) assert.match(r.read_at, /^\d{4}-\d\d-\d\dT/);
  const words = /score|rank|grade|points|coin|token|streak|—/i;
  for (const r of rows) assert.ok(!words.test(r.note ?? ''), r.note ?? '');
});

test('a capped read is noted on its row whatever the value', async () => {
  const e = await readEvidence({ repo_url: 'https://github.com/earnkitai/earnkit' }, deps(replay('earnkit').fetch, replayExplorer('onchain-reaction').fetch));
  const by = new Map(e.rows.map((r) => [r.key, r]));
  assert.equal(by.get('code.commits_90d')?.value, 300);
  assert.equal(by.get('code.commits_90d')?.note, 'commits_90d capped at 300');
  assert.equal(by.get('code.active_weeks_90d')?.note, 'active_weeks_90d from newest 300 commits');
  // A row the note does not name, with a value, carries nothing.
  assert.equal(by.get('code.has_tests')?.note, null);
  assert.match(by.get('team.logins')?.note ?? '', /commits window capped at 300/);
});

test('a note names a row only as a whole key: domain_age_days is not domain', async () => {
  const e = await readEvidence({ live_url: 'https://onchainreaction.vercel.app/' }, deps(replay('earnkit').fetch, replayExplorer('onchain-reaction').fetch));
  const by = new Map(e.rows.map((r) => [r.key, r]));
  assert.equal(by.get('live.domain')?.note, null);
  assert.equal(by.get('live.domain_age_days')?.note, 'from RDAP; domain_age_days: shared host');
});

test('a cached row of the wrong shape is a miss, then replaced', async () => {
  const at = NOW;
  await sql()`INSERT INTO evidence_cache (key, kind, rows, pushed_at, read_at) VALUES
    ('repo:shijas786/onchain-reaction', 'repo', ${sql().json({ code: 'x' } as never)}, '2026-05-06T23:17:08Z', ${at}),
    (${`contract:base:${CONTRACT}`}, 'contract', ${sql().json([1, 2] as never)}, null, ${at})`;
  const e = await readEvidence(SUBJECT, deps(replay('onchain-reaction').fetch, replayExplorer('onchain-reaction').fetch));
  assert.ok(e.code && e.code.commits_90d === 0);
  assert.ok(e.team && Array.isArray(e.team.logins));
  assert.equal(e.onchain[0].is_contract, true);
  assert.ok(e.reads.github > 1 && e.reads.explorer > 0);
  const [row] = await sql()<{ rows: { code: unknown } }[]>`SELECT rows FROM evidence_cache WHERE key = 'repo:shijas786/onchain-reaction'`;
  assert.equal(typeof row.rows.code, 'object');
});

test('subject contracts without a chain or a 0x address are skipped and named; nothing throws', async () => {
  const contracts = [
    { address: CONTRACT },
    { chain: 'base', address: '0x1234' },
    null,
    { chain: 'base', address: CONTRACT },
  ] as unknown as { chain: string; address: string }[];
  const e = await readEvidence({ contracts, live_url: 42 as unknown as string }, deps(replay('earnkit').fetch, replayExplorer('onchain-reaction').fetch));
  assert.deepEqual(e.notes, ['contract 1 skipped: no chain', 'contract 2 skipped: not a 0x address', 'contract 3 skipped: not a contract']);
  assert.equal(e.onchain.length, 1);
  assert.equal(e.onchain[0].address, CONTRACT);
  assert.equal(e.live.note, 'no live url');
});

test('a budget already stopped: zero GitHub calls, the repo noted as not read for the budget, partial', async () => {
  const rec = replay('onchain-reaction');
  const e = await readEvidence(
    { repo_url: 'https://github.com/Shijas786/onchain-reaction', live_url: 'https://onchainreaction.vercel.app/' },
    { ...deps(rec.fetch, replayExplorer('onchain-reaction').fetch), budget: { remaining: 100, stopped: true } },
  );
  assert.equal(rec.calls.length, 0);
  assert.equal(e.reads.github, 0);
  assert.equal(e.code, null);
  assert.deepEqual(e.notes, ['not read: budget']);
  assert.equal(e.partial, true);
  assert.equal(e.live.url_ok, true);
});

test('one budget across reads: a low remaining on one repo stops the next before it starts', async () => {
  const budget = { remaining: null, stopped: false };
  const rec = replay('onchain-reaction');
  const low = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await rec.fetch(input, init);
    const h = new Headers(res.headers);
    h.set('x-ratelimit-remaining', '120');
    return new Response(res.body, { status: res.status, headers: h });
  }) as typeof fetch;
  await readEvidence({ repo_url: 'https://github.com/Shijas786/onchain-reaction' }, { ...deps(low, replayExplorer('onchain-reaction').fetch), budget, cache: false });
  assert.equal(budget.stopped, true);
  const next = replay('earnkit');
  const e = await readEvidence({ repo_url: 'https://github.com/earnkitai/earnkit' }, { ...deps(next.fetch, replayExplorer('onchain-reaction').fetch), budget, cache: false });
  assert.equal(next.calls.length, 0);
  assert.deepEqual(e.notes, ['not read: budget']);
});

test('deployFiles and deployRun: mainnet deploy runs only; CREATE and CREATE2 contracts, never the contracts called; the senders', () => {
  assert.deepEqual(
    deployFiles([
      'broadcast/Deploy.s.sol/8453/run-latest.json',
      'broadcast/Deploy.s.sol/84532/run-latest.json',
      'broadcast/Deploy.s.sol/8453/dry-run/run-latest.json',
      'lib/x/broadcast/A.s.sol/1/run-latest.json',
      'contracts/ignition/deployments/chain-42161/deployed_addresses.json',
    ]),
    [
      { path: 'broadcast/Deploy.s.sol/8453/run-latest.json', chain: 'base', journal: null, size: null },
      { path: 'contracts/ignition/deployments/chain-42161/deployed_addresses.json', chain: 'arbitrum', journal: null, size: null },
    ],
  );
  const A = `0x${'a'.repeat(40)}`;
  const B = `0x${'B'.repeat(40)}`;
  const R = `0x${'9'.repeat(40)}`;
  const S = `0x${'5e'.repeat(20)}`;
  const run = JSON.stringify({
    transactions: [
      { transactionType: 'CREATE', contractAddress: A, transaction: { from: S } },
      { transactionType: 'CALL', contractAddress: R, transaction: { from: S } },
      { transactionType: 'CREATE2', contractAddress: null, additionalContracts: [{ address: B }] },
    ],
  });
  assert.deepEqual(deployRun(run), { created: [A, B.toLowerCase()], senders: [S] });
  const journal = `{"type":"RUN_START"}\n{"networkInteraction":{"from":"${S.toUpperCase().replace('0X', '0x')}"}}\n`;
  assert.deepEqual(deployRun(JSON.stringify({ 'Module#Token': A, 'Module#Note': 'hello' }), journal), { created: [A], senders: [S] });
  assert.deepEqual(deployRun('not json'), { created: [], senders: [] });
  const ig = deployFiles([{ path: 'ignition/deployments/chain-8453/deployed_addresses.json', size: 10 }, { path: 'ignition/deployments/chain-8453/journal.jsonl', size: 20 }]);
  assert.deepEqual(ig[0].journal, { path: 'ignition/deployments/chain-8453/journal.jsonl', size: 20 });
});

test('countedBy: deployer in the repo, a deploy run its sender deployed, or a deploy after repo_since counts; named only never; a listed one unless claimed', () => {
  const SINCE = '2026-01-01T00:00:00Z';
  const D = `0x${'d'.repeat(40)}`;
  const old = contract({ deployer: D, deployed_at: '2023-03-01T00:00:00Z', deployer_matches_repo: false });
  const fresh = contract({ deployer: D, deployed_at: '2026-03-01T00:00:00Z', deployer_matches_repo: false });
  assert.deepEqual(countedBy(old, 'repo', SINCE), { counted: false, counted_reason: 'named in the repo, not counted' });
  assert.deepEqual(countedBy({ ...old, deployer_matches_repo: true }, 'repo', SINCE), { counted: true, counted_reason: 'deployer is in the repo' });
  assert.deepEqual(countedBy(old, 'deploy', SINCE, [D]), { counted: true, counted_reason: 'from a deploy folder' });
  // A deploy file is not proof alone: a run naming someone else's old contract does not count.
  assert.deepEqual(countedBy(old, 'deploy', SINCE, [`0x${'e'.repeat(40)}`]), { counted: false, counted_reason: 'deploy folder names it, deployer differs' });
  assert.deepEqual(countedBy(old, 'deploy', SINCE), { counted: false, counted_reason: 'deploy folder names it, deployer differs' });
  assert.deepEqual(countedBy(fresh, 'deploy', SINCE, []), { counted: true, counted_reason: 'deployed after repo_since' });
  assert.deepEqual(countedBy(fresh, 'repo', SINCE), { counted: true, counted_reason: 'deployed after repo_since' });
  assert.deepEqual(countedBy(fresh, 'subject', SINCE), { counted: true, counted_reason: 'deployed after repo_since' });
  assert.deepEqual(countedBy(old, 'subject', SINCE), { counted: false, counted_reason: 'claimed; deployer not in the repo and deployed before repo_since' });
  // No repo to hold it against: a listed contract counts.
  assert.deepEqual(countedBy(old, 'subject', null), { counted: true, counted_reason: 'listed by the applicant' });
  // Repo-found with no deploy date: never counted.
  assert.deepEqual(countedBy(contract({ deployed_at: null }), 'repo', SINCE), { counted: false, counted_reason: 'named in the repo, not counted' });
});

test('repoSince is the later of created_at and the first commit: a back-dated commit does not move it', () => {
  assert.equal(repoSince('2026-06-01T00:00:00Z', '2019-01-01T00:00:00Z'), '2026-06-01T00:00:00.000Z');
  assert.equal(repoSince('2024-01-01T00:00:00Z', '2025-02-01T00:00:00Z'), '2025-02-01T00:00:00.000Z');
  assert.equal(repoSince(null, '2025-02-01T00:00:00Z'), '2025-02-01T00:00:00.000Z');
  assert.equal(repoSince(null, null), null);
  // Deployed after the (forged) first commit but before the repo was created on GitHub: not counted.
  const c = contract({ deployer: `0x${'d'.repeat(40)}`, deployed_at: '2025-01-01T00:00:00Z', deployer_matches_repo: false });
  assert.equal(countedBy(c, 'repo', repoSince('2026-06-01T00:00:00Z', '2019-01-01T00:00:00Z')).counted, false);
  assert.equal(countedBy(c, 'subject', repoSince('2026-06-01T00:00:00Z', '2019-01-01T00:00:00Z')).counted, false);
});

test('readCapped: a body over the cap is null by content-length or by stream; under it is the text', async () => {
  assert.equal(await readCapped(new Response('hello'), 10), 'hello');
  assert.equal(await readCapped(new Response('x'.repeat(11)), 10), null);
  assert.equal(await readCapped(new Response('small', { headers: { 'content-length': String(MAX_DEPLOY_BYTES + 1) } }), MAX_DEPLOY_BYTES), null);
});

test('a repo naming a router in config, deploying one contract from broadcast/, and a listed contract: only the plausible ones count', async () => {
  const ROUTER = `0x${'2626'.repeat(10)}`;
  const MINE = `0x${'7'.repeat(40)}`;
  const LISTED_NEW = `0x${'5'.repeat(40)}`;
  const LISTED_OLD = `0x${'6'.repeat(40)}`;
  const FOREIGN = `0x${'8'.repeat(40)}`;
  const BETWEEN = `0x${'4'.repeat(40)}`;
  const ME = `0x${'d'.repeat(40)}`;
  const OTHER = `0x${'f'.repeat(40)}`;
  const files: Record<string, string> = {
    'src/config.ts': `import { base } from 'viem/chains';\nexport const ROUTER = '${ROUTER}';\n`,
    'README.md': '# b',
    'broadcast/Deploy.s.sol/8453/run-latest.json': JSON.stringify({
      transactions: [
        { transactionType: 'CREATE', contractAddress: MINE, transaction: { from: ME } },
        { transactionType: 'CALL', contractAddress: ROUTER, transaction: { from: ME } },
        // A fake entry claiming someone else's contract: its deployer is not the run's sender.
        { transactionType: 'CREATE', contractAddress: FOREIGN, transaction: { from: ME } },
      ],
    }),
    'broadcast/Big.s.sol/8453/run-latest.json': '{}',
  };
  const sizes: Record<string, number> = { 'broadcast/Big.s.sol/8453/run-latest.json': MAX_DEPLOY_BYTES + 1 };
  const calls: string[] = [];
  const gh = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url === 'https://api.github.com/repos/a/b') {
      return Response.json({ full_name: 'a/b', html_url: 'https://github.com/a/b', homepage: null, default_branch: 'main', private: false, fork: false, created_at: '2026-02-01T00:00:00Z', pushed_at: '2026-11-01T00:00:00Z' });
    }
    if (url.includes('/git/trees/')) return Response.json({ tree: Object.keys(files).map((path) => ({ path, type: 'blob', size: sizes[path] ?? 100 })) });
    if (url.endsWith('/commits?per_page=1')) return Response.json([{ commit: { committer: { date: '2026-01-01T00:00:00Z' } } }]);
    const raw = url.match(/^https:\/\/raw\.githubusercontent\.com\/a\/b\/main\/(.+)$/)?.[1];
    if (raw) return files[decodeURIComponent(raw)] !== undefined ? new Response(files[decodeURIComponent(raw)]) : new Response('', { status: 404 });
    return url.includes('/search/issues') ? Response.json({ total_count: 0, items: [] }) : Response.json([]);
  }) as typeof fetch;
  // The first commit says 2026-01-01; GitHub created the repo 2026-02-01, so repo_since is 2026-02-01.
  const born: Record<string, string> = {
    [ROUTER]: '2023-03-01T00:00:00Z', [MINE]: '2025-06-01T00:00:00Z', [FOREIGN]: '2024-05-01T00:00:00Z',
    [LISTED_NEW]: '2026-03-01T00:00:00Z', [LISTED_OLD]: '2024-01-01T00:00:00Z', [BETWEEN]: '2026-01-15T00:00:00Z',
  };
  const deployer: Record<string, string> = { [MINE]: ME };
  const explorer: Explorer = {
    contractInfo: async (_c, a) => ({ is_contract: true, verified_source: true, name: null, deployer: deployer[a] ?? OTHER, deployed_at: born[a] ?? null, created_tx: null }),
    txsTo: async () => [],
    firstTxs: async () => [],
  };
  const e = await readEvidence(
    { repo_url: 'https://github.com/a/b', contracts: [{ chain: 'base', address: LISTED_NEW }, { chain: 'base', address: LISTED_OLD }, { chain: 'base', address: BETWEEN }] },
    { gh, explorer: () => explorer, probe: fakeSite().probe, rdap: fakeRdap().rdap, now: NOW, cache: false },
  );
  const by = new Map(e.onchain.map((c) => [c.address, c]));
  assert.deepEqual(e.onchain.map((c) => c.address), [LISTED_NEW, LISTED_OLD, BETWEEN, MINE, FOREIGN, ROUTER]);
  const why = (a: string) => [by.get(a)!.counted, by.get(a)!.counted_reason];
  assert.deepEqual(why(ROUTER), [false, 'named in the repo, not counted']);
  assert.deepEqual(why(MINE), [true, 'from a deploy folder']);
  assert.deepEqual(why(FOREIGN), [false, 'deploy folder names it, deployer differs']);
  assert.deepEqual(why(LISTED_NEW), [true, 'deployed after repo_since']);
  assert.deepEqual(why(LISTED_OLD), [false, 'claimed; deployer not in the repo and deployed before repo_since']);
  // After the commit date, before GitHub's created_at: not counted.
  assert.deepEqual(why(BETWEEN), [false, 'claimed; deployer not in the repo and deployed before repo_since']);
  // The oversized deploy file is skipped by its tree size, never fetched, and named.
  assert.ok(e.notes.includes('deploy file over 2 MB not read: broadcast/Big.s.sol/8453/run-latest.json'), JSON.stringify(e.notes));
  assert.ok(!calls.some((u) => u.includes('Big.s.sol')));
  assert.equal(e.partial, false, JSON.stringify([e.notes, e.code?.note, e.team?.note]));
  assert.ok(calls.includes('https://raw.githubusercontent.com/a/b/main/broadcast/Deploy.s.sol/8453/run-latest.json'));
  const rows = new Map(e.rows.map((r) => [r.key, r]));
  assert.equal(rows.get('onchain[5].counted')?.value, false);
  assert.equal(rows.get('onchain[5].counted_reason')?.value, 'named in the repo, not counted');
});

test('a deploy file whose body runs past 2 MB is cut off, never parsed, and named', async () => {
  const big = `{"transactions":[${'{"transactionType":"CALL"},'.repeat(80_000)}{}]}`;
  assert.ok(big.length > MAX_DEPLOY_BYTES);
  const gh = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'https://api.github.com/repos/a/b') return Response.json({ full_name: 'a/b', html_url: '', homepage: null, default_branch: 'main', private: false, created_at: '2026-01-01T00:00:00Z', pushed_at: '2026-11-01T00:00:00Z' });
    // The tree understates the size; the stream cap still holds.
    if (url.includes('/git/trees/')) return Response.json({ tree: [{ path: 'README.md', type: 'blob', size: 3 }, { path: 'broadcast/D.s.sol/8453/run-latest.json', type: 'blob', size: 10 }] });
    if (url.endsWith('/README.md')) return new Response('# b');
    if (url.includes('run-latest.json')) return new Response(big);
    return url.includes('/search/issues') ? Response.json({ total_count: 0, items: [] }) : Response.json([]);
  }) as typeof fetch;
  const e = await readEvidence({ repo_url: 'https://github.com/a/b' }, { gh, explorer: () => null, probe: fakeSite().probe, rdap: fakeRdap().rdap, now: NOW, cache: false });
  assert.deepEqual(e.notes, ['deploy file over 2 MB not read: broadcast/D.s.sol/8453/run-latest.json']);
  assert.deepEqual(e.onchain, []);
  assert.equal(e.partial, false);
});
