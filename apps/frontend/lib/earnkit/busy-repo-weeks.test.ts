import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { commitWindows, readGithubRepos, weeklyCommitsFrom, weeklyCommitsQuery } from './person-github';
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
  const r = (await readGithubRepos([KEY], d)).get(KEY.toLowerCase())!;
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
  assert.deepEqual((await readGithubRepos([KEY], q)).get(KEY.toLowerCase())!.commit_weeks, [weekAgo(0)]);
  assert.equal(quiet.length, 1);
  // A malformed weekly answer is a failed read, never a short one.
  assert.equal(weeklyCommitsFrom({ data: { repository: null } }, NOW), null);
  assert.match(weeklyCommitsQuery(NOW), /query\(\$o: String!, \$n: String!\)/);
});

test('hotfix: the busy repo scores its real 12 weeks; the push record, the creation floor and rule 3 still hold', async () => {
  const d = { ...busyGithub(), now: NOW } as ReaderDeps;
  const r = (await readGithubRepos([KEY], d)).get(KEY.toLowerCase())!;
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
