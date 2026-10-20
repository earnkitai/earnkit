import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { commitWindows, needsAllWeeks, readGithubRepos, weeklyCommitsFrom, weeklyCommitsQuery } from './person-github';
import { ScoreDeadline } from './campaigns';
import { countedCommitWeeks } from './person-score';
import { computeScoreV2, scoreWhy } from './score-v2';
import { REPO_READER, needsPushCheck, readSources, storedCommits, writeReading } from './sources';
import type { ReaderDeps } from './source-readers';
import { isoWeekOf } from './weeks';

/**
 * Prod hotfix 2026-10-19 (jenilt, earnkitai/earnkit): Shipping 14, "Code in 1 of the last 12 weeks". The repo had
 * hundreds of commits a week, so the by-name query's newest 100 commits all fell in this week; the reading held
 * one week, and as a verified baseline (rule 3) it could never gain the earlier ones. Shaped like that repo:
 * ~250 commits a week for 4 weeks, one quiet week with a few, one commit 10 weeks ago, older weeks before the
 * 12; the activity record's newest page is 100 events in 3 days (pushes, branch creations, PR merges) and its
 * oldest page is full, from the repo's creation.
 */
const NOW = new Date();
const WEEK_MS = 7 * 86_400_000;
const weekAgo = (i: number) => isoWeekOf(new Date(NOW.getTime() - i * WEEK_MS));
const at = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();
const CREATED = new Date(NOW.getTime() - 60 * WEEK_MS).toISOString();
/** Weeks ago -> commits (the real repo's last-12 shape: 4 busy weeks, W-4 quiet, W-10 one commit; then older). */
const SHAPE: Record<number, number> = { 0: 109, 1: 279, 2: 317, 3: 230, 4: 23, 10: 1, 16: 23, 24: 38, 30: 7 };
const KEY = `acme-${process.pid}/busy`;

function busyGithub(o: { calls?: string[] } = {}): Pick<ReaderDeps, 'ghGraphql' | 'gh'> {
  return {
    ghGraphql: async <T,>(query: string, v: Record<string, unknown>): Promise<T> => {
      o.calls?.push(query.includes('w0: history') ? 'weekly' : 'repos');
      if (query.includes('w0: history')) {
        assert.deepEqual([v.o, v.n], KEY.split('/'), 'the weekly read names the repo by variables');
        const target: Record<string, { totalCount: number }> = {};
        commitWindows(NOW).forEach((w, i) => (target[`w${i}`] = { totalCount: SHAPE[i] ?? 0 }));
        return { data: { repository: { defaultBranchRef: { target } } } } as T;
      }
      // The newest 100 commits: all this week (109 commits this week alone).
      const nodes = Array.from({ length: 100 }, (_, i) => ({ committedDate: at(60_000 * (i + 1)) }));
      const total = Object.values(SHAPE).reduce((a, b) => a + b, 0);
      return {
        data: {
          r0: {
            nameWithOwner: KEY, isFork: false, isTemplate: false, isPrivate: false, createdAt: CREATED, pushedAt: at(60_000),
            owner: { __typename: 'Organization', login: KEY.split('/')[0] }, parent: null, templateRepository: null,
            defaultBranchRef: { target: { history: { totalCount: total, nodes } } },
          },
        },
      } as T;
    },
    gh: async <T,>(path: string): Promise<T> => {
      if (path.includes('direction=asc'))
        // The oldest 100 events, from the repo's creation (a full page ending 50 weeks ago).
        return Array.from({ length: 100 }, (_, i) => ({ timestamp: new Date(Date.parse(CREATED) + i * 3_600_000).toISOString(), activity_type: 'push' })) as T;
      // The newest 100 events: 3 days of pushes, branch creations and PR merges.
      const types = ['push', 'branch_creation', 'pr_merge', 'push', 'branch_deletion'];
      return Array.from({ length: 100 }, (_, i) => ({ timestamp: at(i * 2_500_000), activity_type: types[i % types.length] })) as T;
    },
  };
}

test('hotfix: a busy repo (100 commits are a few days) is read for all 52 weeks, one extra call', async () => {
  const calls: string[] = [];
  const d = { ...busyGithub({ calls }), now: NOW } as ReaderDeps;
  const r = (await readGithubRepos([KEY], d)).repos.get(KEY.toLowerCase())!;
  assert.deepEqual(calls, ['repos', 'weekly']);
  assert.equal(r.commit_counts![weekAgo(1)], 279);
  assert.deepEqual(r.commit_weeks, Object.keys(SHAPE).map((i) => weekAgo(Number(i))).sort());
  assert.equal('truncated' in r, false, 'the internal flag is never stored');
  // A quiet repo (every commit of the 52 weeks read) needs no weekly call.
  const quiet: string[] = [];
  const q = {
    now: NOW,
    ghGraphql: async <T,>(query: string): Promise<T> => {
      quiet.push(query);
      return { data: { r0: { nameWithOwner: KEY, createdAt: CREATED, defaultBranchRef: { target: { history: { totalCount: 1, nodes: [{ committedDate: at(60_000) }] } } } } } } as T;
    },
  } as unknown as ReaderDeps;
  assert.deepEqual((await readGithubRepos([KEY], q)).repos.get(KEY.toLowerCase())!.commit_weeks, [weekAgo(0)]);
  assert.equal(quiet.length, 1);
  // A malformed weekly answer is a failed read, never a short one.
  assert.equal(weeklyCommitsFrom({ data: { repository: null } }, NOW), null);
  assert.match(weeklyCommitsQuery(NOW), /query\(\$o: String!, \$n: String!\)/);
});

test('hotfix: the busy repo scores its real 12 weeks; the push record, the creation floor and rule 3 still hold', async () => {
  const d = { ...busyGithub(), now: NOW } as ReaderDeps;
  const r = (await readGithubRepos([KEY], d)).repos.get(KEY.toLowerCase())!;
  const { readPushes } = await import('./sources');
  const pushes = await readPushes(KEY.toLowerCase(), (p) => d.gh(p));
  // The short baseline prod stored (one week, verified, no reader version) is re-taken once under rule 4.
  const prodPrev = { commit_weeks: [weekAgo(0)], commit_counts: { [weekAgo(0)]: 100 }, pushes_checked: true, created_at: CREATED };
  assert.equal(needsPushCheck(prodPrev), true, 'an older reader is no baseline');
  const stored = storedCommits(r, prodPrev, NOW, pushes);
  assert.deepEqual([stored.pushes_checked, stored.reader], [true, REPO_READER]);
  const sig = { ...r, ...stored };
  const s = computeScoreV2({ ships: [], commitWeeks: countedCommitWeeks(sig, NOW) }, NOW);
  // Weeks 0-4 and 10: 12+11+10+9+8+2 = 52 of 78 -> round(90 x 52 / 78) = 60.
  assert.equal(s.score, 60);
  assert.match(scoreWhy(s.parts, NOW)!, /^Code in 6 of the last 12 weeks, 4 of the last 4/);
  // Rule 3: after this verified reading, a backdated week (week 7, never pushed) never appears.
  const later = storedCommits({ commit_weeks: [...r.commit_weeks, weekAgo(7)], commit_counts: { ...r.commit_counts, [weekAgo(7)]: 40 } }, sig, NOW, null);
  assert.equal(later.commit_weeks.includes(weekAgo(7)), false);
  assert.equal(later.commit_counts[weekAgo(7)], undefined);
  // Rule 4: no record of pushes in the gap -> the weeks are not backed (a flood of pushes today backs only this week and last).
  const today = { pushes: [at(60_000)], covered: true };
  assert.deepEqual(storedCommits(r, null, NOW, today).commit_weeks, [weekAgo(1), weekAgo(0)].sort());
  // Rule 2: a week before the repo's creation never counts.
  const young = { ...sig, created_at: new Date(NOW.getTime() - 2 * WEEK_MS).toISOString() };
  assert.equal(countedCommitWeeks(young, NOW).includes(weekAgo(3)), false);
});

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const ID = 2_100_019_000 + (process.pid % 1000);
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
beforeEach(async () => {
  if (process.env.DATABASE_URL) await sql()`DELETE FROM builder_sources WHERE builder_id = ${ID}`;
});

test('hotfix: the daily read corrects a short verified reading of an older reader once, then rule 3 holds', dbTest, async () => {
  const [row] = await sql()<{ id: string }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by)
    VALUES (${ID}, 'repo', ${KEY}, ${KEY}, 'proof_branch', 'verified', 'server') RETURNING id`;
  const id = Number(row.id);
  const yesterday = new Date(NOW.getTime() - 86_400_000).toISOString().slice(0, 10);
  // What prod holds: yesterday's verified reading of the newest 100 commits only (no reader version).
  await writeReading(id, ID, yesterday, { ok: true, signals: { key: KEY.toLowerCase(), owner: KEY.split('/')[0], created_at: CREATED, commit_weeks: [weekAgo(0)], commit_counts: { [weekAgo(0)]: 100 }, pushes_checked: true } });
  await sql()`UPDATE builder_sources SET last_read_day = ${yesterday} WHERE id = ${id}`;
  const no = async (): Promise<never> => {
    throw new Error('unexpected read');
  };
  const reader = { probe: no, fetchText: no, json: no, contractOrigin: no, walletCreations: no, ...busyGithub(), now: NOW } as ReaderDeps;
  assert.deepEqual(await readSources(NOW, { deadline: Date.now() + 10_000, reader, only: [ID] }), { read: 1, failed: 0 });
  const [r] = await sql()<{ signals: Record<string, unknown> }[]>`SELECT signals FROM source_readings WHERE source_id = ${id} AND day = ${NOW.toISOString().slice(0, 10)}`;
  assert.equal(r.signals.reader, REPO_READER);
  assert.equal(computeScoreV2({ ships: [], commitWeeks: countedCommitWeeks(r.signals, NOW) }, NOW).score, 60);
});

// ---- Launch-ready: hotfix carry-overs (a) one repo's weekly call fails only that repo, (b) the weekly call runs
// only when needed, (c) no weekly call starts past the read's deadline. ----

const KEY2 = `acme-${process.pid}/quiet`;
/** A repo node: `nodes` commits `stepMs` apart from a minute ago, `total` in the 52 weeks. */
const node = (key: string, nodes: number, stepMs: number, total: number) => ({
  nameWithOwner: key, isFork: false, isTemplate: false, isPrivate: false, createdAt: CREATED, pushedAt: at(60_000),
  owner: { __typename: 'User', login: key.split('/')[0] }, parent: null, templateRepository: null,
  defaultBranchRef: { target: { history: { totalCount: total, nodes: Array.from({ length: nodes }, (_, i) => ({ committedDate: at(60_000 + i * stepMs) })) } } },
});
/** GitHub with a busy repo (KEY, newest 100 commits in under 2 days) and a quiet one (KEY2), whose weekly call fails. */
function twoRepos(calls: string[], o: { weekly?: 'fail' | 'ok' } = {}): Pick<ReaderDeps, 'ghGraphql' | 'gh'> {
  return {
    ghGraphql: async <T,>(query: string): Promise<T> => {
      if (query.includes('w0: history')) {
        calls.push('weekly');
        if (o.weekly !== 'ok') throw new Error('GitHub GraphQL returned 502');
        return busyGithub().ghGraphql<T>(query, { o: KEY.split('/')[0], n: KEY.split('/')[1] });
      }
      calls.push('repos');
      return { data: { r0: node(KEY, 100, 1_500_000, 900), r1: node(KEY2, 3, 86_400_000, 3) } } as T;
    },
    gh: async <T,>(): Promise<T> => [] as T,
  };
}

test('launch-ready (a): a busy repo whose weekly call fails fails only that repo, never the batch', async () => {
  const calls: string[] = [];
  const got = await readGithubRepos([KEY, KEY2], { ...twoRepos(calls), now: NOW } as ReaderDeps);
  assert.deepEqual(calls, ['repos', 'weekly']);
  assert.deepEqual([...got.repos.keys()], [KEY2.toLowerCase()]);
  assert.match(String(got.failed.get(KEY.toLowerCase())), /GitHub GraphQL returned 502/);
  // The run's deadline or a spent budget still stops the whole read (the sources stay due).
  const stop = { ...twoRepos([]), now: NOW, ghGraphql: async <T,>(q: string): Promise<T> => {
    if (q.includes('w0: history')) throw new ScoreDeadline();
    return twoRepos([]).ghGraphql<T>(q, {});
  } } as unknown as ReaderDeps;
  await assert.rejects(readGithubRepos([KEY, KEY2], stop), ScoreDeadline);
});

test('launch-ready (b): the 52-week call runs only without a verified baseline, or when the commits read miss last week', async () => {
  const lastMonday = Date.parse(commitWindows(NOW)[1].since);
  assert.equal(needsAllWeeks({ truncated: false, oldest: null }, NOW, false), false, 'every commit read');
  assert.equal(needsAllWeeks({ truncated: true, oldest: lastMonday - 1 }, NOW, false), true, 'no baseline: the whole 52 weeks');
  assert.equal(needsAllWeeks({ truncated: true, oldest: lastMonday - 1 }, NOW, true), false, 'baseline, this and last week read in full');
  assert.equal(needsAllWeeks({ truncated: true, oldest: lastMonday }, NOW, true), true, 'baseline, but last week may be cut');
  assert.equal(needsAllWeeks({ truncated: true, oldest: null }, NOW, true), true);
  // Through the reader: 100 commits 4 hours apart (16 days) with a baseline: one call, the weeks as read.
  const calls: string[] = [];
  const wide = {
    now: NOW,
    ghGraphql: async <T,>(q: string): Promise<T> => {
      calls.push(q.includes('w0: history') ? 'weekly' : 'repos');
      return { data: { r0: node(KEY, 100, 4 * 3_600_000, 900) } } as T;
    },
  } as unknown as ReaderDeps;
  const r = (await readGithubRepos([KEY], wide, { baseline: async () => true })).repos.get(KEY.toLowerCase())!;
  assert.deepEqual(calls, ['repos']);
  assert.ok(r.commit_counts![weekAgo(1)]! > 0 && r.commit_counts![weekAgo(0)]! > 0);
  // The busy repo (100 commits in under 2 days) still needs it, baseline or not.
  const busy: string[] = [];
  await readGithubRepos([KEY], { ...twoRepos(busy, { weekly: 'ok' }), now: NOW } as ReaderDeps, { baseline: async () => true });
  assert.deepEqual(busy, ['repos', 'weekly']);
});

test('launch-ready (c): no weekly call starts past the read\'s deadline (ScoreDeadline: the source stays due)', async () => {
  const calls: string[] = [];
  const d = { ...twoRepos(calls, { weekly: 'ok' }), now: NOW, deadline: Date.now() - 1 } as ReaderDeps;
  await assert.rejects(readGithubRepos([KEY, KEY2], d), ScoreDeadline);
  assert.deepEqual(calls, ['repos'], 'the weekly call never went out');
});

test('launch-ready (a): the daily read writes the quiet repo\'s reading and one failed reading for the busy repo', dbTest, async () => {
  const ids: number[] = [];
  for (const key of [KEY, KEY2]) {
    const [row] = await sql()<{ id: string }[]>`
      INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by)
      VALUES (${ID}, 'repo', ${key}, ${key}, 'proof_branch', 'verified', 'server') RETURNING id`;
    ids.push(Number(row.id));
  }
  const no = async (): Promise<never> => {
    throw new Error('unexpected read');
  };
  const reader = { probe: no, fetchText: no, json: no, contractOrigin: no, walletCreations: no, ...twoRepos([]), now: NOW } as ReaderDeps;
  assert.deepEqual(await readSources(NOW, { deadline: Date.now() + 10_000, reader, only: [ID] }), { read: 1, failed: 1 });
  const got = await sql()<{ source_id: string; ok: boolean; error: string | null }[]>`
    SELECT source_id, ok, error FROM source_readings WHERE source_id IN ${sql()(ids)} AND day = ${NOW.toISOString().slice(0, 10)} ORDER BY source_id`;
  assert.deepEqual(got.map((r) => r.ok), [false, true]);
  assert.match(got[0].error!, /GitHub GraphQL returned 502/);
});

// ---- Launch-ready fix round 1: one refused alias fails only its repo; the baseline is asked with the repo as read ----

const FORBIDDEN = (i: number) => ({ type: 'FORBIDDEN', path: [`r${i}`], message: 'Resource not accessible by personal access token' });

test('fix round 1: aliasErrors keeps an answer usable when every other error is on one rN alias; an error without a path still refuses it', async () => {
  const { graphqlUsable } = await import('./source-readers');
  const body = { data: { r0: null, r1: {} }, errors: [FORBIDDEN(0)] };
  assert.equal(graphqlUsable(body), false, 'off by default');
  assert.equal(graphqlUsable(body, { aliasErrors: true }), true);
  assert.equal(graphqlUsable({ data: {}, errors: [FORBIDDEN(0), { type: 'FORBIDDEN', message: 'x' }] }, { aliasErrors: true }), false, 'no path');
  assert.equal(graphqlUsable({ data: {}, errors: [{ type: 'FORBIDDEN', path: ['user'] }] }, { aliasErrors: true }), false, 'not an alias');
  assert.equal(graphqlUsable({ data: null, errors: [FORBIDDEN(0)] }, { aliasErrors: true }), false, 'no data');
});

test('fix round 1: readGithubRepos leaves a refused repo unread with GitHub\'s message; the rest read', async () => {
  let opts: unknown;
  const d = {
    now: NOW,
    ghGraphql: async <T,>(_q: string, _v: unknown, o?: unknown): Promise<T> => {
      opts = o;
      return { data: { r0: node(KEY, 3, 86_400_000, 3), r1: null }, errors: [FORBIDDEN(1)] } as T;
    },
  } as unknown as ReaderDeps;
  const got = await readGithubRepos([KEY, KEY2], d);
  assert.deepEqual(opts, { aliasErrors: true });
  assert.deepEqual([...got.repos.keys()], [KEY.toLowerCase()]);
  assert.equal(got.refused.get(KEY2.toLowerCase()), 'GitHub GraphQL answered errors: FORBIDDEN at r1 (Resource not accessible by personal access token)');
  assert.equal(got.failed.size, 0);
});

test('fix round 1: the baseline is asked only for a short read, with the repo as read', async () => {
  const asked: [string, string | undefined][] = [];
  const baseline = async (k: string, r: { created_at?: string | null }) => (asked.push([k, r.created_at ?? undefined]), true);
  const quiet = { now: NOW, ghGraphql: async <T,>(): Promise<T> => ({ data: { r0: node(KEY, 3, 86_400_000, 3) } }) as T } as unknown as ReaderDeps;
  await readGithubRepos([KEY], quiet, { baseline });
  assert.deepEqual(asked, [], 'a full read asks nothing');
  const wide = { now: NOW, ghGraphql: async <T,>(): Promise<T> => ({ data: { r0: node(KEY, 100, 4 * 3_600_000, 900) } }) as T } as unknown as ReaderDeps;
  await readGithubRepos([KEY], wide, { baseline });
  assert.deepEqual(asked, [[KEY.toLowerCase(), CREATED]]);
});

test('fix round 1: a batch of 25 with one refused repo writes 24 good readings and one failed reading with GitHub\'s message', dbTest, async () => {
  const keys = Array.from({ length: 25 }, (_, i) => `acme-${process.pid}/r${i}`);
  const ids: number[] = [];
  for (const key of keys) {
    const [row] = await sql()<{ id: string }[]>`
      INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by)
      VALUES (${ID}, 'repo', ${key}, ${key}, 'proof_branch', 'verified', 'server') RETURNING id`;
    ids.push(Number(row.id));
  }
  const no = async (): Promise<never> => {
    throw new Error('unexpected read');
  };
  let calls = 0;
  const reader = {
    probe: no, fetchText: no, json: no, contractOrigin: no, walletCreations: no, now: NOW,
    gh: async <T,>(): Promise<T> => [] as T,
    ghGraphql: async <T,>(_q: string, v: Record<string, unknown>): Promise<T> => {
      calls++;
      const data: Record<string, unknown> = {};
      const asked = Object.keys(v).filter((k) => /^o\d+$/.test(k)).length;
      const bad = Array.from({ length: asked }, (_, i) => i).find((i) => `${v[`o${i}`]}/${v[`n${i}`]}` === keys[7].toLowerCase());
      for (let i = 0; i < asked; i++) data[`r${i}`] = i === bad ? null : node(`${v[`o${i}`]}/${v[`n${i}`]}`, 2, 86_400_000, 2);
      return { data, errors: bad === undefined ? undefined : [FORBIDDEN(bad)] } as T;
    },
  } as ReaderDeps;
  assert.deepEqual(await readSources(NOW, { deadline: Date.now() + 20_000, reader, only: [ID] }), { read: 24, failed: 1 });
  assert.equal(calls, 1, 'one call for the 25');
  const got = await sql()<{ source_id: string; ok: boolean; error: string | null }[]>`
    SELECT source_id, ok, error FROM source_readings WHERE source_id IN ${sql()(ids)} AND day = ${NOW.toISOString().slice(0, 10)}`;
  assert.equal(got.filter((r) => r.ok).length, 24);
  const failed = got.filter((r) => !r.ok);
  assert.deepEqual(failed.map((r) => Number(r.source_id)), [ids[7]]);
  assert.match(failed[0].error!, /FORBIDDEN at r\d+ \(Resource not accessible by personal access token\)/);
});
