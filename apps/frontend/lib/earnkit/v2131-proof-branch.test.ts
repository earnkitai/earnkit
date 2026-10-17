import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';
import { X_ON, find, install, withEnv } from './fixtures/find';
import { claimLink } from './claim';
import { proofFor } from './main-project';
import {
  PROOF_BRANCH_NOTE, PROOF_BRANCH_RECHECK_MS, PROOF_BRANCH_TTL_MS, checkProofBranch, coinBranchProof, proofBranchFor, proofBranchStep,
  removeCommand,
} from './proof-branch';
import { OTHER_PROJECT_ASK, benchReply, copyLine, needsAgentLine, cantShowLine, checkingBranchLine, confirmingSlowLine, takenLine, type BenchView } from './bench-reply';
import { COIN_YES_NOTE, coinYesNote } from './coin-moments';
import { coinBranchReason, tokenGate, type GateDeps } from './token-gate';
import { discoverPerson } from './discovery';
import type { ReaderDeps } from './source-readers';
import { fakeGitHub, idOf } from './fixtures/fake-github-branch';

/**
 * v2.13.1 O1 (owner ruling, proof branch; fix round 1 rulings a, b, c and authorization): while the
 * one project (a GitHub repo) isn't confirmed, find gives a coding agent a one-hour, single-use branch
 * name to push (no file, no commit) and tells the builder in one line. EarnKit reads the branch on the
 * exact repo, then who pushed it (a User repo: only its owner; an org's: any member), at most once a
 * minute. A pass verifies the repo (`proof_branch`, exclusive: the first holder keeps it), records the
 * pusher's login, rescores at once and tells the agent to delete the branch. Codes are stored hashed.
 * A branch-proven repo needs no earnkit.txt line for a coin. Flag off: today's.
 */

process.env.EARNKIT_BUILDER_SCORE = 'on';
process.env.EARNKIT_BENCH = 'on';
process.env.EARNKIT_AUTH_SECRET ||= 'v2131-branch-secret';
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

const named = (repo: string, extra: Record<string, unknown> = {}) => ({
  identity: { github_login: repo.split('/')[0], project: { name: 'Recipe planner', what: 'a recipe planner', repo } }, ...extra,
});
type Proof = { repo?: string; branch?: string; push?: string; remove?: string; agent_note?: string };
const proofOf = (r: { proof?: unknown }) => (r.proof ?? undefined) as Proof | undefined;
const source = async (id: number, key: string) => {
  const [s] = await sql()<{ state: string; proof: string | null }[]>`
    SELECT state, proof FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo' AND lower(ref) = ${key.toLowerCase()} ORDER BY id LIMIT 1`;
  return s ? { ...s } : null;
};
const rows = (id: number) => sql()<{ code_hash: string; repo_key: string; used_at: Date | null; expires_at: Date; issued_at: Date }[]>`
  SELECT code_hash, repo_key, used_at, expires_at, issued_at FROM proof_branches WHERE builder_id = ${id} ORDER BY issued_at`;
const ranked = async (id: number) => Boolean((await sql()`SELECT 1 FROM builder_live WHERE builder_id = ${id} AND ranked`)[0]);
const started = async (id: number, key: string) => Boolean((await sql()`SELECT 1 FROM project_updates WHERE builder_id = ${id} AND lower(project_key) = ${key} AND facts ? 'started'`)[0]);
/** Moves the person's codes `ms` into the past (issued, expiry and last check). */
const age = (id: number, ms: number) => sql()`
  UPDATE proof_branches SET issued_at = issued_at - ${`${ms} milliseconds`}::interval, expires_at = expires_at - ${`${ms} milliseconds`}::interval,
    checked_at = checked_at - ${`${ms} milliseconds`}::interval WHERE builder_id = ${id}`;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** A fresh install whose agent named `repo`; its first reply and the branch it was given. */
async function start(gh: ReturnType<typeof fakeGitHub>, repo: string) {
  const id = await install();
  const r = await find(id, named(repo), { ...NO_MATCH, proofBranchFetch: gh.f });
  return { id, r, branch: proofOf(r)?.branch ?? '' };
}
/** The next find, past the once-a-minute check. */
async function again(gh: ReturnType<typeof fakeGitHub>, id: number) {
  await sql()`UPDATE proof_branches SET checked_at = checked_at - interval '2 minutes' WHERE builder_id = ${id} AND checked_at IS NOT NULL`;
  return find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
}

// ---- Pure

test('O1.1 the lines: checking (no question), never showed, needs a coding agent, already on the Bench', () => {
  assert.equal(checkingBranchLine('Recipe planner'), "I'll check Recipe planner is yours with a quick temporary branch on GitHub. It's removed right after.");
  // O5 N8, N15: the plain line in the agent's own voice; the coding-agent line names the project.
  assert.equal(cantShowLine('Recipe planner'), "I couldn't show Recipe planner is yours. It needs a project you can push to.");
  assert.equal(needsAgentLine('Recipe planner'), 'Open Recipe planner in your coding agent to put it on the Bench.');
  assert.equal(takenLine('Recipe planner'), 'Recipe planner is already on the Bench under another account.');
  const v: BenchView = {
    project: { key: 'maya/recipes', name: 'Recipe planner', confirmed: false, live: false, weeks: 0 },
    rank: null, claimed: false, handle: null, claimLink: 'https://earnkit.com/claim/abcdefghijkl', fund: [], ask: null, branch: 'checking',
  };
  assert.equal(benchReply(v), ['Where you stand', checkingBranchLine('Recipe planner'), 'Your page: claim it with X at https://earnkit.com/claim/abcdefghijkl'].join('\n'));
  assert.equal(benchReply({ ...v, branch: 'failed' }).split('\n')[1], cantShowLine('Recipe planner'));
  assert.equal(benchReply({ ...v, branch: 'needs_agent' }).split('\n')[1], needsAgentLine('Recipe planner'));
  assert.equal(benchReply({ ...v, branch: 'taken' }).split('\n')[1], takenLine('Recipe planner'));
  for (const b of ['checking', 'failed', 'needs_agent', 'taken'] as const) assert.doesNotMatch(benchReply({ ...v, branch: b }), /\?|earnkit\.txt|sign in/i);
});

// ---- Through find

test('O1.2 the owner pushes: one https link, the branch for the agent, the code stored hashed; then confirmed, ranked, Started, login recorded, code used, delete note once', dbTest, () =>
  withEnv(ON, async () => {
    const key = `${uniq('maya')}/recipes`;
    const gh = fakeGitHub();
    const { id, r, branch } = await start(gh, key);
    const lines = r.show_to_builder.split('\n');
    assert.equal(lines[1], checkingBranchLine('Recipe planner'), r.show_to_builder);
    assert.match(r.claim?.link ?? '', /^https:\/\/earnkit\.com\/claim\/[a-z2-7]{12}$/);
    assert.equal(lines[2], `Your page: claim it with X at ${r.claim!.link}`);
    assert.equal((r.show_to_builder.match(/https?:\/\//g) ?? []).length, 1, 'the claim link is the only link');
    const code = branch.replace(/^earnkit-/, '');
    assert.match(code, /^[a-z2-7]{12}$/);
    assert.deepEqual(proofOf(r), {
      repo: key, branch, push: `git push origin HEAD:refs/heads/${branch}`, remove: `git push origin :refs/heads/${branch}`, agent_note: PROOF_BRANCH_NOTE,
    });
    const [row] = await rows(id);
    assert.equal(row.code_hash, sha256(code), 'only the hash is stored');
    assert.equal((await sql()`SELECT 1 FROM proof_branches p WHERE p::text LIKE ${`%${code}%`}`).length, 0, 'the code itself is nowhere in the table');
    assert.equal(row.expires_at.getTime() - row.issued_at.getTime(), PROOF_BRANCH_TTL_MS);
    assert.equal(await proofFor(id, id, { canPush: true, now: new Date() }), null, 'no line to push under the flag');
    // Asked again before the push: the same branch, nothing confirmed.
    assert.equal(proofOf(await again(gh, id))?.branch, branch);
    assert.equal((await rows(id)).length, 1);
    gh.push(key, branch);
    const r3 = await again(gh, id);
    assert.deepEqual(await source(id, key), { state: 'verified', proof: 'proof_branch' });
    assert.equal(await ranked(id), true, 'rescored at once');
    assert.equal(await started(id, key), true, 'the Started row');
    assert.ok((await rows(id))[0].used_at, 'the code is used');
    const [g] = await sql()<{ gh_repo_id: string; gh_owner: string; gh_owner_type: string }[]>`
      SELECT gh_repo_id::text, gh_owner, gh_owner_type FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo' AND proof = 'proof_branch'`;
    assert.deepEqual({ ...g }, { gh_repo_id: String(idOf(key)), gh_owner: key.split('/')[0], gh_owner_type: 'User' }, 'GitHub\'s repo id and owner are kept with the proof');
    const [p] = await sql()<{ github_login: string; github_basis: string }[]>`SELECT github_login, github_basis FROM builder_profiles WHERE builder_id = ${id}`;
    assert.deepEqual({ ...p }, { github_login: key.split('/')[0], github_basis: 'proof_branch' }, 'the pusher is the proven login');
    assert.deepEqual(r3.proof, { remove: removeCommand(code), agent_note: `Confirmed. Delete the branch now: ${removeCommand(code)}. Don't show this note.` });
    assert.doesNotMatch(r3.show_to_builder, /temporary branch/);
    assert.equal((await again(gh, id)).proof, undefined, 'told once');
  }),
);

test('O1.3 never confirmed: a fork (same key), a 301 rename, another full_name, a ref url on another repo, a template', dbTest, () =>
  withEnv(ON, async () => {
    const cases: [string, (gh: ReturnType<typeof fakeGitHub>, key: string) => void][] = [
      ['fork', (gh, key) => void (gh.repos[key] = { fork: true })],
      ['301 rename', (gh, key) => void (gh.refStatus[key] = 301)],
      ['full_name', (gh, key) => void (gh.repos[key] = { full_name: `someone/${key.split('/')[1]}` })],
      ['ref url', (gh, key) => void (gh.refUrlRepo[key] = `elsewhere/${key.split('/')[1]}`)],
      ['template', (gh, key) => void (gh.repos[key] = { is_template: true })],
    ];
    for (const [why, set] of cases) {
      const key = `${uniq('neg')}/recipes`;
      const gh = fakeGitHub();
      set(gh, key);
      const { id, r, branch } = await start(gh, key);
      // O5 fix round 1 (ruling): a fork or a template is known at issue time: no code, the plain line.
      if (why === 'fork' || why === 'template') {
        assert.equal(r.show_to_builder.split('\n')[1], copyLine('Recipe planner'), why);
        assert.ok(r.show_to_builder.endsWith(OTHER_PROJECT_ASK), why);
        assert.equal(r.proof, undefined, why);
        assert.equal((await rows(id)).length, 0, `${why}: no code`);
        continue;
      }
      gh.push(key, branch);
      assert.equal(await checkProofBranch(id, new Date(), { ghFetch: gh.f }), false, why);
      assert.deepEqual(await source(id, key), { state: 'proposed', proof: null }, why);
      assert.equal(await ranked(id), false, why);
      assert.equal((await rows(id))[0].used_at, null, why);
    }
    // A branch pushed to a fork's own key never counts for the main repo.
    const key = `${uniq('own')}/recipes`;
    const gh = fakeGitHub();
    const { id, branch } = await start(gh, key);
    gh.push(`${uniq('forker')}/recipes`, branch);
    assert.equal(await checkProofBranch(id, new Date(), { ghFetch: gh.f }), false);
  }),
);

test('O1.4 who pushed: a collaborator on a User repo is refused; an org member confirms an org repo; a mixed-case key confirms', dbTest, () =>
  withEnv(ON, async () => {
    const user = `${uniq('solo')}/recipes`;
    const gh = fakeGitHub();
    const a = await start(gh, user);
    gh.push(user, a.branch, uniq('collab'));
    assert.equal(await checkProofBranch(a.id, new Date(), { ghFetch: gh.f }), false, 'a collaborator pushed');
    assert.deepEqual(await source(a.id, user), { state: 'proposed', proof: null });
    const org = `${uniq('acme')}/app`;
    gh.repos[org] = { owner: { login: org.split('/')[0], type: 'Organization' } };
    const b = await start(gh, org);
    const member = uniq('member');
    gh.push(org, b.branch, member);
    assert.equal(await checkProofBranch(b.id, new Date(), { ghFetch: gh.f }), true, 'an org member pushed');
    assert.deepEqual(await source(b.id, org), { state: 'verified', proof: 'proof_branch' });
    assert.equal((await sql()<{ l: string }[]>`SELECT github_login AS l FROM builder_profiles WHERE builder_id = ${b.id}`)[0].l, member);
    // The agent names "Maya/Recipes"; GitHub spells it the same way back.
    const owner = uniq('Maya');
    const mixed = `${owner}/Recipes`;
    gh.repos[mixed.toLowerCase()] = { full_name: mixed, owner: { login: owner, type: 'User' } };
    const c = await start(gh, mixed);
    assert.equal(proofOf(c.r)?.repo, mixed.toLowerCase());
    gh.push(mixed, c.branch, owner);
    assert.equal(await checkProofBranch(c.id, new Date(), { ghFetch: gh.f }), true, 'case never matters');
  }),
);

test('O1.4b who pushed (fix round 2): a push GitHub shows with no actor refuses a User repo; an org stores the branch creator, not a later flood of pushes', dbTest, () =>
  withEnv(ON, async () => {
    const gh = fakeGitHub();
    const user = `${uniq('ghost')}/recipes`;
    const a = await start(gh, user);
    gh.push(user, a.branch);
    gh.pushAgain(user, a.branch, user.split('/')[0]);
    gh.branches.get(`${user}#${a.branch}`)!.unshift({ activity_type: 'push', actor: null });
    assert.equal(await checkProofBranch(a.id, new Date(), { ghFetch: gh.f }), false, 'an unknown actor refuses');
    const org = `${uniq('acmeorg')}/app`;
    gh.repos[org] = { owner: { login: org.split('/')[0], type: 'Organization' } };
    const b = await start(gh, org);
    const creator = uniq('creator');
    gh.push(org, b.branch, creator);
    for (let i = 0; i < 40; i++) gh.pushAgain(org, b.branch, 'flooder');
    assert.equal(await checkProofBranch(b.id, new Date(), { ghFetch: gh.f }), true);
    assert.equal((await sql()<{ l: string }[]>`SELECT github_login AS l FROM builder_profiles WHERE builder_id = ${b.id}`)[0].l, creator);
  }),
);

test('O1.5 exclusive: a second person on a confirmed repo is refused with a plain line, and their branch never confirms', dbTest, () =>
  withEnv(ON, async () => {
    const key = `${uniq('first')}/recipes`;
    const gh = fakeGitHub();
    const a = await start(gh, key);
    const b = await start(gh, key);
    assert.notEqual(a.branch, b.branch);
    gh.push(key, a.branch);
    assert.equal(await checkProofBranch(a.id, new Date(), { ghFetch: gh.f }), true);
    gh.push(key, b.branch);
    assert.equal(await checkProofBranch(b.id, new Date(), { ghFetch: gh.f }), false, 'the first holder keeps it');
    assert.deepEqual(await source(b.id, key), { state: 'proposed', proof: null });
    const r = await again(gh, b.id);
    assert.equal(r.show_to_builder.split('\n')[1], takenLine('Recipe planner'), r.show_to_builder);
    assert.equal(r.proof, undefined);
    // A third person never gets a code for it.
    const c = await start(gh, key);
    assert.equal(c.r.show_to_builder.split('\n')[1], takenLine('Recipe planner'));
    assert.equal((await rows(c.id)).length, 0);
  }),
);

test('O1.6 expired: never verifies, the plain line, no new code within a day; after a day a new code', dbTest, () =>
  withEnv(ON, async () => {
    const key = `${uniq('late')}/recipes`;
    const gh = fakeGitHub();
    const { id, branch } = await start(gh, key);
    await age(id, PROOF_BRANCH_TTL_MS + 1000);
    gh.push(key, branch);
    assert.equal(await checkProofBranch(id, new Date(), { ghFetch: gh.f }), false);
    const r = await again(gh, id);
    assert.equal(r.show_to_builder.split('\n')[1], cantShowLine('Recipe planner'), r.show_to_builder);
    assert.equal(r.proof, undefined);
    assert.equal((await rows(id)).length, 1, 'no new code within the day');
    await age(id, DAY);
    const next = await again(gh, id);
    assert.equal(next.show_to_builder.split('\n')[1], checkingBranchLine('Recipe planner'), next.show_to_builder);
    assert.notEqual(proofOf(next)?.branch, branch);
    assert.equal((await rows(id)).length, 2);
  }),
);

test('O1.7 (O2 fix round 1, ruling 2) at most 5 new codes per person per rolling day across all keys: alternating between two projects 6 times gives 5 codes, then the slow line', dbTest, () =>
  withEnv(ON, async () => {
    const gh = fakeGitHub();
    const a = `${uniq('one')}/recipes`;
    const b = `${uniq('two')}/recipes`;
    const { id } = await start(gh, a);
    let last: Awaited<ReturnType<typeof find>> | null = null;
    for (let i = 0; i < 6; i++) last = await find(id, named(i % 2 === 0 ? b : a, { agent_can_build: true }), { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.equal((await rows(id)).length, 5, 'five codes in the day');
    assert.equal(last!.proof, undefined, 'the sixth switch gets no code');
    const closed = await sql()`SELECT 1 FROM proof_branches WHERE builder_id = ${id} AND closed_at IS NOT NULL`;
    assert.equal(closed.length, 5, 'every switched-away code is closed, never deleted');
    assert.equal(last!.show_to_builder.split('\n')[1], confirmingSlowLine('Recipe planner'), last!.show_to_builder);
  }),
);

test('O3.4b (carried from O2\'s review) a starter build\'s deploy step: a code that expired unused gets a fresh one at once, within the 5-a-day cap; find keeps the day\'s plain line', dbTest, () =>
  withEnv(ON, async () => {
    const key = `${uniq('build')}/tipjar`;
    const gh = fakeGitHub();
    const { id, branch } = await start(gh, key);
    await age(id, PROOF_BRANCH_TTL_MS + 1000);
    assert.deepEqual(await proofBranchFor(id, key, new Date(), { canBuild: true }), { kind: 'failed' }, 'find: no new code within the day');
    const fresh = await proofBranchFor(id, key, new Date(), { canBuild: true, buildDeploy: true });
    assert.equal(fresh?.kind, 'checking', JSON.stringify(fresh));
    const next = fresh?.kind === 'checking' ? fresh.proof.branch : '';
    assert.match(next, /^earnkit-[a-z2-7]{12}$/);
    assert.notEqual(next, branch);
    assert.equal((await rows(id)).length, 2);
    // The fresh code is the open one now: the same code again, not a third.
    const same = await proofBranchFor(id, key, new Date(), { canBuild: true, buildDeploy: true });
    assert.equal(same?.kind === 'checking' ? same.proof.branch : '', next);
    // The cap still holds: with 5 codes in the day, an expired one gets the plain failure, never a sixth code.
    for (let i = 0; i < 3; i++) {
      await age(id, PROOF_BRANCH_TTL_MS + 1000);
      assert.equal((await proofBranchFor(id, key, new Date(), { canBuild: true, buildDeploy: true }))?.kind, 'checking');
    }
    assert.equal((await rows(id)).length, 5);
    await age(id, PROOF_BRANCH_TTL_MS + 1000);
    assert.deepEqual(await proofBranchFor(id, key, new Date(), { canBuild: true, buildDeploy: true }), { kind: 'failed' });
    assert.equal((await rows(id)).length, 5);
  }),
);

test('O1.8 a used code never verifies again; another person\'s code never confirms this person', dbTest, () =>
  withEnv(ON, async () => {
    const key = `${uniq('used')}/recipes`;
    const gh = fakeGitHub();
    const { id, branch } = await start(gh, key);
    gh.push(key, branch);
    assert.equal(await checkProofBranch(id, new Date(), { ghFetch: gh.f }), true);
    await sql()`UPDATE builder_sources SET state = 'proposed', proof = NULL, verified_at = NULL WHERE builder_id = ${id} AND kind = 'repo'`;
    await sql()`UPDATE proof_branches SET checked_at = NULL WHERE builder_id = ${id}`;
    assert.equal(await checkProofBranch(id, new Date(), { ghFetch: gh.f }), false, 'used');
    // Two people, two codes, one repo nobody holds yet: only the person whose code is on GitHub.
    const shared = `${uniq('both')}/recipes`;
    const a = await start(gh, shared);
    const b = await start(gh, shared);
    gh.push(shared, a.branch);
    assert.equal(await checkProofBranch(b.id, new Date(), { ghFetch: gh.f }), false);
    assert.deepEqual(await source(b.id, shared), { state: 'proposed', proof: null });
  }),
);

test('O1.9 at most one GitHub check a minute per person (two finds: one ref read)', dbTest, () =>
  withEnv(ON, async () => {
    const gh = fakeGitHub();
    const { id } = await start(gh, `${uniq('quiet')}/recipes`);
    const before = gh.refReads();
    await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
    await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.equal(gh.refReads() - before, 1, 'one read for two finds within a minute');
    await sql()`UPDATE proof_branches SET checked_at = checked_at - ${`${PROOF_BRANCH_RECHECK_MS + 1000} milliseconds`}::interval WHERE builder_id = ${id}`;
    await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.equal(gh.refReads() - before, 2);
  }),
);

test('O1.10 an agent that can\'t build gets no code and the plain line', dbTest, () =>
  withEnv(ON, async () => {
    const gh = fakeGitHub();
    const id = await install();
    const r = await find(id, named(`${uniq('chat')}/recipes`, { agent_can_build: false }), { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.equal(r.show_to_builder.split('\n')[1], needsAgentLine('Recipe planner'), r.show_to_builder);
    assert.equal(r.proof, undefined);
    assert.equal((await rows(id)).length, 0);
  }),
);

test('O1.11 the cron step: checks with the run\'s fetch until its deadline, and clears rows over 7 days old', dbTest, () =>
  withEnv(ON, async () => {
    const key = `${uniq('cron')}/recipes`;
    const gh = fakeGitHub();
    const { id, branch } = await start(gh, key);
    gh.push(key, branch);
    const reader = { ghFetch: gh.f } as ReaderDeps;
    assert.deepEqual(await proofBranchStep(new Date(), { only: [id], deadline: Date.now() + 5000 }), { checked: 0, confirmed: 0, cleared: 0 }, 'no fetch: skipped');
    assert.deepEqual(await proofBranchStep(new Date(), { reader, only: [id], deadline: Date.now() - 1 }), { checked: 0, confirmed: 0, cleared: 0 }, 'past the deadline');
    assert.deepEqual(await proofBranchStep(new Date(), { reader, only: [id], deadline: Date.now() + 5000 }), { checked: 1, confirmed: 1, cleared: 0 });
    await age(id, 8 * DAY);
    assert.deepEqual(await proofBranchStep(new Date(), { reader, only: [id], deadline: Date.now() + 5000 }), { checked: 0, confirmed: 0, cleared: 1 });
    assert.equal((await rows(id)).length, 0);
  }),
);

/** The gate's reads for a coin on `key` by installation `id`, with this test's GitHub. */
const gateDeps = (gh: ReturnType<typeof fakeGitHub>): GateDeps => ({
  verified: async () => null, shared: async () => false, appToken: async () => null, appLink: async () => null,
  repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
  owner: async () => ({ status: 'missing' }) as never, latest: async () => null, screen: async () => {},
  branchProof: (installationId, repoKey) => coinBranchProof(installationId, repoKey, new Date(), { ghFetch: gh.f }),
});
const coinInput = (id: number, key: string) => ({ policy: 'encouraged' as const, repoUrl: `https://github.com/${key}`, wallet: `0x${'1a'.repeat(20)}`, symbol: 'RCP', installationId: id });
/** A person whose `key` was confirmed by its proof branch just now. */
async function proven(gh: ReturnType<typeof fakeGitHub>, key: string) {
  const s = await start(gh, key);
  gh.push(key, s.branch);
  assert.equal(await checkProofBranch(s.id, new Date(), { ghFetch: gh.f }), true);
  return s;
}

test('O1.12 a coin: a fresh branch proof whose repo still reads the same passes the gate with no line; the coin note names no line; flag off, the line as today', dbTest, () =>
  withEnv(ON, async () => {
    const key = `${uniq('coin')}/recipes`;
    const gh = fakeGitHub();
    const { id } = await proven(gh, key);
    const reads = gh.calls.length;
    assert.deepEqual(await tokenGate(coinInput(id, key), gateDeps(gh)), { ok: true });
    assert.deepEqual(gh.calls.slice(reads), [`/repos/${key}`], 'one launch-time read of the repo');
    assert.doesNotMatch(coinYesNote(), /line|earnkit\.txt/i);
    await withEnv({ EARNKIT_BENCH: undefined }, async () => {
      const off = await tokenGate(coinInput(id, key), { ...gateDeps(gh), branchProof: undefined });
      assert.equal(off.ok, false, 'flag off: the line is still asked');
      assert.equal(coinYesNote(), COIN_YES_NOTE);
    });
  }),
);

test('O1.12b the coin gate asks for a fresh proof branch (never a line) when the proof is 31 days old, the key was re-created, or the repo is now a fork; a fresh push by the owner passes (a fork never)', dbTest, () =>
  withEnv(ON, async () => {
    const cases: [string, (gh: ReturnType<typeof fakeGitHub>, id: number, key: string) => Promise<void>][] = [
      ['31 days old', async (_gh, id) => void (await sql()`UPDATE builder_sources SET verified_at = now() - interval '31 days' WHERE builder_id = ${id} AND proof = 'proof_branch'`)],
      ['re-created key', async (gh, _id, key) => void (gh.repos[key] = { id: idOf(key) + 1 })],
      ['now a fork', async (gh, _id, key) => void (gh.repos[key] = { fork: true })],
    ];
    for (const [why, change] of cases) {
      const key = `${uniq('stale')}/recipes`;
      const gh = fakeGitHub();
      const { id } = await proven(gh, key);
      await change(gh, id, key);
      // A new code may be issued: the first one was a day ago.
      await age(id, DAY + 1000);
      const g = await tokenGate(coinInput(id, key), gateDeps(gh));
      assert.equal(g.ok, false, why);
      assert.ok(!g.ok && g.fixable, why);
      const reason = !g.ok ? g.reason : '';
      const note = !g.ok ? (g.agent_note ?? '') : '';
      if (why !== 'now a fork') assert.equal(reason, coinBranchReason(key.split('/')[1]), why);
      assert.doesNotMatch(`${reason} ${note}`, /earnkit\.txt|proof line|token:/i, why);
      // O5 fix round 1: a repo that is now a fork is known at the launch-time read: the plain line, no branch.
      if (why === 'now a fork') {
        assert.equal(reason, copyLine(key.split('/')[1]), why);
        assert.doesNotMatch(note, /refs\/heads\/earnkit-/, why);
        continue;
      }
      const branch = /refs\/heads\/(earnkit-[a-z2-7]{12})/.exec(note)?.[1];
      assert.ok(branch, `${why}: ${note}`);
      gh.push(key, branch!);
      const after = await tokenGate(coinInput(id, key), gateDeps(gh));
      assert.deepEqual(after, { ok: true }, why);
      const [v] = await sql()<{ fresh: boolean; gh_repo_id: string }[]>`
        SELECT verified_at > now() - interval '1 minute' AS fresh, gh_repo_id::text FROM builder_sources WHERE builder_id = ${id} AND proof = 'proof_branch'`;
      assert.deepEqual({ ...v }, { fresh: true, gh_repo_id: String(gh.repos[key]?.id ?? idOf(key)) }, `${why}: the proof is taken again, with the repo's id now`);
    }
  }),
);

test('O1.13 discovery: a proof_branch repo survives only the not_owner reject; a repo now derived or with a new GitHub id is revoked', dbTest, () =>
  withEnv({ ...ON, EARNKIT_BENCH: undefined }, async () => {
    const run = async (listing: Record<string, unknown>) => {
      const id = await install();
      await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`v2131-${id}`})`;
      const key = `${uniq('kept')}/recipes`;
      await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by, verified_at, gh_repo_id, gh_owner, gh_owner_type)
        VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_branch', 'server', now(), ${idOf(key)}, ${key.split('/')[0]}, 'User')`;
      const login = uniq('zed');
      // The proven login's owned-repo listing names the repo, owned by someone else.
      const reader = new Proxy({}, {
        get: (_t, k) => {
          if (k === 'now') return new Date();
          if (k === 'ghSpent') return () => false;
          if (k === 'gh') return async (path: string) =>
            path.startsWith(`/users/${login}/repos`) ? [{ id: idOf(key), full_name: key, fork: false, is_template: false, owner: { login: key.split('/')[0], type: 'User' }, ...listing }]
            : path === `/users/${login}` ? { login, blog: null, twitter_username: null } : [];
          return async () => [];
        },
      }) as ReaderDeps;
      await discoverPerson(id, { deadline: Date.now() + 10_000, reader, login: async () => ({ login, basis: 'signin' }) });
      return source(id, key);
    };
    assert.deepEqual(await run({}), { state: 'verified', proof: 'proof_branch' }, 'not_owner: kept');
    assert.equal((await run({ fork: true }))?.state, 'rejected', 'now a fork: revoked');
    assert.equal((await run({ id: 1 }))?.state, 'rejected', 'a new GitHub id: revoked');
  }),
);

test('O1.15 discovery never verifies (repo_owner) a repo another person already holds', dbTest, () =>
  withEnv({ ...ON, EARNKIT_BENCH: undefined }, async () => {
    const login = uniq('owner');
    const key = `${login}/recipes`;
    const holder = await install();
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by, verified_at)
      VALUES (${holder}, 'repo', ${key}, ${key}, 'verified', 'proof_branch', 'server', now())`;
    const id = await install();
    await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`v2131-${id}`})`;
    const reader = new Proxy({}, {
      get: (_t, k) => {
        if (k === 'now') return new Date();
        if (k === 'ghSpent') return () => false;
        if (k === 'gh') return async (path: string) =>
          path.startsWith(`/users/${login}/repos`) ? [{ id: idOf(key), full_name: key, fork: false, is_template: false, owner: { login, type: 'User' } }]
          : path === `/users/${login}` ? { login, blog: null, twitter_username: null } : [];
        return async () => [];
      },
    }) as ReaderDeps;
    await discoverPerson(id, { deadline: Date.now() + 10_000, reader, login: async () => ({ login, basis: 'signin' }) });
    assert.notEqual((await source(id, key))?.state, 'verified', 'the first holder keeps it');
  }),
);

test('O1.16 a person\'s own linked installation never reads as another account', dbTest, () =>
  withEnv(ON, async () => {
    const key = `${uniq('mine')}/recipes`;
    const root = await install();
    const other = await install();
    await sql()`UPDATE installations SET builder_id = ${root} WHERE id = ${other}`;
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by, verified_at)
      VALUES (${root}, 'repo', ${key}, ${key}, 'verified', 'proof_branch', 'server', now())`;
    const state = await proofBranchFor(other, key, new Date(), { canBuild: true });
    assert.notEqual(state?.kind, 'taken');
    const stranger = await install();
    assert.equal((await proofBranchFor(stranger, key, new Date(), { canBuild: true }))?.kind, 'taken');
  }),
);

test('O1.14 flag off: no branch, no GitHub reads, no codes, today\'s claim link', dbTest, () =>
  withEnv({ ...ON, EARNKIT_BENCH: undefined }, async () => {
    const gh = fakeGitHub();
    const id = await install();
    const r = await find(id, named(`${uniq('off')}/recipes`), { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.doesNotMatch(r.show_to_builder, /temporary branch/);
    assert.equal(proofOf(r)?.branch, undefined);
    assert.equal((await rows(id)).length, 0);
    assert.deepEqual(gh.calls, []);
    assert.match((await claimLink(id)) ?? '', /^earnkit\.com\/claim\/[a-z2-7]{12}$/);
  }),
);
