import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { readPersonLive } from './person-score';
import { readSources } from './sources';
import type { ReaderDeps } from './source-readers';

/**
 * Scoring and clarity R16b: the outside calls one person's daily read (readSources) and one on-demand refresh
 * (readPersonLive) make, by kind. The person has a repo of their own, an organization's repo, a live site, an npm
 * package, a verified Base contract, a coin, a merged PR source and (refresh only) a proposed contract. Every read
 * answers one page, so the counts are the floor: a busy contract or coin reads up to READ_CAPS.basePages pages.
 */
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const T = 2_116_200_000 + (process.pid % 1000) * 4;
const NOW = new Date('2026-10-14T10:00:00Z');

type Tally = Record<string, number>;
function countingReader(tally: Tally, queries: string[]): ReaderDeps {
  const tick = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);
  const node = (key: string, org: boolean) => ({
    nameWithOwner: key, description: null, homepageUrl: null, isFork: false, isTemplate: false, isPrivate: false,
    createdAt: '2026-01-01T00:00:00Z', pushedAt: NOW.toISOString(), stargazerCount: 3, forkCount: 1, parent: null, templateRepository: null,
    owner: { __typename: org ? 'Organization' : 'User', login: key.split('/')[0] },
    stargazers: { edges: [] }, forks: { nodes: [] },
    defaultBranchRef: { target: { history: { nodes: [{ committedDate: NOW.toISOString() }] } } },
  });
  return {
    now: NOW,
    ghGraphql: async <R,>(q: string, v: Record<string, unknown>) => {
      tick('github_graphql');
      queries.push(q);
      const data: Record<string, unknown> = {};
      for (let i = 0; `o${i}` in v; i++) data[`r${i}`] = node(`${v[`o${i}`]}/${v[`n${i}`]}`, String(v[`o${i}`]).startsWith('acme'));
      return { data } as R;
    },
    gh: async <R,>(path: string) => {
      tick(path.includes('/activity') ? 'github_rest_push_check' : 'github_rest_other');
      if (path.includes('/activity')) return [] as R;
      if (path.includes('/contributors')) return [{ login: 'teammate' }] as R;
      if (path.includes('/pulls/')) return { merged_at: '2026-09-01T00:00:00Z' } as R;
      return { stargazers_count: 40 } as R;
    },
    probe: async () => (tick('site'), { status: 200 }),
    fetchText: async () => (tick('site'), ''),
    json: async <R,>() => (tick('npm'), { downloads: 12 } as R),
    baseTxs: async () => (tick('blockscout'), { items: [], next_page_params: null }),
    tokenTransfers: async () => (tick('blockscout'), { items: [], next_page_params: null }),
    contractOrigin: async () => (tick('blockscout'), { deployer: null, created_at: null }),
    arcLogs: async () => (tick('arc_rpc'), []),
    arcHead: async () => (tick('arc_rpc'), 0n),
    arcSender: async () => { tick('arc_rpc'); throw new Error('none'); },
    usdPerNative: async () => (tick('price'), 3000),
    walletCreations: async () => (tick('blockscout'), []),
  } as ReaderDeps;
}

async function person(id: number) {
  await sql()`DELETE FROM source_live WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id = ${id})`;
  await sql()`DELETE FROM source_readings WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id = ${id})`;
  for (const t of ['builder_profiles', 'builder_sources', 'builder_projects']) await sql()`DELETE FROM ${sql()(t)} WHERE builder_id = ${id}`;
  await sql()`DELETE FROM installations WHERE id = ${id}`;
  await sql()`INSERT INTO installations (id, token_hash) VALUES (${id}, ${`r16b-${id}`})`;
  const own = `lee${id}/app`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, github_login, main_project_key) VALUES (${id}, ${`r16b-${id}`}, ${`lee${id}`}, ${own})`;
  const hex = (d: string) => `0x${d.repeat(32)}${String(id).padStart(8, '0').slice(-8)}`;
  const src = (kind: string, ref: string, state = 'verified', proof: string | null = 'repo_owner') => sql()`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, ${kind}, ${ref}, ${own}, ${state}, ${proof}, 'server')`;
  await src('repo', own);
  await src('repo', `acme${id}/tool`);
  await src('site', `https://lee${id}.example.com`, 'verified', 'earnkit_txt');
  await src('package_npm', `lee${id}-kit`, 'verified', 'repo_link');
  await src('contract', `base:${hex('a')}`, 'verified', 'deployer');
  await src('coin', `base:${hex('b')}`, 'verified', 'deployer');
  await src('merged_pr', `https://github.com/big${id}/lib/pull/7`, 'verified', 'github_signin');
  await src('contract', `base:${hex('c')}`, 'proposed', null);
}

const total = (t: Tally) => Object.values(t).reduce((n, x) => n + x, 0);

test('R16b the daily read: stars, forks, users and money are no longer read', dbTest, async () => {
  await person(T);
  const tally: Tally = {};
  const queries: string[] = [];
  await readSources(NOW, { deadline: Date.now() + 10_000, reader: countingReader(tally, queries), only: [T] });
  console.log('[R16b] daily', JSON.stringify(tally), 'total', total(tally));
  assert.ok(queries.length > 0 && queries.every((q) => !/stargazers|forks\(|stargazerCount|forkCount/.test(q)), 'no stars or forks in the repo query');
  assert.deepEqual(tally, { github_graphql: 1, github_rest_push_check: 2, site: 1, npm: 1 });
});

test('R16b the on-demand refresh: no contract, coin or proposed-contract reads, no contributors call', dbTest, async () => {
  await person(T + 1);
  const tally: Tally = {};
  const queries: string[] = [];
  await readPersonLive(T + 1, NOW, { deadline: Date.now() + 10_000, reader: countingReader(tally, queries) });
  console.log('[R16b] refresh', JSON.stringify(tally), 'total', total(tally));
  assert.ok(queries.every((q) => !/stargazers|forks\(|stargazerCount|forkCount/.test(q)));
  assert.deepEqual(tally, { github_graphql: 1, github_rest_push_check: 2, site: 1, npm: 1 });
});
