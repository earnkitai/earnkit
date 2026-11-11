import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { REPO_NOTE } from './reply';
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
  // v6.1.9: the code read beats the report; it finds no Builder Codes, and the builder is told once.
  assert.equal(f.builder_codes, false);
  assert.deepEqual(f.notes, ['no_builder_codes']);
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
const kept = async () => (await sql()`SELECT facts FROM repo_cache`).map((r) => r.facts);
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

test('a cached repo that turns private drops out: reported only, its facts gone, a miss kept (L26-9)', async () => {
  const rec = replayFetch('nextjs-dashboard');
  const p = project({ repo_url: `https://github.com/${rec.repo}` });
  await repoFacts(p, { gh: rec.fetch, now: NOW });
  assert.equal(await cached(), 1);
  const priv = replayFetch('nextjs-dashboard', (u, b) => (u.endsWith(`/repos/${rec.repo.toLowerCase()}`) ? b.replace(/"private":\s*false/, '"private":true') : b));
  const f = await repoFacts(p, { gh: priv.fetch, now: new Date(NOW.getTime() + DAY) });
  assert.equal(f.public, false);
  assert.equal(f.as_reported, true);
  assert.deepEqual(await kept(), [{ miss: 'private' }]);
});

test('a repo gone (404) on revalidation also drops its facts; a miss is kept (L26-9)', async () => {
  const rec = replayFetch('nextjs-dashboard');
  const p = project({ repo_url: `https://github.com/${rec.repo}` });
  await repoFacts(p, { gh: rec.fetch, now: NOW });
  const f = await repoFacts(p, { gh: failing(rec, /api\.github\.com\/repos\/[^/]+\/[^/]+$/, 404), now: new Date(NOW.getTime() + DAY) });
  assert.equal(f.as_reported, true);
  assert.deepEqual(await kept(), [{ miss: 'gone' }]);
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
  // L1g-3 (v6.1.15): a public repo on another code host is not an error: EarnKit reads GitHub only.
  assert.deepEqual((await repoFacts(project({ repo_url: 'https://gitlab.com/a/b' }), { now: NOW })).notes, ['other_host']);
  assert.deepEqual((await repoFacts(project({ repo_url: 'https://codeberg.org/a/b' }), { now: NOW })).notes, ['other_host']);
  assert.deepEqual((await repoFacts(project({ repo_url: 'https://gitlab.com/a/b', private: true }), { now: NOW })).notes, ['private']);
  assert.equal(REPO_NOTE.other_host, 'I read GitHub repos only; matched on what you told me.');
  const down = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  assert.deepEqual((await repoFacts(project({ repo_url: `https://github.com/${rec.repo}` }), { gh: down, now: NOW })).notes, ['unread']);
});

test('N-6 (v6.1.9): a cache row saved before v6.1.8 (no fork or archived field) is stale and re-read, so the archived and fork sentences come back', async () => {
  for (const [slug, note] of [['archived-dashboard', 'archived'], ['fork-dashboard', 'fork']] as const) {
    await sql()`DELETE FROM repo_cache`;
    const first = replayFetch(slug);
    const p = project({ repo_url: `https://github.com/${first.repo}` });
    await repoFacts(p, { gh: first.fetch, now: NOW });
    // The row as the pre-v6.1.8 cache wrote it: no fork, archived, empty or readme_lead keys.
    await sql()`UPDATE repo_cache SET facts = facts - 'fork' - 'archived' - 'empty' - 'readme_lead'`;
    const [old] = await sql()`SELECT facts FROM repo_cache`;
    assert.ok(!('fork' in old.facts) && !('archived' in old.facts));
    // Within the hour a fresh row is never re-read; this one is, since it lacks the fields.
    const again = replayFetch(slug);
    const f = await repoFacts(p, { gh: again.fetch, now: new Date(NOW.getTime() + 60_000) });
    assert.ok(again.calls.length > 1, JSON.stringify(again.calls));
    assert.deepEqual(f.notes, [note]);
    const [row] = await sql()`SELECT facts FROM repo_cache`;
    assert.equal(row.facts[note], true);
    // Now complete, the row is a cache hit again.
    const third = replayFetch(slug);
    await repoFacts(p, { gh: third.fetch, now: new Date(NOW.getTime() + 120_000) });
    assert.equal(third.calls.length, 0);
  }
});

test('L1c-4 (v6.1.10): an empty repo (its tree read fails) is cached like any other: the next read is free and makes one call', async () => {
  const { hit, LIMITS } = await import('./rate-limit');
  const id = 900_000 + Math.floor(Math.random() * 1000);
  const rec = replayFetch('empty-repo');
  const p = project({ repo_url: `https://github.com/${rec.repo}` });
  const first = await repoFacts(p, { gh: rec.fetch, now: NOW, installationId: id });
  assert.deepEqual(first.notes, ['empty']);
  assert.equal(await cached(), 1);
  // Within the hour: from the cache, no GitHub call and no read counted.
  const again = replayFetch('empty-repo');
  const second = await repoFacts(p, { gh: again.fetch, now: new Date(NOW.getTime() + 60_000), installationId: id });
  assert.deepEqual([second.notes, again.calls.length], [['empty'], 0]);
  // One read counted for the installation, not two.
  const left = await hit(`repoRead:${id}`, LIMITS.repoRead.limit, LIMITS.repoRead.windowSeconds, NOW);
  assert.equal(left.remaining, LIMITS.repoRead.limit - 2);
});

test('F7 (v6.1.12): after a code step the unpushed repo is checked once; the row keeps the check time and is trusted until a push', async () => {
  const rec = replayFetch('nextjs-dashboard');
  const p = project({ repo_url: `https://github.com/${rec.repo}` });
  await repoFacts(p, { gh: rec.fetch, now: NOW });
  const step = new Date(NOW.getTime() + 5 * 60_000);
  const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
  const before = rec.calls.length;
  await repoFacts(p, { gh: rec.fetch, now: at(6), staleAfter: step });
  assert.equal(rec.calls.length, before + 1, 'one check of the repo object');
  const [row] = await sql()<{ checked: string; fetched_at: Date }[]>`SELECT facts->>'checked_at' AS checked, fetched_at FROM repo_cache`;
  assert.equal(row.checked, at(6).toISOString());
  assert.equal(row.fetched_at.toISOString(), NOW.toISOString());
  for (const min of [7, 8, 9]) await repoFacts(p, { gh: rec.fetch, now: at(min), staleAfter: step });
  assert.equal(rec.calls.length, before + 1, 'no call while unpushed');
  // A later code step checks again, once.
  await repoFacts(p, { gh: rec.fetch, now: at(11), staleAfter: at(10) });
  await repoFacts(p, { gh: rec.fetch, now: at(12), staleAfter: at(10) });
  assert.equal(rec.calls.length, before + 2);
  // A push re-reads everything, and the new row has no check time.
  const pushed = replayFetch('nextjs-dashboard', (u, b) => (u.endsWith(`/repos/${rec.repo.toLowerCase()}`) ? b.replace(/"pushed_at":\s*"[^"]*"/, '"pushed_at":"2026-11-05T00:00:00Z"') : b));
  await repoFacts(p, { gh: pushed.fetch, now: at(21), staleAfter: at(20) });
  assert.ok(pushed.calls.length > 1);
  const [fresh] = await sql()<{ checked: string | null; fetched_at: Date }[]>`SELECT facts->>'checked_at' AS checked, fetched_at FROM repo_cache`;
  assert.deepEqual([fresh.checked, fresh.fetched_at.toISOString()], [null, at(21).toISOString()]);
});

test('Task 11 fix round 1 (I1): README text and the homepage are cleaned, read fresh or from a cache written before', async () => {
  const { readmeExcerpt, readmeLead, cachedRepoFacts } = await import('./repo-facts');
  const { prefill } = await import('./prefill');
  const { programFixture } = await import('./fixtures/program');
  const HIDDEN = /[\u0000\u202e\u200b]/;
  const md = '# Timer\u202egnp\n\nKeeps\u200b time for\u0000 builders who ship. More.';
  assert.doesNotMatch(readmeExcerpt(md)!, HIDDEN);
  assert.equal(readmeLead(md), 'Keeps time for builders who ship.');
  // A cached read holding the hidden characters (written before this release) is cleaned when read (jsonb holds no NUL).
  const rec = replayFetch('earnkit');
  const repo_url = `https://github.com/${rec.repo}`;
  await repoFacts(project({ repo_url }), { gh: rec.fetch, now: NOW });
  await sql()`UPDATE repo_cache SET facts = facts || ${sql().json({ readme_excerpt: 'Keeps\u200b time \u202eok.', readme_lead: 'Keeps\u200b time for builders \u202enow.', homepage: 'https://ti\u200bmer.example/' })}`;
  const f = (await cachedRepoFacts({ ...project({ repo_url }), description: '' }))!;
  assert.doesNotMatch(`${f.readme_excerpt}${f.description}${f.homepage}${f.live_url}`, HIDDEN);
  assert.equal(f.description, 'Keeps time for builders now.');
  const file = programFixture({ id: 'rf-i1', title: 'I1 Grant' });
  const row = { id: 'rf-i1', file: { ...file, submission_requirements: [{ key: 'tagline', label: 'Tagline', type: 'text', required: true, kind: 'one_liner', from: 'project' }, { key: 'story', label: 'Story', type: 'text', required: false, kind: 'how_it_works', from: 'project' }] } } as never;
  const fields = prefill(row, f).fields;
  assert.doesNotMatch(JSON.stringify(fields), /\\u0000|\\u202e|\\u200b|\u202e|\u200b/);
  assert.equal(fields.find((x) => x.key === 'tagline')!.value, 'Keeps time for builders now.');
});

const reads = async (id: number) => Number((await sql()`SELECT coalesce(sum(count), 0)::int AS n FROM rate_windows WHERE key = ${`repoRead:${id}`}`)[0].n);

test('L26-9 (v6.1.16): a missing repo is read once in 30 minutes: three finds make one GitHub call and count no read', async () => {
  const id = 7_100 + Math.floor(Math.random() * 1_000);
  await sql()`DELETE FROM rate_windows WHERE key = ${`repoRead:${id}`}`;
  const calls: string[] = [];
  const gone = (async (u: RequestInfo | URL) => (calls.push(String(u)), new Response('{"message":"Not Found"}', { status: 404 }))) as typeof fetch;
  const p = project({ repo_url: 'https://github.com/nobody/missing-l269' });
  for (let i = 0; i < 3; i++) {
    const f = await repoFacts(p, { gh: gone, now: new Date(NOW.getTime() + i * 60_000), installationId: id });
    assert.equal(f.as_reported, true);
    assert.deepEqual(f.notes, ['unread']);
    assert.equal(REPO_NOTE.unread, 'I could not read the repo; matched on what you told me.');
  }
  assert.equal(calls.length, 1);
  assert.equal(await reads(id), 0);
  // Past 30 minutes the repo is read again (still not counted).
  await repoFacts(p, { gh: gone, now: new Date(NOW.getTime() + 31 * 60_000), installationId: id });
  assert.equal(calls.length, 2);
  assert.equal(await reads(id), 0);
});

test('L26-9: a private answer is kept the same way and reads private again with no call', async () => {
  const rec = replayFetch('nextjs-dashboard');
  const priv = replayFetch('nextjs-dashboard', (u, b) => (u.endsWith(`/repos/${rec.repo.toLowerCase()}`) ? b.replace(/"private":\s*false/, '"private":true') : b));
  const p = project({ repo_url: `https://github.com/${rec.repo}` });
  const first = await repoFacts(p, { gh: priv.fetch, now: NOW, installationId: 7_099 });
  const n = priv.calls.length;
  const again = await repoFacts(p, { gh: priv.fetch, now: new Date(NOW.getTime() + 60_000), installationId: 7_099 });
  assert.equal(priv.calls.length, n);
  assert.deepEqual(again.notes, first.notes);
  assert.deepEqual(again.notes, ['private']);
});

test('L26-8 (v6.1.16): one 20 s budget for the whole read: GitHub that never answers is slow in 20 s; at 14 s a request it is never 38 s; neither counts a read', async () => {
  const keep = setTimeout(() => {}, 30_000);
  try {
    const never = (async () => new Promise<Response>(() => {})) as typeof fetch;
    const rec = replayFetch('nextjs-dashboard');
    const slow14 = ((u: RequestInfo | URL, i?: RequestInit) => new Promise((ok) => setTimeout(ok, 14_000)).then(() => rec.fetch(u, i))) as typeof fetch;
    const timed = async (gh: typeof fetch, repo: string, id: number) => {
      const t = Date.now();
      const f = await repoFacts(project({ repo_url: `https://github.com/${repo}` }), { gh, now: NOW, installationId: id });
      return { f, ms: Date.now() - t };
    };
    const a = 7_300 + Math.floor(Math.random() * 100);
    const b = 7_400 + Math.floor(Math.random() * 100);
    await sql()`DELETE FROM rate_windows WHERE key IN (${`repoRead:${a}`}, ${`repoRead:${b}`})`;
    const [x, y] = await Promise.all([timed(never, 'nobody/never-answers', a), timed(slow14, rec.repo, b)]);
    assert.ok(Math.abs(x.ms - 20_000) <= 1_000, `${x.ms}`);
    assert.deepEqual(x.f.notes, ['slow']);
    assert.equal(x.f.as_reported, true);
    assert.equal(REPO_NOTE.slow, 'GitHub was slow; matched on what you told me. I read it again next time.');
    assert.equal(await reads(a), 0);
    assert.ok(y.ms < 21_000, `${y.ms}`);
    assert.ok(y.f.public || y.f.notes?.includes('slow'), JSON.stringify(y.f.notes));
    if (!y.f.public) assert.equal(await reads(b), 0);
    // A slow read is kept 10 minutes as a marker, never as facts.
    assert.ok((await kept()).every((f) => (f as { miss?: string }).miss === 'slow'));
  } finally {
    clearTimeout(keep);
  }
});

test('controller ruling (L26-9 review): misses count on their own 20 a day: 20 distinct missing repos, then the paused line; the next real read still works; a repeat miss costs nothing', async () => {
  const id = 7_600 + Math.floor(Math.random() * 1_000);
  await sql()`DELETE FROM rate_windows WHERE key IN (${`repoRead:${id}`}, ${`repoMiss:${id}`})`;
  const calls: string[] = [];
  const rec = replayFetch('nextjs-dashboard');
  const gh = ((u: RequestInfo | URL, i?: RequestInit) => (String(u).includes('/nobody/') ? (calls.push(String(u)), Promise.resolve(new Response('{}', { status: 404 }))) : rec.fetch(u, i))) as typeof fetch;
  const deps = { gh, now: NOW, installationId: id };
  for (let n = 1; n <= 20; n++) {
    const f = await repoFacts(project({ repo_url: `https://github.com/nobody/missing-${n}` }), deps);
    assert.deepEqual(f.notes, ['unread'], `miss ${n}`);
  }
  // A repeat miss within 30 minutes: no call, no count.
  const before = calls.length;
  assert.deepEqual((await repoFacts(project({ repo_url: 'https://github.com/nobody/missing-1' }), deps)).notes, ['unread']);
  assert.equal(calls.length, before);
  const over = await repoFacts(project({ repo_url: 'https://github.com/nobody/missing-21' }), deps);
  assert.deepEqual(over.notes, ['paused']);
  assert.equal(REPO_NOTE.paused, 'Repo reads are paused until tomorrow; matched on what you told me.');
  // The day's real reads are untouched by the 20 misses: a real repo still reads.
  const real = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}` }), deps);
  assert.equal(real.public, true);
});

test('controller ruling (L26-8 review): a slow repo is kept 10 minutes: the next find is slow again with no call and no count', async () => {
  const keep = setTimeout(() => {}, 30_000);
  try {
    const id = 7_700 + Math.floor(Math.random() * 100);
    await sql()`DELETE FROM rate_windows WHERE key IN (${`repoRead:${id}`}, ${`repoMiss:${id}`})`;
    let n = 0;
    const never = (async () => (n++, new Promise<Response>(() => {}))) as typeof fetch;
    const p = project({ repo_url: 'https://github.com/nobody/slow-l268' });
    assert.deepEqual((await repoFacts(p, { gh: never, now: NOW, installationId: id })).notes, ['slow']);
    const calls = n;
    assert.deepEqual((await repoFacts(p, { gh: never, now: new Date(NOW.getTime() + 9 * 60_000), installationId: id })).notes, ['slow']);
    assert.equal(n, calls);
    const counts = await sql()`SELECT key, count FROM rate_windows WHERE key IN (${`repoRead:${id}`}, ${`repoMiss:${id}`}) ORDER BY key`;
    assert.deepEqual(counts.map((r) => [r.key, r.count]), [[`repoMiss:${id}`, 1], [`repoRead:${id}`, 0]]);
  } finally {
    clearTimeout(keep);
  }
});

test('fix round 1 (I1, N1): one 20 s budget covers the cached repo\'s push check too; slow over a cached repo answers with its facts', async () => {
  const keep = setTimeout(() => {}, 30_000);
  try {
    const id = 7_800 + Math.floor(Math.random() * 100);
    await sql()`DELETE FROM rate_windows WHERE key IN (${`repoRead:${id}`}, ${`repoMiss:${id}`})`;
    const rec = replayFetch('nextjs-dashboard');
    const p = project({ repo_url: `https://github.com/${rec.repo}` });
    assert.equal((await repoFacts(p, { gh: rec.fetch, now: NOW, installationId: id })).public, true);
    // Two hours on, the repo was pushed since: the push check, then the read, each request 14 s.
    const pushed = replayFetch('nextjs-dashboard', (u, b) => (u.endsWith(`/repos/${rec.repo.toLowerCase()}`) ? b.replace(/"pushed_at":\s*"[^"]+"/, '"pushed_at":"2030-01-01T00:00:00Z"') : b));
    const slow14 = ((u: RequestInfo | URL, i?: RequestInit) => new Promise((ok) => setTimeout(ok, 14_000)).then(() => pushed.fetch(u, i))) as typeof fetch;
    const t = Date.now();
    const f = await repoFacts(p, { gh: slow14, now: new Date(NOW.getTime() + 2 * 3_600_000), installationId: id });
    const ms = Date.now() - t;
    assert.ok(Math.abs(ms - 20_000) <= 1_000, `${ms}`);
    assert.equal(f.public, true);
    assert.deepEqual(f.notes, []);
    assert.equal(await reads(id), 1);
    assert.equal(await cached(), 1);
    assert.ok(!(await kept()).some((x) => (x as { miss?: string }).miss));
  } finally {
    clearTimeout(keep);
  }
});
