import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GH_RATE_FLOOR, GH_RUN_CAP, GitHubBudgetStop, READ_CAPS, budgetedGh, defaultReaderDeps, isBudgetStop, isoWeek, pep503, probeSite, readContract, readContractOrigin, readCoin, readMergedPrs, readNpm, readNpmBulk, readPypi, readRepo, readSite, type ReaderDeps } from './source-readers';
import { CONTRACT_REFUSALS, contractOwned, contractOwnership, packageOwned, repoOwned, siteOwnedByText } from './sources';
import type { Resolver, Transport } from './safe-fetch';

const NOW = new Date('2026-10-12T12:00:00Z');
const iso = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const base: ReaderDeps = {
  gh: async () => { throw new Error('unexpected gh'); },
  probe: async () => ({ status: 200 }),
  fetchText: async () => '',
  json: async () => { throw new Error('unexpected json'); },
  ghGraphql: async () => { throw new Error('unexpected graphql'); },
  baseTxs: async () => ({ items: [], next_page_params: null }),
  tokenTransfers: async () => ({ items: [], next_page_params: null }),
  contractOrigin: async () => { throw new Error('unexpected origin'); },
  arcLogs: async () => [],
  arcHead: async () => 1_000n,
  arcSender: async () => { throw new Error('unexpected sender'); },
  usdPerNative: async (c) => (c === 'arc' ? 1 : 3_000),
  now: NOW,
};

test('5.1 readRepo: stargazers with starred_at and account age, forkers, issue authors (not PRs), contributors, commit weeks', async () => {
  const gh = async <T,>(path: string): Promise<T> => {
    const r: Record<string, unknown> = {
      '/repos/lee/tipjar': { owner: { login: 'lee', type: 'User' }, fork: false, is_template: false, stargazers_count: 1, created_at: iso(600) },
      '/repos/lee/tipjar/stargazers?per_page=100&page=1': [{ starred_at: iso(3), user: { login: 'ann' } }],
      '/repos/lee/tipjar/forks?per_page=100': [{ owner: { login: 'bo' }, created_at: iso(4) }],
      '/repos/lee/tipjar/issues?state=all&per_page=100': [{ user: { login: 'cy' }, created_at: iso(5) }, { user: { login: 'dee' }, created_at: iso(5), pull_request: {} }],
      '/repos/lee/tipjar/contributors?per_page=100': [{ login: 'lee', contributions: 40 }, { login: 'eve', contributions: 2 }],
      '/repos/lee/tipjar/stats/commit_activity': [{ week: Date.parse(iso(7)) / 1000, total: 3 }, { week: Date.parse(iso(14)) / 1000, total: 0 }],
      '/users/ann': { created_at: iso(500) },
      '/users/bo': { created_at: iso(10) },
      '/users/cy': { created_at: iso(900) },
      '/users/eve': { created_at: iso(900) },
    };
    if (!(path in r)) throw new Error(`no fake for ${path}`);
    return r[path] as T;
  };
  const s = await readRepo('lee/tipjar', { ...base, gh });
  assert.deepEqual(s.stargazers.map((w) => w.id), ['gh:ann']);
  assert.equal(s.forkers[0].created_at, iso(10));
  assert.deepEqual(s.issue_authors.map((w) => w.id), ['gh:cy']);
  assert.deepEqual(s.contributors.map((w) => w.id), ['gh:lee', 'gh:eve']);
  assert.deepEqual(s.commit_weeks, [isoWeek(new Date(iso(7)))]);
  assert.equal(s.partial, false);
  assert.equal(s.owner_type, 'User');
  assert.equal(s.created_at, iso(600));
});

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

test('5.5 readContract on Base: successful outside calls since the date, value priced; capped reads are partial', async () => {
  const page = { items: [
    { timestamp: iso(1), status: 'ok', from: { hash: '0xAAA0000000000000000000000000000000000001' }, value: '1000000000000000' },
    { timestamp: iso(2), status: 'error', from: { hash: '0xAAA0000000000000000000000000000000000002' }, value: '0' },
    { timestamp: iso(400), status: 'ok', from: { hash: '0xAAA0000000000000000000000000000000000003' }, value: '0' },
  ], next_page_params: null };
  const s = await readContract(`base:0x${'1'.repeat(40)}`, new Date(iso(365)), { ...base, baseTxs: async () => page });
  assert.equal(s.callers.length, 1);
  assert.equal(s.callers[0].id, 'wallet:0xaaa0000000000000000000000000000000000001');
  assert.equal(s.callers[0].value_usd, 3);
  const endless = { items: [{ timestamp: iso(1), status: 'ok', from: { hash: '0x' + 'b'.repeat(40) }, value: '0' }], next_page_params: { block_number: 1 } };
  let pages = 0;
  const capped = await readContract(`base:0x${'1'.repeat(40)}`, new Date(iso(365)), { ...base, baseTxs: async () => (pages++, endless) });
  assert.equal(pages, READ_CAPS.basePages);
  assert.equal(capped.partial, true);
});

test('5.6 readContract on Arc: recent log chunks, at most 200 senders read, the rest partial', async () => {
  const logs = Array.from({ length: 250 }, (_, i) => ({ tx: `0x${i.toString(16).padStart(64, '0')}` }));
  let senders = 0;
  const read: string[] = [];
  const s = await readContract(`arc:0x${'2'.repeat(40)}`, new Date(iso(365)), {
    ...base,
    arcLogs: async (_a, from) => (from === 0n ? logs : []),
    arcSender: async (tx) => (senders++, read.push(tx), { from: `0x${tx.slice(-40)}`, value: 0n, at: iso(1) }),
  });
  assert.equal(senders, READ_CAPS.arcSenders);
  assert.deepEqual(new Set(read), new Set(logs.slice(50).map((l) => l.tx)), 'the newest 200 (logs come oldest first)');
  assert.equal(s.partial, true);
});

test('5.7 readMergedPrs: merged PRs by the login to repos they do not own, top 30 by target stars', async () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ html_url: `https://github.com/org${i}/r/pull/1`, repository_url: `https://api.github.com/repos/org${i}/r`, pull_request: { merged_at: iso(i) } }));
  const gh = async <T,>(path: string): Promise<T> => {
    if (path.startsWith('/search/issues')) return { items: [...items, { html_url: 'https://github.com/lee/own/pull/2', repository_url: 'https://api.github.com/repos/lee/own', pull_request: { merged_at: iso(1) } }] } as T;
    if (path.includes('/pulls/')) return { merged_by: { login: 'maintainer' } } as T;
    const m = /\/repos\/org(\d+)\/r$/.exec(path);
    return { stargazers_count: m ? Number(m[1]) * 10 : 0 } as T;
  };
  const prs = await readMergedPrs('lee', { ...base, gh });
  assert.equal(prs.length, 30);
  assert.equal(prs[0].target, 'org39/r');
  assert.ok(prs.every((p) => !p.target.startsWith('lee/')));
});

test('final I2 readMergedPrs: PRs into the person\'s own orgs never count', async () => {
  const items = ['acme', 'Other', 'lee'].map((o) => ({ html_url: `https://github.com/${o}/r/pull/1`, repository_url: `https://api.github.com/repos/${o}/r`, pull_request: { merged_at: iso(1) } }));
  const gh = async <T,>(path: string): Promise<T> => {
    if (path.startsWith('/search/issues')) return { items } as T;
    if (path.includes('/pulls/')) return { merged_by: { login: 'maintainer' } } as T;
    return { stargazers_count: 500 } as T;
  };
  const prs = await readMergedPrs('lee', { ...base, gh }, ['ACME']);
  assert.deepEqual(prs.map((p) => p.target), ['other/r']);
});

test('5.8 ownership: own non-fork, non-template, never derived; an org repo only as top contributor', () => {
  const r = { owner: 'lee', owner_type: 'User', created_at: null, fork: false, template: false, stargazers: [], forkers: [], issue_authors: [], contributors: [], commit_weeks: [], partial: false };
  assert.equal(repoOwned(r, 'lee', false, false), true);
  assert.equal(repoOwned({ ...r, fork: true }, 'lee', false, false), false);
  assert.equal(repoOwned({ ...r, template: true }, 'lee', false, false), false);
  assert.equal(repoOwned(r, 'lee', false, true), false, 'repoEverDerived');
  assert.equal(repoOwned({ ...r, owner: 'acme', owner_type: 'Organization' }, 'lee', true, false), true);
  assert.equal(repoOwned({ ...r, owner: 'ann', owner_type: 'User' }, 'lee', true, false), false, 'a personal repo of someone else, even as top contributor');
  assert.equal(repoOwned({ ...r, owner: 'acme' }, 'lee', false, false), false);
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

test('5.14 only finite numbers and lowercase ids are stored; bad refs and names throw before any read', async () => {
  const days = [{ day: '2026-10-01', downloads: 'x' }, { day: '2026-10-02', downloads: 7 }, { day: '2026-10-03', downloads: Infinity }];
  const npm = await readNpm('tipjar', { ...base, json: async <T,>(url: string) => (url.includes('downloads/range') ? { downloads: days } : {}) as T });
  assert.ok(Number.isFinite(npm.weekly));
  assert.equal(npm.weekly, 7 / 4);
  await assert.rejects(readPypi('tip-jar', { ...base, json: async <T,>(url: string) => (url.includes('pypistats') ? { data: {} } : { info: {} }) as T }));
  await assert.rejects(readContract(`base:0x${'1'.repeat(40)}`, new Date(iso(365)), { ...base, usdPerNative: async () => NaN }));
  await assert.rejects(readContract('solana:abc', new Date(iso(365)), base));
  await assert.rejects(readContract('base:0x12', new Date(iso(365)), base));
  await assert.rejects(readRepo('lee/../../admin', base), /not a repo/);
  await assert.rejects(readMergedPrs('lee is:public', base), /not a GitHub login/);
  const page = { items: [{ timestamp: iso(1), status: 'ok', from: { hash: '0xAbC0000000000000000000000000000000000001' }, value: 'garbage' }], next_page_params: null };
  const s = await readContract(`base:0x${'1'.repeat(40)}`, new Date(iso(365)), { ...base, baseTxs: async () => page });
  assert.deepEqual(s.callers.map((c) => [c.id, c.value_usd]), [['wallet:0xabc0000000000000000000000000000000000001', 0]]);
  const arc = await readContract(`arc:0x${'2'.repeat(40)}`, new Date(iso(365)), {
    ...base,
    arcLogs: async (_a, from) => (from === 0n ? [{ tx: '0x1' }, { tx: '0x1' }, { tx: '0x2' }] : []),
    arcSender: async (tx) => ({ from: tx === '0x1' ? '0xABCDEF0000000000000000000000000000000001' : '0xabcdef0000000000000000000000000000000002', value: 2_000_000_000_000_000_000n, at: tx === '0x1' ? iso(1) : iso(400) }),
  });
  assert.deepEqual(arc.callers.map((c) => [c.id, c.value_usd]), [['wallet:0xabcdef0000000000000000000000000000000001', 2]], 'one read per tx, older than since dropped');
  assert.equal(arc.partial, false);
});

test('5.15 a full first page of forks or issues is partial (only one page is read)', async () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ owner: { login: `F${i}` }, created_at: iso(4) }));
  const gh = async <T,>(path: string): Promise<T> => {
    if (path === '/repos/lee/tipjar') return { owner: { login: 'Lee' }, fork: false } as T;
    if (path.includes('/forks')) return many as T;
    if (path.startsWith('/users/')) return { created_at: iso(900) } as T;
    return [] as T;
  };
  const s = await readRepo('Lee/TipJar'.toLowerCase(), { ...base, gh });
  assert.equal(s.owner, 'lee');
  assert.equal(s.partial, true);
  assert.ok(s.forkers.every((w) => w.id === w.id.toLowerCase()));
});

test('5.16 stargazers come oldest first: a 1,000-star repo reads pages 8 to 10 and is partial', async () => {
  const asked: number[] = [];
  const gh = async <T,>(path: string): Promise<T> => {
    if (path === '/repos/lee/big') return { owner: { login: 'lee', type: 'User' }, fork: false, stargazers_count: 1000 } as T;
    const m = /stargazers\?per_page=100&page=(\d+)$/.exec(path);
    if (m) {
      asked.push(Number(m[1]));
      return Array.from({ length: 100 }, (_, i) => ({ starred_at: iso(1), user: { login: `s${m[1]}x${i}` } })) as T;
    }
    if (path.startsWith('/users/')) return { created_at: iso(900) } as T;
    return [] as T;
  };
  const s = await readRepo('lee/big', { ...base, gh });
  assert.deepEqual(asked, [8, 9, 10]);
  assert.equal(s.stargazers.length, 300);
  assert.equal(s.partial, true);
  const none: number[] = [];
  await readRepo('lee/big', { ...base, gh: async <T,>(path: string) => (path === '/repos/lee/big' ? { owner: { login: 'lee' }, fork: false, stargazers_count: 0 } : (path.includes('stargazers') && none.push(1), [])) as T });
  assert.deepEqual(none, [], 'no stars, no stargazer read');
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
  const stop = async () => { throw new GitHubBudgetStop(); };
  const gh2 = async <T,>(path: string): Promise<T> => {
    if (path === '/repos/lee/tipjar') return { owner: { login: 'lee' }, fork: false, stargazers_count: 1 } as T;
    if (path.includes('stargazers')) return [{ starred_at: iso(1), user: { login: 'ann' } }] as T;
    if (path.startsWith('/users/')) return stop();
    return [] as T;
  };
  await assert.rejects(readRepo('lee/tipjar', { ...base, gh: gh2 }), GitHubBudgetStop);
  await assert.rejects(readMergedPrs('lee', { ...base, gh: async <T,>(p: string) => (p.startsWith('/search') ? ({ items: [{ html_url: 'https://github.com/o/r/pull/1', repository_url: 'https://api.github.com/repos/o/r' }] } as T) : stop()) }), GitHubBudgetStop);
});

test('5.18 account ages from the previous reading are reused, not read again', async () => {
  const users: string[] = [];
  const gh = async <T,>(path: string): Promise<T> => {
    if (path === '/repos/lee/tipjar') return { owner: { login: 'lee' }, fork: false, stargazers_count: 2 } as T;
    if (path.includes('stargazers')) return [{ starred_at: iso(1), user: { login: 'Ann' } }, { starred_at: iso(1), user: { login: 'bo' } }] as T;
    if (path.startsWith('/users/')) return (users.push(path), { created_at: iso(10) }) as T;
    return [] as T;
  };
  const prev = { stargazers: [{ id: 'gh:ann', at: iso(5), created_at: iso(800) }, { id: 'gh:bo', at: iso(5), created_at: null }] };
  const s = await readRepo('lee/tipjar', { ...base, gh }, prev);
  assert.deepEqual(users, ['/users/bo'], 'a known age is reused; an unknown one is read again');
  assert.deepEqual(s.stargazers.map((w) => w.created_at), [iso(800), iso(10)]);
});

test('5.19 merged PRs: self-merged or unreadable mergers do not count; star lookups stop at READ_CAPS.prs * 2', async () => {
  const items = Array.from({ length: 70 }, (_, i) => ({ html_url: `https://github.com/org${i}/r/pull/${i + 1}`, repository_url: `https://api.github.com/repos/org${i}/r`, pull_request: { merged_at: iso(1) } }));
  let starReads = 0;
  const gh = async <T,>(path: string): Promise<T> => {
    if (path.startsWith('/search/issues')) return { items } as T;
    const pull = /\/repos\/org(\d+)\/r\/pulls\/(\d+)$/.exec(path);
    if (pull) {
      const i = Number(pull[1]);
      if (i === 59) return { merged_by: { login: 'LEE' } } as T;
      if (i === 58) throw new Error('404');
      return { merged_by: { login: 'maintainer' } } as T;
    }
    starReads++;
    return { stargazers_count: Number(/org(\d+)/.exec(path)![1]) } as T;
  };
  const prs = await readMergedPrs('Lee', { ...base, gh });
  assert.equal(starReads, READ_CAPS.prs * 2);
  assert.equal(prs.length, READ_CAPS.prs);
  assert.equal(prs[0].target, 'org57/r', 'org59 self-merged, org58 unreadable');
  assert.ok(prs.every((p) => p.author === 'lee' && Number(p.target.slice(3, -2)) < 60));
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

test('3.5 a Base call keeps its ERC-8021 codes; coin traders skip shared contracts and the person', async () => {
  const { Attribution } = await import('ox/erc8021');
  const tagged = `0xabcdef${Attribution.toDataSuffix({ codes: ['ek_abc123', 'earnkit'] }).slice(2)}`;
  const d = {
    usdPerNative: async () => 2000, now: NOW,
    baseTxs: async () => ({ items: [{ timestamp: '2026-10-10T00:00:00Z', status: 'ok', from: { hash: '0xAA' }, raw_input: tagged, value: '0' }], next_page_params: null }),
  } as never;
  const s = await readContract('base:0x' + '1'.repeat(40), new Date('2026-01-01'), d);
  assert.deepEqual(s.callers[0].codes, ['ek_abc123', 'earnkit']);
  // Full 40-hex addresses: readCoin skips anything ADDRESS refuses.
  const [BB, CC, ME] = ['b', 'c', 'e'].map((x) => '0x' + x.repeat(40));
  const t = {
    tokenTransfers: async () => ({ items: [
      { timestamp: '2026-10-10T00:00:00Z', from: { hash: '0x' + '9'.repeat(40) }, to: { hash: BB.toUpperCase().replace('0X', '0x') } },
      { timestamp: '2026-10-10T00:00:00Z', from: { hash: BB }, to: { hash: CC } },
      { timestamp: '2026-10-10T00:00:00Z', from: { hash: CC }, to: { hash: ME } },
    ], next_page_params: null }), now: NOW,
  } as never;
  const c = await readCoin('base:0x' + '2'.repeat(40), new Date('2026-01-01'), t, new Set([`wallet:${ME}`]));
  assert.deepEqual(c.traders.map((w) => w.id).sort(), [`wallet:${BB}`, `wallet:${CC}`]);
});
