import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { replayFetch } from '../v5/fixtures/github';
import { blockscout } from './explorers';
import { flattenRows, readEvidence } from './evidence';
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
