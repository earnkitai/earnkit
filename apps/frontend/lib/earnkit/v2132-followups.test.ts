import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { X_ON, find, install, withEnv } from './fixtures/find';
import { fakeGitHub, idOf } from './fixtures/fake-github-branch';
import { ORG_PROOF_MAX_AGE_MS, checkProofBranch, expireOrgProofs, orgProofExpiryStep } from './proof-branch';
import { benchReply, stillYoursLine, type BenchView } from './bench-reply';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BenchPage, { BENCH_EMPTY, benchLine } from '../../app/bench/BenchView';
import { BENCH_TOP_EMPTY } from '../../app/components/sections/BenchTop';
import { discoverPerson } from './discovery';
import type { ReaderDeps } from './source-readers';

/**
 * v2.13.2 follow-ups. 1: an Organization's repo confirmed by a proof branch expires 90 days after it
 * was verified (the pusher may have lost push access); a User's repo (owner = pusher) never does.
 * 3: the empty Bench header and its singular. (2, the Safe's revenue stat: v2132-safe-fees.test.ts.)
 */

process.env.EARNKIT_BUILDER_SCORE = 'on';
process.env.EARNKIT_BENCH = 'on';
process.env.EARNKIT_AUTH_SECRET ||= 'v2132-branch-secret';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const RUN = randomBytes(3).toString('hex');
const ON = { EARNKIT_BUILDER_SCORE: 'on', EARNKIT_BENCH: 'on', EARNKIT_URL: undefined, ...X_ON };
const NO_MATCH = { matchProjects: async () => ({ checked: 1, scored: 0, fits: [] }) };
const DAY = 86_400_000;
let seq = 0;
const uniq = (p: string) => `${p}${RUN}${++seq}`;

const named = (repo: string) => ({ identity: { github_login: repo.split('/')[0], project: { name: 'Recipe planner', what: 'a recipe planner', repo } } });
const branchOf = (r: { proof?: unknown }) => ((r.proof ?? {}) as { branch?: string }).branch ?? '';
const source = async (id: number, key: string) => {
  const [s] = await sql()<{ state: string; proof: string | null; reject_reason: string | null }[]>`
    SELECT state, proof, reject_reason FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo' AND lower(ref) = ${key.toLowerCase()} ORDER BY id LIMIT 1`;
  return s ? { ...s } : null;
};
const ranked = async (id: number) => Boolean((await sql()`SELECT 1 FROM builder_live WHERE builder_id = ${id} AND ranked`)[0]);
/** The person's proof_branch confirmation, verified `days` ago. */
const verifiedAgo = (id: number, days: number) =>
  sql()`UPDATE builder_sources SET verified_at = now() - ${`${days} days`}::interval WHERE builder_id = ${id} AND kind = 'repo' AND proof = 'proof_branch'`;
const recheckable = (id: number) =>
  sql()`UPDATE proof_branches SET checked_at = checked_at - interval '2 minutes' WHERE builder_id = ${id} AND checked_at IS NOT NULL`;

/** A person whose repo `key` is confirmed by a proof branch pushed by `pusher` (default the owner). */
async function confirmed(gh: ReturnType<typeof fakeGitHub>, key: string, pusher?: string) {
  const id = await install();
  const r = await find(id, named(key), { ...NO_MATCH, proofBranchFetch: gh.f });
  gh.push(key, branchOf(r), pusher);
  assert.equal(await checkProofBranch(id, new Date(), { ghFetch: gh.f }), true);
  assert.equal(await ranked(id), true);
  return id;
}

// ---- 1. Org-repo proof expiry

test('v2.13.2 1: the expiry is 90 days', () => {
  assert.equal(ORG_PROOF_MAX_AGE_MS, 90 * DAY);
  assert.equal(stillYoursLine('Recipe planner'), "Time to show Recipe planner is still yours: I'll check with a quick temporary branch on GitHub.");
  const v: BenchView = {
    project: { key: 'acme/app', name: 'Recipe planner', confirmed: false, live: false, weeks: 0 },
    rank: null, claimed: false, handle: null, claimLink: null, fund: [], ask: null, branch: 'recheck',
  };
  assert.equal(benchReply(v), ['Where you stand', stillYoursLine('Recipe planner')].join('\n'));
});

test('v2.13.2 1: an org proof at 89 days stays; at 91 days it is proposed (stale), leaves the Bench, and find asks for a fresh branch', dbTest, () =>
  withEnv(ON, async () => {
    const gh = fakeGitHub();
    const org = `${uniq('acme')}/app`;
    gh.repos[org] = { owner: { login: org.split('/')[0], type: 'Organization' } };
    const id = await confirmed(gh, org, uniq('member'));
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

    // find issues a fresh proof branch, with the still-yours line.
    await recheckable(id);
    const r = await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.equal(r.show_to_builder.split('\n')[1], stillYoursLine('Recipe planner'), r.show_to_builder);
    const fresh = branchOf(r);
    assert.match(fresh, /^earnkit-[a-z2-7]{12}$/);
    const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM proof_branches WHERE builder_id = ${id} AND used_at IS NULL`;
    assert.equal(n, 1, 'one new, open code');

    // Re-proven: verified again, the note cleared, back on the Bench.
    gh.push(org, fresh, uniq('member'));
    assert.equal(await checkProofBranch(id, new Date(), { ghFetch: gh.f }), true);
    assert.deepEqual(await source(id, org), { state: 'verified', proof: 'proof_branch', reject_reason: null });
    assert.equal(await ranked(id), true);
  }),
);

test('v2.13.2 1: a user-owned proof at 200 days stays', dbTest, () =>
  withEnv(ON, async () => {
    const gh = fakeGitHub();
    const key = `${uniq('maya')}/recipes`;
    const id = await confirmed(gh, key);
    await verifiedAgo(id, 200);
    assert.deepEqual(await expireOrgProofs(new Date(), { only: [id] }), { expired: 0, done: true });
    assert.deepEqual(await source(id, key), { state: 'verified', proof: 'proof_branch', reject_reason: null });
    assert.equal(await ranked(id), true);
  }),
);

// ---- 3. The Bench header's counts

test('v2.13.2 3: the Bench header says nobody, one builder, or many', () => {
  assert.equal(benchLine(0), 'Nobody on the Bench yet. Add EarnKit to your agent and be first.');
  assert.equal(benchLine(1), '1 builder who ships, ranked by what they shipped and who uses it.');
  assert.equal(benchLine(2), '2 builders who ship, ranked by what they shipped and who uses it.');
  assert.equal(benchLine(1200), '1,200 builders who ship, ranked by what they shipped and who uses it.');
});

// ---- Fix round 1

test('v2.13.2 fix 1 (concern 3): a stale org repo comes back only through a fresh proof branch, never through discovery (top contributor)', dbTest, () =>
  withEnv(ON, async () => {
    const gh = fakeGitHub();
    const org = `${uniq('acme')}/app`;
    const owner = org.split('/')[0];
    gh.repos[org] = { owner: { login: owner, type: 'Organization' } };
    const member = uniq('member');
    const id = await confirmed(gh, org, member);
    await verifiedAgo(id, 91);
    assert.deepEqual(await expireOrgProofs(new Date(), { only: [id] }), { expired: 1, done: true });
    // GitHub says the person is the org repo's top contributor (discovery's repo_owner rule for org repos).
    const reader = new Proxy({}, {
      get: (_t, k) => {
        if (k === 'now') return new Date();
        if (k === 'ghSpent') return () => false;
        if (k === 'gh') return async (path: string) =>
          path === `/repos/${org}` ? { id: idOf(org), full_name: org, fork: false, is_template: false, owner: { login: owner, type: 'Organization' } }
          : path.startsWith(`/repos/${org}/contributors`) ? [{ login: member }]
          : path === `/users/${member}` ? { login: member, blog: null, twitter_username: null } : [];
        return async () => [];
      },
    }) as ReaderDeps;
    await discoverPerson(id, { deadline: Date.now() + 10_000, reader, login: async () => ({ login: member, basis: 'proof_branch' as never }) });
    assert.deepEqual(await source(id, org), { state: 'proposed', proof: 'proof_branch', reject_reason: 'stale' }, 'discovery never re-verifies a stale source');
    assert.equal(await ranked(id), false);
    // A fresh proof branch brings it back.
    await recheckable(id);
    const r = await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
    gh.push(org, branchOf(r), member);
    assert.equal(await checkProofBranch(id, new Date(), { ghFetch: gh.f }), true);
    assert.deepEqual(await source(id, org), { state: 'verified', proof: 'proof_branch', reject_reason: null });
  }),
);

(globalThis as { React?: typeof React }).React = React;
const page = (count: number, rows = 0, chain: 'base' | null = null) =>
  renderToStaticMarkup(React.createElement(BenchPage, {
    rows: Array.from({ length: rows }, (_, i) => ({ rank: i + 1, line: null, handle: `h${i}`, name: `H${i}`, avatar: null, raising: null, chains: [], project: 'P', best: 'Building' })),
    count, chips: [], filter: { chain, raising: false, weekly: false }, raising: false,
  })).replace(/&#x27;/g, "'");

test('v2.13.2 fix 1 (concern 4): nobody ranked: the empty line once; a filtered view with no rows keeps "No one here yet."', () => {
  const empty = page(0);
  assert.equal(empty.split(BENCH_TOP_EMPTY).length - 1, 1, 'the empty line once');
  assert.ok(!empty.includes(BENCH_EMPTY), 'no second empty line');
  const filtered = page(5, 0, 'base');
  assert.ok(filtered.includes(BENCH_EMPTY));
  assert.ok(filtered.includes('5 builders who ship'));
  assert.ok(!page(1, 1).includes(BENCH_EMPTY));
});

// ---- Review round (M1)

test('v2.13.2 review 2 (M1): the expiry stops at the deadline (leftovers stay for the next run); a failed rescore puts the row back', dbTest, () =>
  withEnv(ON, async () => {
    const gh = fakeGitHub();
    const org = `${uniq('acme')}/app`;
    gh.repos[org] = { owner: { login: org.split('/')[0], type: 'Organization' } };
    const id = await confirmed(gh, org, uniq('member'));
    await verifiedAgo(id, 91);
    // Past the deadline: nothing done, not done.
    assert.deepEqual(await expireOrgProofs(new Date(), { only: [id], deadline: Date.now() - 1 }), { expired: 0, done: false });
    assert.equal((await source(id, org))?.state, 'verified');
    // A rescore that fails: the error surfaces and the row is verified again (picked up next run).
    await assert.rejects(expireOrgProofs(new Date(), { only: [id], rescore: async () => { throw new Error('rescore down'); } }), /rescore down/);
    assert.deepEqual(await source(id, org), { state: 'verified', proof: 'proof_branch', reject_reason: null });
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
