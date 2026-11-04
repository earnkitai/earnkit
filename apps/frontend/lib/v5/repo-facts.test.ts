import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { repoFacts } from './repo-facts';
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

test('Base app: mainnet by code, its own contract kept on base, known tokens dropped', async () => {
  const rec = replayFetch('onchain-reaction');
  const f = await repoFacts(project({ repo_url: `https://github.com/${rec.repo}` }), { gh: rec.fetch, now: NOW });
  assert.ok(f.chains.some((c) => c.chain === 'base' && c.mainnet && c.basis === 'code'));
  assert.ok(f.contracts.some((c) => c.chain === 'base' && c.address === '0x50f88fe97f72cd3e75b9eb4f747f59bceba80d59'));
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
  assert.deepEqual(f.contracts, [{ chain: 'base', address: '0x' + 'b'.repeat(40) }]);
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
