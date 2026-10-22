import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { X_ON, find, install, withEnv } from './fixtures/find';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv } from './fixtures/app-install';
import { ORG_PROOF_MAX_AGE_MS, expireOrgProofs, orgProofExpiryStep, proveByApp } from './repo-proof';
import { rescorePerson } from './person-score';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BenchPage, { BENCH_EMPTY } from '../../app/leaderboard/BenchView';
import { BENCH_TOP_EMPTY, leaderboardLine } from './site-copy';
import { discoverPerson } from './discovery';
import type { ReaderDeps } from './source-readers';

/**
 * v2.13.2 follow-ups. 1: an Organization's repo confirmed by a proof branch (before v2.14) expires 90 days
 * after it was verified (the pusher may have lost push access); a User's repo (owner = pusher) never does.
 * v2.14 spec 2: the re-proof is the read-only App (repo-proof.ts proveByApp).
 * 3: the empty Bench header and its singular. (2, the Safe's revenue stat: v2132-safe-fees.test.ts.)
 */

process.env.EARNKIT_AUTH_SECRET ||= 'v2132-branch-secret';
appEnv();
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const RUN = randomBytes(3).toString('hex');
const ON = { EARNKIT_URL: undefined, ...X_ON };
const NO_MATCH = { matchProjects: async () => ({ checked: 1, scored: 0, fits: [] }) };
const DAY = 86_400_000;
let seq = 0;
const uniq = (p: string) => `${p}${RUN}${++seq}`;

const named = (repo: string) => ({ identity: { github_login: repo.split('/')[0], project: { name: 'Recipe planner', what: 'a recipe planner', repo } } });
const source = async (id: number, key: string) => {
  const [s] = await sql()<{ state: string; proof: string | null; reject_reason: string | null }[]>`
    SELECT state, proof, reject_reason FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo' AND lower(ref) = ${key.toLowerCase()} ORDER BY id LIMIT 1`;
  return s ? { ...s } : null;
};
const ranked = async (id: number) => Boolean((await sql()`SELECT 1 FROM builder_live WHERE builder_id = ${id} AND ranked`)[0]);
/** The person's proof_branch confirmation, verified `days` ago. */
const verifiedAgo = (id: number, days: number) =>
  sql()`UPDATE builder_sources SET verified_at = now() - ${`${days} days`}::interval WHERE builder_id = ${id} AND kind = 'repo' AND proof = 'proof_branch'`;
/** A person whose repo `key` was confirmed by a proof branch before v2.14 (an Organization's when `org`). */
async function confirmed(key: string, org = false) {
  const id = await install();
  await find(id, named(key), NO_MATCH);
  await sql()`
    UPDATE builder_sources SET state = 'verified', proof = 'proof_branch', verified_at = now(), gh_owner = ${key.split('/')[0]},
      gh_owner_type = ${org ? 'Organization' : 'User'}
    WHERE builder_id = ${id} AND kind = 'repo' AND lower(ref) = ${key.toLowerCase()}`;
  // R4: ranked once the repo has a reading.
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at)
    SELECT id, ${sql().json({ owner: key.split('/')[0], owner_type: org ? 'Organization' : 'User', commit_weeks: [] } as never)}, true, now()
    FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo' AND lower(ref) = ${key.toLowerCase()}
    ON CONFLICT (source_id) DO UPDATE SET signals = EXCLUDED.signals, ok = true, read_at = EXCLUDED.read_at`;
  await rescorePerson(id, new Date());
  assert.equal(await ranked(id), true);
  return id;
}
/** v2.14: the builder installs the read-only App on the repo (an installer who administers it). */
async function reprove(id: number, key: string, installation: number) {
  const gh = fakeGitHub({ [key]: { id: installation, owner: key.split('/')[0], ownerType: 'Organization', installation } });
  return proveByApp({ builderId: id, repoKey: key, githubInstallationId: installation }, { fetch: gh });
}

// ---- 1. Org-repo proof expiry

test('v2.13.2 1: the expiry is 90 days', () => {
  assert.equal(ORG_PROOF_MAX_AGE_MS, 90 * DAY);
});

test('v2.13.2 1: an org proof at 89 days stays; at 91 days it is proposed (stale), leaves the Bench, and the App re-proves it (v2.14)', dbTest, () =>
  withEnv(ON, async () => {
    const org = `${uniq('acme')}/app`;
    const id = await confirmed(org, true);
    await verifiedAgo(id, 89);
    assert.deepEqual(await expireOrgProofs(new Date(), { only: [id] }), { expired: 0, done: true });
    assert.deepEqual(await source(id, org), { state: 'verified', proof: 'proof_branch', reject_reason: null });
    assert.equal(await ranked(id), true);

    await verifiedAgo(id, 91);
    assert.deepEqual(await expireOrgProofs(new Date(), { only: [id] }), { expired: 1, done: true });
    assert.deepEqual(await source(id, org), { state: 'proposed', proof: 'proof_branch', reject_reason: 'stale' });
    assert.equal(await ranked(id), false, 'rescored at once: off the Bench');
    // Run again: nothing more to do.
    assert.deepEqual(await expireOrgProofs(new Date(), { only: [id] }), { expired: 0, done: true });

    // v2.14 spec 2: the re-proof is the App: verified again (github_app), the note cleared, back on the Bench.
    assert.deepEqual(await reprove(id, org, 91_001), { ok: true, via: 'app', owner: org.split('/')[0], private: false });
    assert.deepEqual(await source(id, org), { state: 'verified', proof: 'github_app', reject_reason: null });
    assert.equal(await ranked(id), true);
  }),
);

test('v2.13.2 1: a user-owned proof at 200 days stays', dbTest, () =>
  withEnv(ON, async () => {
    const key = `${uniq('maya')}/recipes`;
    const id = await confirmed(key);
    await verifiedAgo(id, 200);
    assert.deepEqual(await expireOrgProofs(new Date(), { only: [id] }), { expired: 0, done: true });
    assert.deepEqual(await source(id, key), { state: 'verified', proof: 'proof_branch', reject_reason: null });
    assert.equal(await ranked(id), true);
  }),
);

// ---- 3. The Bench header's counts

test('v2.13.2 3, v3.1 wording: the leaderboard header says nobody (BENCH_TOP_EMPTY at 0), one builder, or many', () => {
  assert.equal(BENCH_TOP_EMPTY, 'Nobody on the leaderboard yet. Add EarnKit to your agent and be first.');
  assert.ok(page(0).includes(BENCH_TOP_EMPTY) && !page(0).includes('0 builders'));
  assert.equal(leaderboardLine(1), '1 builder, ranked by how often they ship');
  assert.equal(leaderboardLine(2), '2 builders, ranked by how often they ship');
  assert.equal(leaderboardLine(1200), '1,200 builders, ranked by how often they ship');
});

// ---- Fix round 1

test('v2.13.2 fix 1 (concern 3), v2.14: a stale org repo comes back only through the App, never through discovery', dbTest, () =>
  withEnv(ON, async () => {
    const org = `${uniq('acme')}/app`;
    const owner = org.split('/')[0];
    const member = uniq('member');
    const id = await confirmed(org, true);
    await verifiedAgo(id, 91);
    assert.deepEqual(await expireOrgProofs(new Date(), { only: [id] }), { expired: 1, done: true });
    // GitHub says the person is the org repo's top contributor (discovery's repo_owner rule for org repos).
    const reader = new Proxy({}, {
      get: (_t, k) => {
        if (k === 'now') return new Date();
        if (k === 'ghSpent') return () => false;
        if (k === 'gh') return async (path: string) =>
          path === `/repos/${org}` ? { id: 91_002, full_name: org, fork: false, is_template: false, owner: { login: owner, type: 'Organization' } }
          : path.startsWith(`/repos/${org}/contributors`) ? [{ login: member }]
          : path === `/users/${member}` ? { login: member, blog: null, twitter_username: null } : [];
        return async () => [];
      },
    }) as ReaderDeps;
    await discoverPerson(id, { deadline: Date.now() + 10_000, reader, login: async () => ({ login: member, basis: 'app' }) });
    assert.deepEqual(await source(id, org), { state: 'proposed', proof: 'proof_branch', reject_reason: 'stale' }, 'discovery never re-verifies a stale source');
    assert.equal(await ranked(id), false);
    // The App brings it back.
    assert.equal((await reprove(id, org, 91_003)).ok, true);
    assert.deepEqual(await source(id, org), { state: 'verified', proof: 'github_app', reject_reason: null });
  }),
);

(globalThis as { React?: typeof React }).React = React;
const page = (count: number, rows = 0, chain: 'base' | 'arc' | null = null) =>
  renderToStaticMarkup(React.createElement(BenchPage, {
    rows: Array.from({ length: rows }, (_, i) => ({ rank: i + 1, line: null, points: 10, handle: `h${i}`, name: `H${i}`, avatar: null, backing: null, chains: [], project: 'P', best: 'Building', streak: 0 })),
    count, chips: [], filter: { chain, weekly: false }, page: 1,
  })).replace(/&#x27;/g, "'");

test('v2.13.2 fix 1 (concern 4): nobody ranked: the empty line once; a filtered view with no rows keeps "No one here yet."', () => {
  const empty = page(0);
  assert.equal(empty.split(BENCH_TOP_EMPTY).length - 1, 1, 'the empty line once');
  assert.ok(!empty.includes(BENCH_EMPTY), 'no second empty line');
  // Solo launch: an empty Base filter says BENCH_EMPTY_BASE (v31-site-leaderboard.test.ts (c3)); another chain keeps BENCH_EMPTY.
  const filtered = page(5, 0, 'arc');
  assert.ok(filtered.includes(BENCH_EMPTY));
  // QA item 2: the count line follows the filter, so a filter with no rows shows no pool count beside BENCH_EMPTY.
  assert.ok(!filtered.includes(leaderboardLine(5)));
  assert.ok(!page(1, 1).includes(BENCH_EMPTY));
});

// ---- Review round (M1)

test('v2.13.2 review 2 (M1): the expiry stops at the deadline (leftovers stay for the next run); a failed rescore puts the row back and is logged', dbTest, () =>
  withEnv(ON, async () => {
    const org = `${uniq('acme')}/app`;
    const id = await confirmed(org, true);
    await verifiedAgo(id, 91);
    // Past the deadline: nothing done, not done.
    assert.deepEqual(await expireOrgProofs(new Date(), { only: [id], deadline: Date.now() - 1 }), { expired: 0, done: false });
    assert.equal((await source(id, org))?.state, 'verified');
    // A rescore that fails: logged, the row is verified again (picked up next run), not done.
    const err = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await expireOrgProofs(new Date(), { only: [id], rescore: async () => { throw new Error('rescore down'); } }), { expired: 0, done: false });
    } finally {
      console.error = err;
    }
    assert.equal((await source(id, org))?.state, 'verified');
    // Then a run that completes.
    assert.deepEqual(await expireOrgProofs(new Date(), { only: [id] }), { expired: 1, done: true });
    assert.equal((await source(id, org))?.reject_reason, 'stale');
  }),
);

test('v2.13.2 review 2 (M1): the day\'s slot is taken only after a run that finished; an error or a cut run retries next run', dbTest, async () => {
  const now = new Date(Date.UTC(2099, 0, Number.parseInt(RUN.slice(0, 2), 16) % 28 + 1, 12));
  const key = `orgProofExpiry:${now.toISOString().slice(0, 10)}`;
  await sql()`DELETE FROM rate_windows WHERE key = ${key}`;
  let calls = 0;
  const step = (r: { expired: number; done: boolean } | Error) =>
    orgProofExpiryStep(now, { deadline: Date.now() + 5_000, expire: async () => {
      calls++;
      if (r instanceof Error) throw r;
      return r;
    } });
  try {
    await assert.rejects(step(new Error('db down')), /db down/);
    assert.deepEqual(await step({ expired: 100, done: false }), { expired: 100, done: false });
    assert.deepEqual(await step({ expired: 3, done: true }), { expired: 3, done: true });
    assert.deepEqual(await step({ expired: 9, done: true }), { step: 'skipped' });
    assert.equal(calls, 3, 'the day is done after the run that finished');
  } finally {
    await sql()`DELETE FROM rate_windows WHERE key = ${key}`;
  }
});

test('v2.13.2 review 3: a person whose rescore keeps failing never blocks the people behind them; they are retried last', dbTest, () =>
  withEnv(ON, async () => {
    const orgOf = () => `${uniq('acme')}/app`;
    const [oa, ob, oc, od] = [orgOf(), orgOf(), orgOf(), orgOf()];
    const a = await confirmed(oa, true);
    const b = await confirmed(ob, true);
    const c = await confirmed(oc, true);
    // A is the oldest, so it comes first.
    await verifiedAgo(a, 95);
    await verifiedAgo(b, 92);
    await verifiedAgo(c, 91);
    const calls: number[] = [];
    const failA = async (id: number) => {
      calls.push(id);
      if (id === a) throw new Error('rescore down');
    };
    const logged: unknown[] = [];
    const err = console.error;
    console.error = (...x: unknown[]) => void logged.push(x);
    try {
      assert.deepEqual(await expireOrgProofs(new Date(), { only: [a, b, c], rescore: failA }), { expired: 2, done: false });
      assert.deepEqual(calls, [a, b, c]);
      assert.equal((await source(a, oa))?.state, 'verified', 'A rolled back');
      assert.equal((await source(b, ob))?.reject_reason, 'stale');
      assert.equal((await source(c, oc))?.reject_reason, 'stale');
      assert.ok(logged.some((x) => JSON.stringify(x).includes('Error')) && !logged.some((x) => JSON.stringify(x).includes('rescore down')), 'logged by class name');
      // Next run: D (newer than A) is handled before A, who just failed.
      const d = await confirmed(od, true);
      await verifiedAgo(d, 91);
      calls.length = 0;
      assert.deepEqual(await expireOrgProofs(new Date(), { only: [a, d], rescore: failA }), { expired: 1, done: false });
      assert.deepEqual(calls, [d, a]);
    } finally {
      console.error = err;
    }
    // A's rescore works again: A expires, the run is done.
    assert.deepEqual(await expireOrgProofs(new Date(), { only: [a] }), { expired: 1, done: true });
    assert.deepEqual(await source(a, oa), { state: 'proposed', proof: 'proof_branch', reject_reason: 'stale' });
    assert.equal(await ranked(a), false);
  }),
);
