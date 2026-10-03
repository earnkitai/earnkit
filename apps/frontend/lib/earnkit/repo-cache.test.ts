import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { isFresh, loadRepoFacts, saveRepoFacts } from './repo-cache';

test('isFresh: an hour', () => {
  const t = new Date('2026-10-03T10:00:00Z');
  assert.equal(isFresh(t, new Date('2026-10-03T10:59:59Z')), true);
  assert.equal(isFresh(t, new Date('2026-10-03T11:00:00Z')), false);
});

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

test(
  'repo facts: keyed by repo and pushed_at; a push or an hour makes a miss',
  db,
  async () => {
    const repo = `Test/Cache-${process.pid}-${Date.now()}`;
    const v1 = '2026-10-01T00:00:00Z';
    const facts = {
      chains: { base: { mainnet: true, testnet: false, evidence: 'x' } },
      commits_since: { '2026-09-01T00:00:00.000Z': true },
    };
    await saveRepoFacts(repo, v1, facts);
    const hit = await loadRepoFacts(repo.toLowerCase(), v1);
    assert.deepEqual(hit?.chains, facts.chains);
    assert.deepEqual(hit?.commits_since, facts.commits_since);
    // A new push is a new key, and replaces the old version.
    assert.equal(await loadRepoFacts(repo, '2026-10-02T00:00:00Z'), null);
    await saveRepoFacts(repo, '2026-10-02T00:00:00Z', facts);
    assert.equal(await loadRepoFacts(repo, v1), null);
    // Past its hour: a miss.
    await saveRepoFacts(repo, v1, facts, new Date(Date.now() - 61 * 60_000));
    assert.equal(await loadRepoFacts(repo, v1), null);
    await sql()`DELETE FROM github_repo_facts WHERE full_name = ${repo.toLowerCase()}`;
  },
);
