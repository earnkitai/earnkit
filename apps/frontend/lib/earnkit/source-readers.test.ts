import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GH_RATE_FLOOR, GH_RUN_CAP, GitHubBudgetStop, appCredential, budgetedGh, defaultReaderDeps, isBudgetStop, pep503, probeSite, readContractOrigin, readNpm, readNpmBulk, readPypi, readSite, soft, walletCreationsFrom, type ReaderDeps } from './source-readers';
import { CONTRACT_REFUSALS, contractOwned, contractOwnership, packageOwned, siteOwnedByText } from './sources';
import type { Resolver, Transport } from './safe-fetch';

const NOW = new Date('2026-10-12T12:00:00Z');
const iso = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const base: ReaderDeps = {
  gh: async () => { throw new Error('unexpected gh'); },
  probe: async () => ({ status: 200 }),
  fetchText: async () => '',
  json: async () => { throw new Error('unexpected json'); },
  ghGraphql: async () => { throw new Error('unexpected graphql'); },
  contractOrigin: async () => { throw new Error('unexpected origin'); },
  walletCreations: async () => [],
  now: NOW,
};

test('5.2 readSite: up is a 2xx probe; a 5xx or a thrown probe is down, never an error', async () => {
  assert.deepEqual(await readSite('https://tip.example.com', base), { status: 200, up: true });
  assert.deepEqual(await readSite('https://tip.example.com', { ...base, probe: async () => ({ status: 503 }) }), { status: 503, up: false });
  assert.deepEqual(await readSite('https://tip.example.com', { ...base, probe: async () => { throw new Error('dns'); } }), { status: 0, up: false });
});

test('5.3 readNpm: the mean of the last 4 weekly sums, and the metadata repo url', async () => {
  const days = Array.from({ length: 28 }, (_, i) => ({ day: iso(28 - i).slice(0, 10), downloads: 10 }));
  const json = async <T,>(url: string): Promise<T> =>
    (url.includes('downloads/range') ? { downloads: days } : { repository: { url: 'git+https://github.com/lee/tipjar.git' } }) as T;
  assert.deepEqual(await readNpm('tipjar', { ...base, json }), { weekly: 70, repo_url: 'https://github.com/lee/tipjar' });
});

test('5.4 readPypi: last_month / 4, and the project_urls repo', async () => {
  const json = async <T,>(url: string): Promise<T> =>
    (url.includes('pypistats') ? { data: { last_month: 400 } } : { info: { project_urls: { Source: 'https://github.com/lee/tip-jar' } } }) as T;
  assert.deepEqual(await readPypi('tip-jar', { ...base, json }), { weekly: 100, repo_url: 'https://github.com/lee/tip-jar' });
});

test('5.9 ownership: a package needs its metadata repo to be a verified repo; a site needs the profile code', () => {
  assert.equal(packageOwned({ weekly: 1, repo_url: 'https://github.com/Lee/TipJar' }, new Set(['lee/tipjar'])), true);
  assert.equal(packageOwned({ weekly: 1, repo_url: 'https://github.com/other/tipjar' }, new Set(['lee/tipjar'])), false);
  assert.equal(packageOwned({ weekly: 1, repo_url: null }, new Set(['lee/tipjar'])), false);
  assert.equal(siteOwnedByText('profile: 0123456789abcdef', '0123456789abcdef'), true);
  assert.equal(siteOwnedByText('profile: 0123456789abcdef', null), false);
});

test('5.10 ownership: EarnKit\'s deploy, a proven wallet, or a repo_link that passes every check', () => {
  const w = new Set(['0xme']);
  const repo = { deployer: '0xdev', created_at: iso(100) };
  const link = { deployer: '0xdev', created_at: iso(50), earnkitDeployed: false, repo };
  assert.equal(contractOwned({ deployer: null, earnkitDeployed: true }, w), 'deployer');
  assert.equal(contractOwned({ deployer: '0xME', earnkitDeployed: false }, w), 'deploy_wallet');
  assert.equal(contractOwned(link, w), 'repo_link');
  assert.equal(contractOwned({ deployer: '0xsomeone', earnkitDeployed: false }, w), null);
  assert.deepEqual(contractOwnership({ deployer: '0xsomeone', earnkitDeployed: false, repo: null }, w), { reject: CONTRACT_REFUSALS.unproven });
});

test('5.10a repo_link refusals: unreadable or different deployer, created before the repo or unknown, claimed contract or deployer', () => {
  const w = new Set<string>();
  const repo = { deployer: '0xdev', created_at: iso(100) };
  const link = { deployer: '0xdev', created_at: iso(50), earnkitDeployed: false, repo };
  const R = CONTRACT_REFUSALS;
  assert.deepEqual(contractOwnership({ ...link, deployer: null }, w), { reject: R.deployerUnreadable });
  assert.deepEqual(contractOwnership({ ...link, deployer: '0xfamous' }, w), { reject: R.deployerMismatch }, 'a broadcast file naming a famous contract');
  assert.deepEqual(contractOwnership({ ...link, repo: { ...repo, deployer: null } }, w), { reject: R.deployerMismatch });
  assert.deepEqual(contractOwnership({ ...link, created_at: iso(200) }, w), { reject: R.beforeRepo });
  assert.deepEqual(contractOwnership({ ...link, created_at: null }, w), { reject: R.createdUnreadable });
  assert.deepEqual(contractOwnership({ ...link, repo: { ...repo, created_at: null } }, w), { reject: R.createdUnreadable });
  assert.deepEqual(contractOwnership({ ...link, deployerTaken: true }, w), { reject: R.deployerTaken });
  assert.deepEqual(contractOwnership({ ...link, contractTaken: true }, w), { reject: R.taken });
  assert.deepEqual(contractOwnership({ deployer: null, earnkitDeployed: true, contractTaken: true }, w), { reject: R.taken }, 'claimed by another person always refuses');
  assert.deepEqual(contractOwnership({ deployer: '0xme', earnkitDeployed: false, contractTaken: true }, new Set(['0xme'])), { reject: R.taken });
});

test('5.10b the contract origin: lowercase deployer, unreadable fields are null, bad refs throw', async () => {
  const d = { ...base, contractOrigin: async () => ({ deployer: '0xABCDEF0000000000000000000000000000000001', created_at: iso(3) }) };
  assert.deepEqual(await readContractOrigin(`base:0x${'1'.repeat(40)}`, d), { deployer: '0xabcdef0000000000000000000000000000000001', created_at: iso(3) });
  assert.deepEqual(await readContractOrigin(`arc:0x${'1'.repeat(40)}`, { ...base, contractOrigin: async () => ({ deployer: 'junk', created_at: 'never' }) }), { deployer: null, created_at: null });
  await assert.rejects(readContractOrigin('base:0x12', d));
});

test('5.13 the real deps: json only reaches the four package hosts over https; site reads refuse loopback, private and IP hosts', async () => {
  const d = defaultReaderDeps(NOW, Date.now() + 5_000);
  for (const url of ['https://evil.example.com/x', 'http://api.npmjs.org/downloads/range/last-month/x', 'https://127.0.0.1/x', 'https://api.npmjs.org.evil.com/x', 'https://user@pypi.org/pypi/x/json'])
    await assert.rejects(d.json(url), /not allowed/, url);
  for (const origin of ['https://127.0.0.1', 'https://[::1]', 'https://10.0.0.8', 'http://tip.example.com', 'https://tip.example.com:8443'])
    assert.deepEqual(await readSite(origin, d), { status: 0, up: false }, origin);
  await assert.rejects(d.fetchText('https://192.168.1.1/.well-known/earnkit.txt'));
});

test('5.14 only finite numbers are stored; unreadable package data throws', async () => {
  const days = [{ day: '2026-10-01', downloads: 'x' }, { day: '2026-10-02', downloads: 7 }, { day: '2026-10-03', downloads: Infinity }];
  const npm = await readNpm('tipjar', { ...base, json: async <T,>(url: string) => (url.includes('downloads/range') ? { downloads: days } : {}) as T });
  assert.ok(Number.isFinite(npm.weekly));
  assert.equal(npm.weekly, 7 / 4);
  await assert.rejects(readPypi('tip-jar', { ...base, json: async <T,>(url: string) => (url.includes('pypistats') ? { data: {} } : { info: {} }) as T }));
});

const ghResponse = (remaining: number, resource = 'core') => new Response('{}', { headers: { 'x-ratelimit-remaining': String(remaining), 'x-ratelimit-resource': resource } });

test('final I5: a hard per-run cap of GH_RUN_CAP GitHub calls, with plenty left on the hour', async () => {
  assert.equal(GH_RUN_CAP, 1500);
  let calls = 0;
  const raw = async <T,>(_p: string, _a?: string, on?: (r: Response) => void): Promise<T> => {
    calls++;
    on?.(ghResponse(4999));
    return {} as T;
  };
  const gh = budgetedGh(raw);
  for (let i = 0; i < GH_RUN_CAP; i++) await gh('/repos/a/b');
  assert.equal(gh.spent(), false);
  await assert.rejects(gh('/repos/a/b'), GitHubBudgetStop);
  assert.equal(calls, GH_RUN_CAP, 'no call past the cap');
  assert.equal(gh.spent(), true);
  assert.equal(gh.take(), false, 'a call outside gh (ghFetch) is refused too');
  const small = budgetedGh(raw, GH_RATE_FLOOR, 2);
  assert.equal(small.take(), true);
  await small('/x');
  await assert.rejects(small('/x'), GitHubBudgetStop);
});

test('5.17 the GitHub floor: below GH_RATE_FLOOR core requests left, later reads stop with a budget stop (search never trips it)', async () => {
  let left = GH_RATE_FLOOR + 2;
  let calls = 0;
  const raw = async <T,>(path: string, _a?: string, on?: (r: Response) => void): Promise<T> => {
    calls++;
    on?.(ghResponse(path.startsWith('/search') ? 3 : --left, path.startsWith('/search') ? 'search' : 'core'));
    return {} as T;
  };
  const gh = budgetedGh(raw);
  await gh('/search/issues?q=x');
  await gh('/repos/a/b');
  await gh('/repos/a/b');
  await gh('/repos/a/b'); // drops to 999: its answer is still good
  await assert.rejects(gh('/repos/a/b'), GitHubBudgetStop);
  await assert.rejects(gh('/repos/a/b'), (e) => isBudgetStop(e));
  assert.equal(calls, 4, 'no call after the stop');
  const limited = budgetedGh(async (_p, _a, on) => { on?.(ghResponse(0)); throw new Error('GitHub request failed (403)'); });
  await assert.rejects(limited('/repos/a/b'), GitHubBudgetStop, 'a rate-limited failure is a stop, not a failed reading');
  // A reader never swallows the stop (the source stays unread and due, not a failed reading).
  await assert.rejects(soft(Promise.reject(new GitHubBudgetStop()), null), GitHubBudgetStop);
  assert.equal(await soft(Promise.reject(new Error('x')), null), null);
});

test('5.20 package names: PEP 503 for PyPI; a scoped npm name is one encoded path segment', async () => {
  assert.equal(pep503('Tip_Jar..Py'), 'tip-jar-py');
  const urls: string[] = [];
  const json = async <T,>(url: string): Promise<T> => (urls.push(url), (url.includes('pypistats') ? { data: { last_month: 4 } } : url.includes('downloads/range') ? { downloads: [] } : {}) as T);
  await readPypi('Tip_Jar..Py', { ...base, json });
  await readNpm('@types/node', { ...base, json });
  assert.deepEqual(urls, [
    'https://pypistats.org/api/packages/tip-jar-py/recent',
    'https://pypi.org/pypi/tip-jar-py/json',
    'https://api.npmjs.org/downloads/range/last-month/%40types%2Fnode',
    'https://registry.npmjs.org/%40types%2Fnode/latest',
  ]);
  await assert.rejects(readNpm('../evil', { ...base, json }));
});

test('5.21 a site read follows up to 3 redirects within the same site, re-vetting each hop; never another site or a private address', async () => {
  const PUBLIC = '93.184.216.34';
  const resolver = (map: Record<string, string>): Resolver => async (host) => [{ address: map[host] ?? PUBLIC, family: 4 }];
  const hops = (route: Record<string, string | null>, seen: string[] = []): Transport => async ({ url }) => {
    seen.push(url.href);
    const to = route[url.href];
    async function* body() { yield Buffer.from('<html><title>Tip jar</title>ok</html>'); }
    return to ? { status: 301, location: to, body: body() } : { status: 200, contentType: 'text/html', body: body() };
  };
  const seen: string[] = [];
  await probeSite('https://tip.example.com/', { resolve: resolver({}), transport: hops({ 'https://tip.example.com/': 'https://www.tip.example.com/', 'https://www.tip.example.com/': '/home', 'https://www.tip.example.com/home': '/app' }, seen) });
  assert.equal(seen.length, 4, '3 redirects then the page');
  await assert.rejects(probeSite('https://tip.example.com/', { resolve: resolver({}), transport: hops({ 'https://tip.example.com/': '/a', 'https://tip.example.com/a': '/b', 'https://tip.example.com/b': '/c', 'https://tip.example.com/c': '/d' }) }), /too many redirects/);
  await assert.rejects(probeSite('https://tip.example.com/', { resolve: resolver({}), transport: hops({ 'https://tip.example.com/': 'https://other.example.net/' }) }), /another site/);
  await assert.rejects(probeSite('https://tip.example.com/', { resolve: resolver({ 'www.tip.example.com': '10.0.0.7' }), transport: hops({ 'https://tip.example.com/': 'https://www.tip.example.com/' }) }), /public address/);
  await assert.rejects(probeSite('https://tip.example.com/', { resolve: resolver({}), transport: hops({ 'https://tip.example.com/': 'http://tip.example.com/' }) }), /https only/);
});

test('3.4 npm downloads in batches of 128 (unscoped); scoped names are left to readNpm', async () => {
  const names = Array.from({ length: 130 }, (_, i) => `pkg${i}`).concat('@me/scoped');
  const urls: string[] = [];
  const d = { json: async (u: string) => { urls.push(u); const list = u.split('/').pop()!.split(','); return Object.fromEntries(list.map((n) => [n, n === 'pkg5' ? null : { downloads: 70, package: n }])); } } as never;
  const out = await readNpmBulk(names, d);
  assert.equal(urls.length, 2);
  assert.ok(urls[0].startsWith('https://api.npmjs.org/downloads/point/last-week/pkg0,pkg1,'));
  assert.equal(urls[0].split('/').pop()!.split(',').length, 128);
  assert.equal(out.get('pkg1'), 70);
  assert.equal(out.get('pkg5'), null);
  assert.equal(out.has('@me/scoped'), false);
});

test('3.11 a site read counts each request, redirects included', async () => {
  const resolve: Resolver = async () => [{ address: '93.184.216.34', family: 4 }];
  const transport: Transport = async ({ url }) => {
    async function* body() { yield Buffer.from('<html>ok</html>'); }
    return url.pathname === '/' ? { status: 301, location: '/home', body: body() } : { status: 200, contentType: 'text/html', body: body() };
  };
  let n = 0;
  await probeSite('https://tip.example.com/', { resolve, transport, onRequest: () => n++ });
  assert.equal(n, 2);
});

test('3.21 a GitHub call the budget refuses is not counted as a request', async () => {
  let n = 0;
  const g = budgetedGh(async <T,>() => [] as T, GH_RATE_FLOOR, 1);
  await g('/a', undefined, () => n++);
  await assert.rejects(g('/b', undefined, () => n++), (e) => isBudgetStop(e));
  assert.equal(n, 1);
});

test('7.4b walletCreations: only successful contract creations from the wallet, at most 3 pages', async () => {
  const paths: string[] = [];
  const W = '0x' + 'ab'.repeat(20);
  const c = (n: number) => '0x' + String(n).padStart(40, '0');
  const page = async (path: string) => {
    paths.push(path);
    return {
      items: [
        { timestamp: '2026-09-01T00:00:00Z', status: 'ok', created_contract: { hash: c(paths.length).toUpperCase().replace('0X', '0x') } },
        { timestamp: '2026-09-01T00:00:00Z', status: 'error', created_contract: { hash: c(90) } },
        { timestamp: '2026-09-01T00:00:00Z', status: 'ok', created_contract: null },
      ],
      next_page_params: { block_number: 10 - paths.length, index: 0 },
    };
  };
  const out = await walletCreationsFrom(W, page);
  assert.deepEqual(out.map((x) => x.address), [c(1), c(2), c(3)]);
  assert.equal(paths.length, 3);
  assert.equal(paths[0], `/api/v2/addresses/${W}/transactions?filter=from`);
  assert.equal(paths[1], `/api/v2/addresses/${W}/transactions?filter=from&block_number=9&index=0`);
  await assert.rejects(walletCreationsFrom('nope', page));
});

test('final fix 8: App-credential reads never count toward GH_RUN_CAP and their rate headers never stop the run', async () => {
  assert.equal(appCredential('https://api.github.com/graphql', { headers: { Authorization: 'Bearer ghs_abc' } }), true);
  assert.equal(appCredential('https://api.github.com/app/installations/1/access_tokens', { headers: new Headers({ authorization: 'Bearer eyJhbGciOi.x.y' }) }), true);
  assert.equal(appCredential(new Request('https://api.github.com/repos/a/b', { headers: { Authorization: 'Bearer ghs_x' } })), true);
  assert.equal(appCredential('https://api.github.com/repos/a/b', { headers: { Authorization: 'token ghp_shared' } }), false);
  assert.equal(appCredential('https://api.github.com/repos/a/b'), false);
  const real = globalThis.fetch;
  let sent = 0;
  // Every response says the installation has 3 requests left this hour (under GH_RATE_FLOOR).
  globalThis.fetch = (async () => ((sent++), new Response('{}', { headers: { 'x-ratelimit-remaining': '3', 'x-ratelimit-resource': 'core' } }))) as typeof fetch;
  try {
    const d = defaultReaderDeps(NOW, Date.now() + 60_000);
    for (let i = 0; i < GH_RUN_CAP + 5; i++) await d.ghFetch!('https://api.github.com/graphql', { method: 'POST', headers: { Authorization: 'Bearer ghs_inst' } });
    assert.equal(sent, GH_RUN_CAP + 5, 'past the run cap: App reads have their own limit');
    assert.equal(d.ghSpent!(), false, "one installation's low rate headers never stop the run");
    // EarnKit's own token still counts and is still watched: the low header stops the run.
    await d.ghFetch!('https://api.github.com/repos/a/b', { headers: { Authorization: 'token ghp_shared' } });
    assert.equal(d.ghSpent!(), true);
    await assert.rejects(d.ghFetch!('https://api.github.com/repos/a/c', {}), GitHubBudgetStop);
  } finally {
    globalThis.fetch = real;
  }
});
