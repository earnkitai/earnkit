import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FREE_LIMITS, countingDeps } from './read-usage';

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
