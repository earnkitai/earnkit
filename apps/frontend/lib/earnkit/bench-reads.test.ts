import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { PERSON_GITHUB_QUERY, OWNED_REPOS_QUERY } from './person-github';
import { readPersonLive } from './person-score';
import { readSources, withPastCounts } from './sources';
import { discover } from './discovery';
import type { ReaderDeps } from './source-readers';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const NOW = new Date();
const T = 2_131_300_000 + (process.pid % 1000) * 20;

const node = (key: string) => ({
  nameWithOwner: key, description: null, homepageUrl: null, isFork: false, isTemplate: false, isPrivate: false,
  createdAt: '2026-01-01T00:00:00Z', pushedAt: NOW.toISOString(), stargazerCount: 0, forkCount: 0, parent: null, templateRepository: null,
  owner: { __typename: 'User', login: key.split('/')[0] },
  stargazers: { edges: [] }, forks: { nodes: [] },
  defaultBranchRef: { target: { history: { nodes: [{ committedDate: NOW.toISOString() }] } } },
});
/** A reader that answers by-name repo queries and records every query; any other read throws. */
function reader(queries: string[]): ReaderDeps {
  const no = async () => { throw new Error('unexpected read'); };
  return {
    gh: no, probe: no, fetchText: no, json: no, baseTxs: no, tokenTransfers: no, contractOrigin: no, arcLogs: no, arcHead: no, arcSender: no, usdPerNative: no, walletCreations: no, now: NOW,
    ghGraphql: async <R>(q: string, v: Record<string, unknown>) => {
      queries.push(q);
      const data: Record<string, unknown> = {};
      for (let i = 0; `o${i}` in v; i++) data[`r${i}`] = node(`${v[`o${i}`]}/${v[`n${i}`]}`);
      return { data } as R;
    },
  } as ReaderDeps;
}
async function personWithRepos(id: number, login: string, n: number) {
  await sql()`DELETE FROM source_live WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id = ${id})`;
  await sql()`DELETE FROM source_readings WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id = ${id})`;
  for (const t of ['builder_profiles', 'builder_sources', 'builder_projects']) await sql()`DELETE FROM ${sql()(t)} WHERE builder_id = ${id}`;
  await sql()`DELETE FROM installations WHERE id = ${id}`;
  await sql()`INSERT INTO installations (id, token_hash) VALUES (${id}, ${`v213-reads-${id}`})`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, github_login) VALUES (${id}, ${`v213r-${id}`}, ${login})`;
  for (let i = 0; i < n; i++)
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
      VALUES (${id}, 'repo', ${`${login}/r${i}`}, ${`${login}/r${i}`}, 'verified', 'repo_owner', 'server')`;
}

test('3.1 withPastCounts keeps the larger count per week, drops weeks past 52 and junk', () => {
  const now = new Date('2026-10-14T00:00:00Z');
  assert.deepEqual(
    withPastCounts({ '2026-W42': 3, '2026-W41': 1 }, { commit_counts: { '2026-W41': 4, '2026-W30': 2, '2025-W30': 9, junk: 1, '2026-W29': -1 } }, now),
    { '2026-W30': 2, '2026-W41': 4, '2026-W42': 3 },
  );
  assert.deepEqual(withPastCounts({ '2026-W42': 1 }, null, now), { '2026-W42': 1 });
});

test('3.2 the refresh reads a person\'s repos by name only, never the person query, and keeps commit_counts', dbTest, async () => {
  const id = T + 1;
  await personWithRepos(id, `lee${T}`, 3);
  const queries: string[] = [];
  const r = await readPersonLive(id, NOW, { deadline: Date.now() + 10_000, reader: reader(queries) });
  assert.equal(r.read, 3);
  assert.equal(queries.length, 1, 'one by-name call for 3 repos');
  assert.ok(!queries.some((q) => q === PERSON_GITHUB_QUERY || q === OWNED_REPOS_QUERY));
  const [live] = await sql()<{ signals: { commit_counts?: Record<string, number> } }[]>`
    SELECT l.signals FROM source_live l JOIN builder_sources s ON s.id = l.source_id WHERE s.builder_id = ${id} LIMIT 1`;
  assert.equal(Object.values(live.signals.commit_counts ?? {}).reduce((a, b) => a + b, 0), 1);
});

test('3.3 the daily read batches 25 repos a call across builders (30 repos of 2 people: 2 calls)', dbTest, async () => {
  await personWithRepos(T + 2, `ann${T}`, 20);
  await personWithRepos(T + 3, `bob${T}`, 10);
  const queries: string[] = [];
  const r = await readSources(NOW, { deadline: Date.now() + 20_000, reader: reader(queries), only: [T + 2, T + 3] });
  assert.equal(r.read, 30);
  assert.equal(queries.length, 2);
  assert.ok(!queries.includes(PERSON_GITHUB_QUERY));
});

test('3.4 discovery under the flag never lists every repo or org of a proven login', dbTest, async () => {
  const id = T + 4;
  const login = `cat${T}`;
  await personWithRepos(id, login, 0);
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proposed_by) VALUES (${id}, 'repo', ${`${login}/main`}, ${`${login}/main`}, 'proposed', 'agent')`;
  await sql()`UPDATE builder_profiles SET main_project_key = ${`${login}/main`} WHERE builder_id = ${id}`;
  await sql()`INSERT INTO discovery_queue (builder_id, reason) VALUES (${id}, 'first_find') ON CONFLICT (builder_id) DO UPDATE SET done_at = NULL`;
  const paths: string[] = [];
  const d = reader([]);
  d.gh = async <R>(path: string) => {
    paths.push(path);
    if (path === `/users/${login}`) return { blog: null, twitter_username: null } as R;
    if (path === `/repos/${login}/main`) return { full_name: `${login}/main`, owner: { login, type: 'User' }, fork: false, is_template: false } as R;
    return (path.includes('/git/trees/') ? {} : []) as R;
  };
  await discover(NOW, { deadline: Date.now() + 20_000, reader: d, login: async () => ({ login, basis: 'signin' }), only: [id] });
  assert.ok(!paths.some((p) => p.startsWith(`/users/${login}/repos`) || p.endsWith('/orgs')), paths.join(', '));
  const [src] = await sql()<{ state: string; proof: string | null }[]>`SELECT state, proof FROM builder_sources WHERE builder_id = ${id} AND ref = ${`${login}/main`}`;
  assert.deepEqual(src, { state: 'verified', proof: 'repo_owner' });
});

test('3.5 flag off: the refresh still reads a person\'s own repos through the person query (parity)', dbTest, async () => {
  const id = T + 5;
  await personWithRepos(id, `dan${T}`, 2);
  const queries: string[] = [];
  const d = reader(queries);
  const inner = d.ghGraphql;
  d.ghGraphql = async <R>(q: string, v: Record<string, unknown>) => {
    if (q === PERSON_GITHUB_QUERY) {
      queries.push(q);
      return { data: { user: { login: `dan${T}`, twitterUsername: null, websiteUrl: null, repositories: { nodes: [node(`dan${T}/r0`), node(`dan${T}/r1`)] } } } } as R;
    }
    return inner<R>(q, v);
  };
  try {
    await readPersonLive(id, NOW, { deadline: Date.now() + 10_000, reader: d });
    assert.deepEqual(queries, [PERSON_GITHUB_QUERY]);
  } finally {
  }
});
