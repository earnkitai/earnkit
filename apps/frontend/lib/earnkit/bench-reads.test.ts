import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { PERSON_GITHUB_QUERY, OWNED_REPOS_QUERY } from './person-github';
import { readPersonLive } from './person-score';
import { PUSH_TRIES, needsPushCheck, pushedWeeks, readPushes, readSources, storedCommits, withPastCounts, withPastWeeks } from './sources';
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

test('3.1b fix round 2 (anti-backdating rule 3): after a good reading, a new reading adds only this week and last week; older weeks keep their stored values', () => {
  const now = new Date('2026-10-14T00:00:00Z'); // 2026-W42
  const prev = { commit_weeks: ['2026-W38', '2026-W40'], commit_counts: { '2026-W38': 2, '2026-W40': 1 } };
  // Backdated: W33..W42 all appear at once; only W41 and W42 are new, W38 and W40 stay as stored.
  const weeks = Array.from({ length: 10 }, (_, i) => `2026-W${33 + i}`);
  assert.deepEqual(withPastWeeks(weeks, prev, now), ['2026-W38', '2026-W40', '2026-W41', '2026-W42']);
  assert.deepEqual(
    withPastCounts({ '2026-W33': 9, '2026-W38': 9, '2026-W40': 9, '2026-W41': 2, '2026-W42': 3 }, prev, now),
    { '2026-W38': 2, '2026-W40': 1, '2026-W41': 2, '2026-W42': 3 },
    'a stored week keeps its count; no new past week',
  );
  // No previous reading (or one without commit weeks): the reading stands as read.
  assert.deepEqual(withPastWeeks(['2026-W33', '2026-W42'], null, now), ['2026-W33', '2026-W42']);
  assert.deepEqual(withPastWeeks(['2026-W33'], { private: false }, now), ['2026-W33']);
});

test('3.1c fix rounds 2 and 3 (rule 4): a reading is verified by GitHub\'s push record; no record, nothing listed or a flood leave it unverified (last 4 weeks), retried up to 3 times', () => {
  const now = new Date('2026-10-14T00:00:00Z'); // 2026-W42
  const weeks = ['2026-W30', '2026-W39', '2026-W40', '2026-W41', '2026-W42'];
  const rec = (pushes: string[], covered = true) => ({ pushes, covered });
  // All pushed on Oct 13 (W42): only W42 and W41 count.
  assert.deepEqual(pushedWeeks(weeks, rec(['2026-10-13T10:00:00Z']), now), ['2026-W41', '2026-W42']);
  assert.deepEqual(pushedWeeks(weeks, rec(['2026-10-13T10:00:00Z', '2026-09-30T10:00:00Z']), now), ['2026-W39', '2026-W40', '2026-W41', '2026-W42']);
  assert.equal(pushedWeeks(weeks, null, now), null, 'the endpoint failed or the deadline cut it');
  assert.equal(pushedWeeks(weeks, rec([]), now), null, 'nothing listed');
  // The pages ran out: older weeks are judged only when the oldest push seen is 4+ weeks old (else a flood hid them).
  assert.equal(pushedWeeks(weeks, rec(['2026-10-13T10:00:00Z', '2026-10-01T00:00:00Z'], false), now), null, 'a flood of recent events');
  assert.deepEqual(pushedWeeks(weeks, rec(['2026-10-13T10:00:00Z', '2026-09-10T00:00:00Z'], false), now), ['2026-W30', '2026-W41', '2026-W42']);
  // storedCommits: verified, then rule 3 only.
  const first = storedCommits({ commit_weeks: weeks, commit_counts: { '2026-W30': 5, '2026-W42': 2 } }, null, now, rec(['2026-10-13T10:00:00Z']));
  assert.deepEqual(first, { commit_weeks: ['2026-W41', '2026-W42'], commit_counts: { '2026-W42': 2 }, pushes_checked: true });
  assert.equal(needsPushCheck(first), false);
  assert.deepEqual(storedCommits({ commit_weeks: weeks }, first, now, null).commit_weeks, ['2026-W41', '2026-W42'], 'no new past weeks after a verified reading');
  // Unverified: weeks kept as read, tries counted; it is no rule 3 baseline and is checked again.
  const u1 = storedCommits({ commit_weeks: weeks }, null, now, null);
  assert.deepEqual([u1.pushes_checked, u1.push_tries, u1.commit_weeks], [false, 1, weeks]);
  assert.equal(needsPushCheck(u1), true);
  const u2 = storedCommits({ commit_weeks: ['2026-W42'] }, u1, now, rec([]));
  assert.deepEqual([u2.pushes_checked, u2.push_tries, u2.commit_weeks], [false, 2, weeks], 'the earlier unverified weeks are kept');
  const v = storedCommits({ commit_weeks: ['2026-W42'] }, u2, now, rec(['2026-10-13T10:00:00Z']));
  assert.deepEqual([v.pushes_checked, v.commit_weeks], [true, ['2026-W41', '2026-W42']], 'a later check verifies');
  // The third failed try gives up: the creation floor alone (all weeks), verified from then on.
  const u3 = storedCommits({ commit_weeks: weeks }, u2, now, null);
  assert.deepEqual([u3.pushes_checked, u3.push_tries, u3.commit_weeks], [true, undefined, weeks]);
  assert.equal(PUSH_TRIES, 3);
});

test('3.1d fix rounds 2 and 3: readPushes reads at most 2 pages of /activity, landing events only (push, force push, branch creation, merges), null on a failure', async () => {
  const pages: Record<number, unknown> = {
    1: Array.from({ length: 100 }, (_, i) => ({ timestamp: `2026-10-${String(1 + (i % 9)).padStart(2, '0')}T00:00:00Z`, activity_type: i === 0 ? 'branch_creation' : 'push' })),
    2: Array.from({ length: 100 }, () => ({ timestamp: '2026-09-01T00:00:00Z', activity_type: 'pr_merge' })),
    3: [{ timestamp: '2026-01-01T00:00:00Z', activity_type: 'push' }],
  };
  const asked: string[] = [];
  const get = async <T,>(path: string): Promise<T | null> => {
    asked.push(path);
    return (pages[Number(/[?&]page=(\d+)/.exec(path)![1])] ?? null) as T;
  };
  const r = await readPushes('lee/app', get);
  assert.equal(asked.length, 2, 'two pages at most');
  assert.equal(r!.pushes.length, 200, 'a branch creation lands commits too (fix round 3)');
  assert.equal(r!.covered, false);
  assert.deepEqual(await readPushes('lee/app', async () => null), null);
  assert.deepEqual(await readPushes('lee/app', async () => { throw new Error('x'); }), null);
  assert.deepEqual(await readPushes('lee/app', async <T,>() => [{ timestamp: '2026-10-01T00:00:00Z', activity_type: 'push' }, { timestamp: '2026-10-02T00:00:00Z', activity_type: 'branch_deletion' }, { timestamp: '2026-10-03T00:00:00Z' }] as T), { pushes: ['2026-10-01T00:00:00Z'], covered: true });
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

test('3.4 discovery never lists every repo or org of a proven login, and (v2.14) never verifies a repo from a login', dbTest, async () => {
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
  await discover(NOW, { deadline: Date.now() + 20_000, reader: d, login: async () => ({ login, basis: 'app' }), only: [id] });
  assert.ok(!paths.some((p) => p.startsWith(`/users/${login}/repos`) || p.endsWith('/orgs')), paths.join(', '));
  const [src] = await sql()<{ state: string; proof: string | null }[]>`SELECT state, proof FROM builder_sources WHERE builder_id = ${id} AND ref = ${`${login}/main`}`;
  // v2.14 spec 2: only the read-only App proves a repo; a proven login confirms none of its repos.
  assert.deepEqual(src, { state: 'proposed', proof: null });
});
