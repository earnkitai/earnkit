import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { FREE_LIMITS, countingDeps, flushReadUsage } from './read-usage';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

test('3.8 each provider call is counted once; every provider has a stated free limit', async () => {
  const base = { probe: async () => ({ status: 200 }), json: async () => ({}), ghGraphql: async () => ({}), baseTxs: async () => ({ items: [], next_page_params: null }), now: new Date() } as never;
  const { deps, counts } = countingDeps(base);
  await deps.probe('https://a.example.com');
  await deps.json('https://api.npmjs.org/downloads/point/last-week/a');
  await deps.json('https://pypistats.org/api/packages/a/recent');
  await deps.ghGraphql('q', {});
  assert.equal(counts.get('site'), 1);
  assert.equal(counts.get('npm'), 1);
  assert.equal(counts.get('pypi'), 1);
  assert.equal(counts.get('github_graphql'), 1);
  for (const p of ['github_graphql', 'github_rest', 'blockscout', 'arc_rpc', 'npm', 'pypi', 'site'] as const) assert.ok(FREE_LIMITS[p].basis.length > 0, p);
});

test('3.12 real deps report each HTTP request; counting stops with stop()', () => {
  const requests: { tick: ((p: never) => void) | null } = { tick: null };
  const d = { requests, contractOrigin: async () => ({ deployer: null, created_at: null }), now: new Date() } as never;
  const { counts, stop } = countingDeps(d);
  requests.tick!('blockscout' as never);
  requests.tick!('blockscout' as never);
  requests.tick!('arc_rpc' as never);
  assert.equal(counts.get('blockscout'), 2);
  assert.equal(counts.get('arc_rpc'), 1);
  stop();
  assert.equal(requests.tick, null, 'released');
});

test('3.13 flushReadUsage adds the counts to the day row', dbTest, async () => {
  const day = '2001-01-0' + (1 + (process.pid % 9));
  await sql()`DELETE FROM read_usage WHERE day = ${day}`;
  await flushReadUsage(day, new Map([['npm', 3]]));
  await flushReadUsage(day, new Map([['npm', 2], ['site', 0]]));
  const rows = await sql()<{ provider: string; reads: number }[]>`SELECT provider, reads FROM read_usage WHERE day = ${day}`;
  assert.deepEqual(rows.map((r) => [r.provider, r.reads]), [['npm', 5]]);
  await sql()`DELETE FROM read_usage WHERE day = ${day}`;
});
