import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READ_CAPS, defaultReaderDeps, isoWeek, readContract, readMergedPrs, readNpm, readPypi, readRepo, readSite, type ReaderDeps } from './source-readers';
import { contractOwned, packageOwned, repoOwned, siteOwnedByText } from './sources';

const NOW = new Date('2026-10-12T12:00:00Z');
const iso = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const base: ReaderDeps = {
  gh: async () => { throw new Error('unexpected gh'); },
  probe: async () => ({ status: 200 }),
  fetchText: async () => '',
  json: async () => { throw new Error('unexpected json'); },
  baseTxs: async () => ({ items: [], next_page_params: null }),
  arcLogs: async () => [],
  arcHead: async () => 1_000n,
  arcSender: async () => { throw new Error('unexpected sender'); },
  usdPerNative: async (c) => (c === 'arc' ? 1 : 3_000),
  now: NOW,
};

test('5.1 readRepo: stargazers with starred_at and account age, forkers, issue authors (not PRs), contributors, commit weeks', async () => {
  const gh = async <T,>(path: string): Promise<T> => {
    const r: Record<string, unknown> = {
      '/repos/lee/tipjar': { owner: { login: 'lee' }, fork: false, is_template: false },
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
  const s = await readContract(`arc:0x${'2'.repeat(40)}`, new Date(iso(365)), {
    ...base,
    arcLogs: async (_a, from) => (from === 0n ? logs : []),
    arcSender: async (tx) => (senders++, { from: `0x${tx.slice(-40)}`, value: 0n, at: iso(1) }),
  });
  assert.equal(senders, READ_CAPS.arcSenders);
  assert.equal(s.partial, true);
});

test('5.7 readMergedPrs: merged PRs by the login to repos they do not own, top 30 by target stars', async () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ html_url: `https://github.com/org${i}/r/pull/1`, repository_url: `https://api.github.com/repos/org${i}/r`, pull_request: { merged_at: iso(i) } }));
  const gh = async <T,>(path: string): Promise<T> => {
    if (path.startsWith('/search/issues')) return { items: [...items, { html_url: 'https://github.com/lee/own/pull/2', repository_url: 'https://api.github.com/repos/lee/own', pull_request: { merged_at: iso(1) } }] } as T;
    const m = /\/repos\/org(\d+)\/r$/.exec(path);
    return { stargazers_count: m ? Number(m[1]) * 10 : 0 } as T;
  };
  const prs = await readMergedPrs('lee', { ...base, gh });
  assert.equal(prs.length, 30);
  assert.equal(prs[0].target, 'org39/r');
  assert.ok(prs.every((p) => !p.target.startsWith('lee/')));
});

test('5.8 ownership: own non-fork, non-template, never derived; an org repo only as top contributor', () => {
  const r = { owner: 'lee', fork: false, template: false, stargazers: [], forkers: [], issue_authors: [], contributors: [], commit_weeks: [], partial: false };
  assert.equal(repoOwned(r, 'lee', false, false), true);
  assert.equal(repoOwned({ ...r, fork: true }, 'lee', false, false), false);
  assert.equal(repoOwned({ ...r, template: true }, 'lee', false, false), false);
  assert.equal(repoOwned(r, 'lee', false, true), false, 'repoEverDerived');
  assert.equal(repoOwned({ ...r, owner: 'acme' }, 'lee', true, false), true);
  assert.equal(repoOwned({ ...r, owner: 'acme' }, 'lee', false, false), false);
});

test('5.9 ownership: a package needs its metadata repo to be a verified repo; a site needs the profile code', () => {
  assert.equal(packageOwned({ weekly: 1, repo_url: 'https://github.com/Lee/TipJar' }, new Set(['lee/tipjar'])), true);
  assert.equal(packageOwned({ weekly: 1, repo_url: 'https://github.com/other/tipjar' }, new Set(['lee/tipjar'])), false);
  assert.equal(packageOwned({ weekly: 1, repo_url: null }, new Set(['lee/tipjar'])), false);
  assert.equal(siteOwnedByText('profile: 0123456789abcdef', '0123456789abcdef'), true);
  assert.equal(siteOwnedByText('profile: 0123456789abcdef', null), false);
});

test('5.10 ownership: contracts by EarnKit\'s deploy for them, a proven wallet, or a verified repo\'s deploy files', () => {
  const w = new Set(['0xme']);
  assert.equal(contractOwned({ deployer: null, earnkitDeployed: true, inVerifiedRepo: false }, w), 'deployer');
  assert.equal(contractOwned({ deployer: '0xme', earnkitDeployed: false, inVerifiedRepo: false }, w), 'deploy_wallet');
  assert.equal(contractOwned({ deployer: '0xsomeone', earnkitDeployed: false, inVerifiedRepo: true }, w), 'repo_link');
  assert.equal(contractOwned({ deployer: '0xsomeone', earnkitDeployed: false, inVerifiedRepo: false }, w), null);
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
