import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { PERSON_GITHUB_QUERY, OWNED_REPOS_QUERY } from './person-github';
import { readPersonLive } from './person-score';
import { needsPushCheck, pushedWeeks, readPushes, readSources, storedCommits, withPastCounts, withPastWeeks } from './sources';
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
    gh: no, probe: no, fetchText: no, json: no, contractOrigin: no, walletCreations: no, now: NOW,
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
  const prev = { commit_weeks: ['2026-W38', '2026-W40'], commit_counts: { '2026-W38': 2, '2026-W40': 1 }, reader: 2 };
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
  // Hotfix 2026-10-19: a reading by an older reader (no `reader`, or below REPO_READER) is no baseline: re-taken once.
  assert.deepEqual(withPastWeeks(weeks, { ...prev, reader: undefined }, now), weeks);
  assert.deepEqual(withPastWeeks(weeks, { ...prev, reader: 1 }, now), weeks);
});

test('3.1c fix rounds 2 to 5 (rule 4): a reading is verified by GitHub\'s push record; no record or nothing listed leave it unverified (last 4 weeks) until a later check verifies it', () => {
  const now = new Date('2026-10-14T00:00:00Z'); // 2026-W42
  const weeks = ['2026-W30', '2026-W39', '2026-W40', '2026-W41', '2026-W42'];
  const rec = (pushes: string[]) => ({ pushes, covered: true });
  // All pushed on Oct 13 (W42): only W42 and W41 count.
  assert.deepEqual(pushedWeeks(weeks, rec(['2026-10-13T10:00:00Z'])), ['2026-W41', '2026-W42']);
  assert.deepEqual(pushedWeeks(weeks, rec(['2026-10-13T10:00:00Z', '2026-09-30T10:00:00Z'])), ['2026-W39', '2026-W40', '2026-W41', '2026-W42']);
  assert.equal(pushedWeeks(weeks, null), null, 'the endpoint failed or the deadline cut it');
  assert.equal(pushedWeeks(weeks, rec([])), null, 'nothing listed');
  // Fix round 5: the newest page is full. Landings on both pages back weeks; an unbacked week counts only strictly
  // between the oldest page's newest event and the newest page's oldest event, when both pages are full.
  const full = (seen: string, asc: { pushes: string[]; full: boolean; newest: string | null } | null) => ({ pushes: ['2026-10-13T10:00:00Z'], covered: false, seen, asc });
  assert.deepEqual(
    pushedWeeks(weeks, full('2026-10-13T09:00:00Z', { pushes: ['2025-10-01T00:00:00Z'], full: true, newest: '2026-10-13T08:00:00Z' })),
    ['2026-W41', '2026-W42'], 'one push a year ago plus a flood today: no gap, the backdated weeks never count');
  assert.deepEqual(
    pushedWeeks(weeks, full('2026-10-06T00:00:00Z', { pushes: ['2026-07-20T00:00:00Z'], full: true, newest: '2026-07-28T00:00:00Z' })),
    weeks, 'a real gap between two full pages (W31 to W41): W39 and W40 count unbacked, W30 by the oldest page');
  assert.deepEqual(
    pushedWeeks(weeks, full('2026-10-06T00:00:00Z', { pushes: ['2026-07-20T00:00:00Z'], full: false, newest: '2026-07-28T00:00:00Z' })),
    ['2026-W30', '2026-W41', '2026-W42'], 'the oldest page not full: backed weeks only');
  assert.deepEqual(
    pushedWeeks(weeks, full('2026-10-06T00:00:00Z', { pushes: [], full: true, newest: '2026-09-30T00:00:00Z' })),
    ['2026-W41', '2026-W42'], 'the gap is strict: W40 holds the oldest page\'s newest event, W41 the newest page\'s oldest');
  assert.equal(pushedWeeks(weeks, full('2026-10-06T00:00:00Z', null)), null, 'the oldest page not read');
  // storedCommits: verified, then rule 3 only.
  const first = storedCommits({ commit_weeks: weeks, commit_counts: { '2026-W30': 5, '2026-W42': 2 } }, null, now, rec(['2026-10-13T10:00:00Z']));
  assert.deepEqual(first, { commit_weeks: ['2026-W41', '2026-W42'], commit_counts: { '2026-W42': 2 }, pushes_checked: true, reader: 2 });
  assert.equal(needsPushCheck(first), false);
  assert.deepEqual(storedCommits({ commit_weeks: weeks }, first, now, null).commit_weeks, ['2026-W41', '2026-W42'], 'no new past weeks after a verified reading');
  // Unverified: weeks kept as read; it is no rule 3 baseline and is checked again, with no fallback to all weeks.
  const u1 = storedCommits({ commit_weeks: weeks }, null, now, null);
  assert.deepEqual(u1, { commit_weeks: weeks, commit_counts: {}, pushes_checked: false, reader: 2 });
  assert.equal(needsPushCheck(u1), true);
  let u = u1;
  for (let i = 0; i < 5; i++) u = storedCommits({ commit_weeks: ['2026-W42'] }, u, now, i % 2 ? null : rec([]));
  assert.deepEqual([u.pushes_checked, u.commit_weeks], [false, weeks], 'still unverified after many failed checks; the earlier weeks are kept');
  const v = storedCommits({ commit_weeks: ['2026-W42'] }, u, now, rec(['2026-10-13T10:00:00Z']));
  assert.deepEqual([v.pushes_checked, v.commit_weeks], [true, ['2026-W41', '2026-W42']], 'a later check verifies');
});

test('3.1d fix rounds 2 to 5: readPushes reads one page of /activity, then the oldest page (direction=asc) when it is full; landing events only; null on a failure', async () => {
  const full = Array.from({ length: 100 }, (_, i) => ({ timestamp: `2026-10-${String(1 + (i % 9)).padStart(2, '0')}T00:00:00Z`, activity_type: i === 0 ? 'branch_creation' : i === 1 ? 'branch_deletion' : 'push' }));
  const asc = [{ timestamp: '2026-01-01T00:00:00Z', activity_type: 'branch_deletion' }, { timestamp: '2026-02-01T00:00:00Z', activity_type: 'pr_merge' }, { timestamp: '2026-03-01T00:00:00Z', activity_type: 'issue' }];
  const asked: string[] = [];
  const get = async <T,>(path: string): Promise<T | null> => {
    asked.push(path);
    return (path.includes('direction=asc') ? asc : full) as T;
  };
  const r = await readPushes('lee/app', get);
  assert.deepEqual(asked, ['/repos/lee/app/activity?per_page=100', '/repos/lee/app/activity?direction=asc&per_page=100']);
  assert.equal(r!.pushes.length, 99, 'a branch creation lands commits too (fix round 3); a deletion does not');
  assert.deepEqual([r!.covered, r!.seen], [false, '2026-10-01T00:00:00.000Z']);
  assert.deepEqual(r!.asc, { pushes: ['2026-02-01T00:00:00Z'], full: false, newest: '2026-03-01T00:00:00.000Z' });
  // The oldest page fails: the reading can't be judged past the newest page.
  const r2 = await readPushes('lee/app', async <T,>(path: string) => (path.includes('direction=asc') ? null : full) as T);
  assert.deepEqual([r2!.covered, r2!.asc], [false, null]);
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
