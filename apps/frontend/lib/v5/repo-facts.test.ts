import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { detectCode, repoFacts, sweepRepoCache } from './repo-facts';
import { parseProject } from './project-input';
import { replayFetch } from './fixtures/github';

after(() => sql().end());
beforeEach(() => sql()`DELETE FROM repo_cache`);

const NOW = new Date('2026-11-04T12:00:00Z');
const DAY = 86_400_000;
const project = (over: Record<string, unknown>) => {
  const r = parseProject({ name: 'App', description: 'An app.', ...over });
  assert.ok(r.ok);
  return r.project;
};

test('EarnKit: base mainnet by code, readme excerpt under 2 KB, markup stripped', async () => {
  const rec = replayFetch('earnkit');
  const f = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}` }), { gh: rec.fetch, now: NOW });
  assert.equal(f.public, true);
  assert.equal(f.as_reported, false);
  assert.ok(f.chains.some((c) => c.chain === 'base' && c.mainnet && c.basis === 'code'));
  assert.ok(f.readme_excerpt && f.readme_excerpt.length <= 2048 && f.readme_excerpt.length > 100);
  assert.doesNotMatch(f.readme_excerpt, /[#*`]|\]\(|<[a-z]/);
  assert.match(f.first_commit_at ?? '', /^\d{4}-\d\d-\d\dT/);
  assert.match(f.last_commit_at ?? '', /^\d{4}-\d\d-\d\dT/);
  assert.ok(Date.parse(f.first_commit_at!) < Date.parse(f.last_commit_at!));
  assert.equal(f.builder_codes, false);
});

test('Base app: mainnet by code; known tokens dropped; no address on a guessed chain', async () => {
  const rec = replayFetch('onchain-reaction');
  const f = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}` }), { gh: rec.fetch, now: NOW });
  assert.ok(f.chains.some((c) => c.chain === 'base' && c.mainnet && c.basis === 'code'));
  // Its contract files sit in multi-chain files or in camel-case names with no chain word: left out, not guessed.
  for (const c of f.contracts) assert.ok(f.chains.some((x) => x.chain === c.chain));
  for (const c of f.contracts) assert.match(c.address, /^0x[0-9a-f]{40}$/);
  assert.ok(!f.contracts.some((c) => c.address === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'));
});

test('a plain web app has no chains and no contracts', async () => {
  const rec = replayFetch('nextjs-dashboard');
  const f = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}` }), { gh: rec.fetch, now: NOW });
  assert.deepEqual(f.chains, []);
  assert.deepEqual(f.contracts, []);
  assert.equal(f.public, true);
});

test('a Solana repo is found by its Anchor.toml with the mainnet program', async () => {
  const rec = replayFetch('saber-distributor');
  const f = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}` }), { gh: rec.fetch, now: NOW });
  assert.deepEqual(f.chains, [{ chain: 'solana', mainnet: true, basis: 'code' }]);
});

test('a Solana repo with devnet only is not called mainnet', async () => {
  const rec = replayFetch('saber-distributor');
  const devnet = rec.fetch;
  const f = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}` }), {
    gh: ((u: RequestInfo | URL) =>
      String(u).endsWith('/Anchor.toml')
        ? Promise.resolve(new Response('[programs.devnet]\nx = "y"\n[provider]\ncluster = "devnet"'))
        : devnet(u)) as typeof fetch,
    now: NOW,
  });
  assert.deepEqual(f.chains, [{ chain: 'solana', mainnet: false, basis: 'code' }]);
});

test('reported facts fill the gaps; live_url and demo_url from the report win; reported chains merge', async () => {
  const rec = replayFetch('nextjs-dashboard');
  const f = await repoFacts(
    project({
      repo_url: `https://github.com/${rec.repo}`,
      live_url: 'https://app.example.com/',
      demo_url: 'https://demo.example.com/',
      chains: [{ chain: 'base', mainnet: true, contract: '0x' + 'b'.repeat(40) }],
      builder_codes: true,
      users: true,
    }),
    { gh: rec.fetch, now: NOW },
  );
  assert.equal(f.live_url, 'https://app.example.com/');
  assert.equal(f.demo_url, 'https://demo.example.com/');
  assert.deepEqual(f.chains, [{ chain: 'base', mainnet: true, basis: 'reported' }]);
  assert.deepEqual(f.contracts, [{ chain: 'base', address: '0x' + 'b'.repeat(40), basis: 'reported' }]);
  assert.equal(f.live_url_basis, 'reported');
  assert.equal(f.demo_url_basis, 'reported');
  assert.equal(f.repo_url_basis, 'code');
  assert.equal(f.builder_codes, true);
  assert.equal(f.users, true);
  assert.equal(f.public, true);
});

test('Builder Codes in code are found even when the report says nothing', async () => {
  const rec = replayFetch('onchain-reaction', (u, b) => (u.endsWith('/lib/contracts.ts') ? `${b}\nimport { Attribution } from 'ox/erc8021';\n` : b));
  const f = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}` }), { gh: rec.fetch, now: NOW });
  assert.equal(f.builder_codes, true);
});

test('a private project is reported only', async () => {
  const rec = replayFetch('earnkit');
  const f = await repoFacts(project({ repo_url: 'https://github.com/someone/secret', private: true, chains: [{ chain: 'arc', mainnet: false }], live_url: 'https://x.example.com/' }), {
    gh: rec.fetch,
    now: NOW,
  });
  assert.equal(rec.calls.length, 0);
  assert.equal(f.public, false);
  assert.equal(f.as_reported, true);
  assert.deepEqual(f.chains, [{ chain: 'arc', mainnet: false, basis: 'reported' }]);
  assert.equal(f.repo_url, 'https://github.com/someone/secret');
  assert.equal(f.readme_excerpt, null);
  assert.equal(f.live_url, 'https://x.example.com/');
  assert.equal(f.repo_url_basis, 'reported');
  assert.equal(f.live_url_basis, 'reported');
});

test('an unreadable public repo falls back to the report; no repo_url is reported only', async () => {
  const rec = replayFetch('earnkit');
  const gone = await repoFacts(project({ repo_url: 'https://github.com/nobody/nothing', chains: [{ chain: 'base', mainnet: true }] }), { gh: rec.fetch, now: NOW });
  assert.equal(gone.public, false);
  assert.equal(gone.as_reported, true);
  const none = await repoFacts(project({}), { gh: rec.fetch, now: NOW });
  assert.equal(none.as_reported, true);
  assert.equal(none.repo_url, null);
  assert.equal(rec.calls.length, 1);
});

test('a non-GitHub repo_url is not read', async () => {
  const rec = replayFetch('earnkit');
  const f = await repoFacts(project({ repo_url: 'https://gitlab.com/a/b' }), { gh: rec.fetch, now: NOW });
  assert.equal(rec.calls.length, 0);
  assert.equal(f.as_reported, true);
});

test('cache: a second call within the hour makes no fetch; after a day an unchanged push re-reads only the repo object', async () => {
  const rec = replayFetch('nextjs-dashboard');
  const p = project({ repo_url: `https://GitHub.com/${rec.repo.toUpperCase()}/` });
  await repoFacts(p, { gh: rec.fetch, now: NOW });
  const first = rec.calls.length;
  assert.ok(first > 3);
  const again = await repoFacts(p, { gh: rec.fetch, now: new Date(NOW.getTime() + 60_000) });
  assert.equal(rec.calls.length, first);
  assert.equal(again.public, true);
  await repoFacts(p, { gh: rec.fetch, now: new Date(NOW.getTime() + DAY) });
  assert.equal(rec.calls.length, first + 1);
  const rows = await sql()`SELECT repo FROM repo_cache`;
  assert.deepEqual(rows.map((r) => r.repo), [rec.repo.toLowerCase()]);
});

test('cache: a new push re-reads everything; so does a row older than 7 days', async () => {
  const rec = replayFetch('nextjs-dashboard');
  const p = project({ repo_url: `https://github.com/${rec.repo}` });
  await repoFacts(p, { gh: rec.fetch, now: NOW });
  const first = rec.calls.length;
  const pushed = replayFetch('nextjs-dashboard', (u, b) => (u.endsWith(`/repos/${rec.repo.toLowerCase()}`) ? b.replace(/"pushed_at":\s*"[^"]*"/, '"pushed_at":"2026-11-05T00:00:00Z"') : b));
  await repoFacts(p, { gh: pushed.fetch, now: new Date(NOW.getTime() + 2 * DAY) });
  assert.ok(pushed.calls.length >= first);
  const old = replayFetch('nextjs-dashboard');
  await repoFacts(p, { gh: old.fetch, now: new Date(NOW.getTime() + 10 * DAY) });
  assert.ok(old.calls.length >= first);
});

const cached = async () => (await sql()`SELECT repo FROM repo_cache`).length;
/** A fetch that answers `status` to URLs matching `re`, else replays the recording. */
const failing = (rec: ReturnType<typeof replayFetch>, re: RegExp, status: number, body = 'x'): typeof fetch =>
  ((u: RequestInfo | URL, i?: RequestInit) => (re.test(String(u)) ? (rec.calls.push(String(u)), Promise.resolve(new Response(body, { status }))) : rec.fetch(u, i))) as typeof fetch;

test('a 403 on the tree call: usable facts, nothing cached', async () => {
  const rec = replayFetch('onchain-reaction');
  const f = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}`, chains: [{ chain: 'arc', mainnet: false }] }), {
    gh: failing(rec, /\/git\/trees\//, 403),
    now: NOW,
  });
  assert.equal(f.public, true);
  assert.deepEqual(f.chains, [{ chain: 'arc', mainnet: false, basis: 'reported' }]);
  assert.equal(await cached(), 0);
});

test('a failed picked-file read is partial and not cached', async () => {
  const rec = replayFetch('onchain-reaction');
  const f = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}` }), { gh: failing(rec, /\/lib\/contracts\.ts$/i, 500), now: NOW });
  assert.equal(f.public, true);
  assert.equal(await cached(), 0);
});

test('a 429 on the first read: reported only, nothing cached', async () => {
  const rec = replayFetch('onchain-reaction');
  const f = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}`, chains: [{ chain: 'base', mainnet: true }] }), {
    gh: failing(rec, /api\.github\.com\/repos\/[^/]+\/[^/]+$/, 429),
    now: NOW,
  });
  assert.equal(f.public, false);
  assert.equal(f.as_reported, true);
  assert.deepEqual(f.chains, [{ chain: 'base', mainnet: true, basis: 'reported' }]);
  assert.equal(await cached(), 0);
});

test('an address in database.ts with no chain signal is no contract', () => {
  const text = `export const OWNER = '0x${'c'.repeat(40)}';`;
  assert.deepEqual(detectCode([{ path: 'src/database.ts', text }, { path: 'src/search.ts', text }], []).contracts, []);
});

test('a chain slug as a whole path word attributes an address, but only for a detected chain', () => {
  const addr = `0x${'d'.repeat(40)}`;
  const text = `const A = '${addr}';`;
  const withChain = detectCode([{ path: 'contracts/Base.sol', text }, { path: 'x/config.ts', text: 'https://mainnet.base.org' }], []);
  assert.deepEqual(withChain.contracts, [{ chain: 'base', address: addr }]);
  assert.deepEqual(detectCode([{ path: 'contracts/Base.sol', text }], []).contracts, []);
});

test('stale row, 403 on revalidation: the cached facts come back with no more calls', async () => {
  const rec = replayFetch('onchain-reaction');
  const p = project({ repo_url: `https://github.com/${rec.repo}` });
  const first = await repoFacts(p, { gh: rec.fetch, now: NOW });
  const before = rec.calls.length;
  const later = await repoFacts(p, { gh: failing(rec, /api\.github\.com\/repos\/[^/]+\/[^/]+$/, 403), now: new Date(NOW.getTime() + DAY) });
  assert.equal(rec.calls.length, before + 1);
  assert.equal(later.public, true);
  assert.deepEqual(later.chains, first.chains);
  assert.equal(await cached(), 1);
});

test('a cached repo that turns private drops out: reported only, row gone', async () => {
  const rec = replayFetch('nextjs-dashboard');
  const p = project({ repo_url: `https://github.com/${rec.repo}` });
  await repoFacts(p, { gh: rec.fetch, now: NOW });
  assert.equal(await cached(), 1);
  const priv = replayFetch('nextjs-dashboard', (u, b) => (u.endsWith(`/repos/${rec.repo.toLowerCase()}`) ? b.replace(/"private":\s*false/, '"private":true') : b));
  const f = await repoFacts(p, { gh: priv.fetch, now: new Date(NOW.getTime() + DAY) });
  assert.equal(f.public, false);
  assert.equal(f.as_reported, true);
  assert.equal(await cached(), 0);
});

test('a repo gone (404) on revalidation also drops the row', async () => {
  const rec = replayFetch('nextjs-dashboard');
  const p = project({ repo_url: `https://github.com/${rec.repo}` });
  await repoFacts(p, { gh: rec.fetch, now: NOW });
  const f = await repoFacts(p, { gh: failing(rec, /api\.github\.com\/repos\/[^/]+\/[^/]+$/, 404), now: new Date(NOW.getTime() + DAY) });
  assert.equal(f.as_reported, true);
  assert.equal(await cached(), 0);
});

test('no README: excerpt null, the rest intact and cached', async () => {
  const rec = replayFetch('saber-distributor');
  const tree = JSON.parse(JSON.stringify({ tree: [{ path: 'Anchor.toml', type: 'blob', size: 500 }] }));
  const f = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}` }), {
    gh: failing(rec, /\/git\/trees\//, 200, JSON.stringify(tree)),
    now: NOW,
  });
  assert.equal(f.readme_excerpt, null);
  assert.deepEqual(f.chains, [{ chain: 'solana', mainnet: true, basis: 'code' }]);
  assert.equal(await cached(), 1);
});

test('an empty tree: no chains, no excerpt, public, and cached', async () => {
  const rec = replayFetch('saber-distributor');
  const f = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}` }), { gh: failing(rec, /\/git\/trees\//, 200, '{"tree":[]}'), now: NOW });
  assert.equal(f.public, true);
  assert.deepEqual(f.chains, []);
  assert.equal(f.readme_excerpt, null);
  assert.equal(await cached(), 1);
});

test('the 11th uncached read in a day for one installation is skipped: reported only, with the problem line; a cache hit is free', async () => {
  const rec = replayFetch('nextjs-dashboard');
  const p = project({ repo_url: `https://github.com/${rec.repo}` });
  const deps = { gh: rec.fetch, now: NOW, installationId: 7_001 };
  for (let n = 1; n <= 10; n++) {
    if (n > 1) await sql()`DELETE FROM repo_cache`;
    const f = await repoFacts(p, deps);
    assert.equal(f.public, true, `read ${n}`);
    assert.equal(f.problems, undefined);
  }
  const hitCache = await repoFacts(p, deps);
  assert.equal(hitCache.public, true);
  await sql()`DELETE FROM repo_cache`;
  const calls = rec.calls.length;
  const paused = await repoFacts(p, deps);
  assert.equal(rec.calls.length, calls);
  assert.equal(paused.as_reported, true);
  assert.deepEqual(paused.problems, ['repo reads paused until tomorrow']);
  assert.deepEqual(paused.notes, ['paused']);
  const other = await repoFacts(p, { ...deps, installationId: 7_002 });
  assert.equal(other.public, true);
  const tomorrow = await repoFacts(p, { ...deps, now: new Date(NOW.getTime() + DAY) });
  assert.equal(tomorrow.public, true);
});

test('sweepRepoCache drops rows older than 30 days and keeps fresh ones', async () => {
  await sql()`INSERT INTO repo_cache (repo, facts, fetched_at) VALUES ('a/old', '{}', ${new Date(NOW.getTime() - 31 * DAY)}), ('a/fresh', '{}', ${new Date(NOW.getTime() - 29 * DAY)})`;
  assert.equal(await sweepRepoCache(NOW), 1);
  assert.deepEqual((await sql()`SELECT repo FROM repo_cache`).map((r) => r.repo), ['a/fresh']);
});

test('C55 (v6.1.8): a reported mainnet stands where the code found the chain without one; the code adds chains, never removes', async () => {
  const rec = replayFetch('saber-distributor');
  const devnet = ((u: RequestInfo | URL) =>
    String(u).endsWith('/Anchor.toml') ? Promise.resolve(new Response('[programs.devnet]\nx = "y"\n[provider]\ncluster = "devnet"')) : rec.fetch(u)) as typeof fetch;
  const orca = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
  const f = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}`, chains: [{ chain: 'solana', mainnet: true, contract: orca }, { chain: 'base', mainnet: false }] }), { gh: devnet, now: NOW });
  assert.equal(f.as_reported, false);
  assert.deepEqual(f.chains, [{ chain: 'solana', mainnet: true, basis: 'code' }, { chain: 'base', mainnet: false, basis: 'reported' }]);
  // A base58 address keeps its case (B21).
  assert.deepEqual(f.contracts, [{ chain: 'solana', address: orca, basis: 'reported' }]);
  // A reported testnet never lowers the code's mainnet.
  await sql()`DELETE FROM repo_cache`;
  const main = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}`, chains: [{ chain: 'solana', mainnet: false }] }), { gh: rec.fetch, now: NOW });
  assert.deepEqual(main.chains, [{ chain: 'solana', mainnet: true, basis: 'code' }]);
});

test('C58 (v6.1.8): with no description passed, the README\'s first sentence stands in', async () => {
  const rec = replayFetch('nextjs-dashboard');
  const r = parseProject({ name: 'Dashboard', repo_url: `https://github.com/${rec.repo}` });
  assert.ok(r.ok);
  const f = await repoFacts(r.project, { gh: rec.fetch, now: NOW });
  assert.equal(f.description, 'An admin dashboard built using Next.js framework and Tailwind CSS');
  // A passed description wins.
  const given = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}` }), { gh: rec.fetch, now: NOW });
  assert.equal(given.description, 'An app.');
  // Unread, nothing stands in.
  const unread = await repoFacts({ ...r.project, private: true }, { now: NOW });
  assert.equal(unread.description, '');
});

test('C59 (v6.1.8): a fork, an archived repo and an empty one are named; archived counts as not live', async () => {
  const read = async (slug: string) => {
    const rec = replayFetch(slug);
    return repoFacts(project({ repo_url: `https://github.com/${rec.repo}` }), { gh: rec.fetch, now: NOW });
  };
  const fork = await read('fork-dashboard');
  assert.deepEqual([fork.notes, fork.live_url, fork.as_reported], [['fork'], 'https://dashboard-v1-ashy.vercel.app', false]);
  const archived = await read('archived-dashboard');
  assert.deepEqual([archived.notes, archived.live_url, archived.live_url_basis, archived.homepage], [['archived'], null, null, 'https://dashboard-v1-ashy.vercel.app']);
  const empty = await read('empty-repo');
  assert.deepEqual([empty.notes, empty.public, empty.as_reported, empty.readme_excerpt], [['empty'], true, false, null]);
  const plain = await read('nextjs-dashboard');
  assert.deepEqual(plain.notes, []);
  // A cached row from before v6.1.8 has none of the three.
  await sql()`UPDATE repo_cache SET facts = facts - 'fork' - 'archived' - 'empty' - 'readme_lead'`;
  assert.deepEqual((await read('nextjs-dashboard')).notes, []);
});

test('B20 (v6.1.8): reads paused and a private repo are named once, each its own note', async () => {
  const priv = await repoFacts(project({ repo_url: 'https://github.com/someone/secret', private: true }), { now: NOW });
  assert.deepEqual(priv.notes, ['private']);
  const none = await repoFacts(project({}), { now: NOW });
  assert.deepEqual(none.notes, []);
  // Fix round 1: any other repo link not read is one note: a 404, a non-GitHub link, an outage.
  const rec = replayFetch('nextjs-dashboard');
  const gone = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}` }), { gh: failing(rec, /api\.github\.com\/repos\/[^/]+\/[^/]+$/, 404), now: NOW });
  assert.deepEqual([gone.as_reported, gone.notes], [true, ['unread']]);
  assert.deepEqual((await repoFacts(project({ repo_url: 'https://gitlab.com/a/b' }), { now: NOW })).notes, ['unread']);
  const down = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  assert.deepEqual((await repoFacts(project({ repo_url: `https://github.com/${rec.repo}` }), { gh: down, now: NOW })).notes, ['unread']);
});
