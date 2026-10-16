import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { X_ON, find, install, withEnv } from './fixtures/find';
import { claimLink } from './claim';
import { proofFor } from './main-project';
import { PROOF_BRANCH_NOTE, PROOF_BRANCH_TTL_MS, checkProofBranch, proofBranchStep, removeCommand } from './proof-branch';
import { benchReply, cantShowLine, checkingBranchLine, type BenchView } from './bench-reply';
import type { ReaderDeps } from './source-readers';

/**
 * v2.13.1 O1 (owner ruling, proof branch): while the one project (a GitHub repo) isn't confirmed,
 * find gives the agent a one-hour, single-use branch name to push (no file, no commit) and tells the
 * builder in one line. EarnKit reads the branch on the exact repo with its own token; a pass verifies
 * the repo (`proof_branch`), rescores at once and tells the agent to delete the branch. A branch that
 * never shows gets one plain line. The claim link is a full https URL. Flag off: today's.
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
let seq = 0;
const uniq = (p: string) => `${p}${RUN}${++seq}`;

/** A fake GitHub REST API: branches by `owner/repo#branch`, repos' metadata (default: their own, not a fork). */
function fakeGitHub(o: { branches?: Set<string>; repos?: Record<string, { fork?: boolean; is_template?: boolean; full_name?: string }> } = {}) {
  const branches = o.branches ?? new Set<string>();
  const calls: string[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    assert.equal(url.host, 'api.github.com');
    assert.equal(init?.redirect, 'manual', 'redirects are refused');
    const ref = /^\/repos\/([^/]+\/[^/]+)\/git\/ref\/heads\/(.+)$/.exec(url.pathname);
    if (ref) {
      const [, key, branch] = ref;
      return branches.has(`${key}#${branch}`)
        ? json(200, { ref: `refs/heads/${branch}`, url: `https://api.github.com/repos/${key}/git/refs/heads/${branch}`, object: { sha: 'a'.repeat(40), type: 'commit' } })
        : json(404, { message: 'Not Found' });
    }
    const repo = /^\/repos\/([^/]+\/[^/]+)$/.exec(url.pathname);
    if (repo) return json(200, { full_name: repo[1], fork: false, is_template: false, ...o.repos?.[repo[1]] });
    return json(404, {});
  }) as typeof fetch;
  return { f, branches, calls };
}

const named = (key: string) => ({ identity: { github_login: key.split('/')[0], project: { name: 'Recipe planner', what: 'a recipe planner', repo: key } } });
const source = async (id: number, key: string) => {
  const [s] = await sql()<{ state: string; proof: string | null }[]>`
    SELECT state, proof FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo' AND lower(ref) = ${key} ORDER BY id LIMIT 1`;
  return s ? { ...s } : null;
};
const codes = (id: number) => sql()<{ code: string; repo_key: string; used_at: Date | null; told_at: Date | null; expires_at: Date; issued_at: Date }[]>`
  SELECT code, repo_key, used_at, told_at, expires_at, issued_at FROM proof_branches WHERE builder_id = ${id} ORDER BY issued_at`;
const ranked = async (id: number) => Boolean((await sql()`SELECT 1 FROM builder_live WHERE builder_id = ${id} AND ranked`)[0]);
const started = async (id: number, key: string) => Boolean((await sql()`SELECT 1 FROM project_updates WHERE builder_id = ${id} AND lower(project_key) = ${key} AND facts ? 'started'`)[0]);
/** Moves the person's codes `ms` into the past (issued and expiry). */
const age = (id: number, ms: number) => sql()`
  UPDATE proof_branches SET issued_at = issued_at - ${`${ms} milliseconds`}::interval, expires_at = expires_at - ${`${ms} milliseconds`}::interval WHERE builder_id = ${id}`;

// ---- Pure

test('O1.1 the lines: checking with a temporary branch (no question), and the plain line when it never showed', () => {
  assert.equal(checkingBranchLine('Recipe planner'), "I'll check Recipe planner is yours with a quick temporary branch on GitHub. It's removed right after.");
  assert.equal(cantShowLine('Recipe planner'), "I couldn't show Recipe planner is yours. Ask your agent to use a project you can push to.");
  const v: BenchView = {
    project: { key: 'maya/recipes', name: 'Recipe planner', confirmed: false, live: false, weeks: 0 },
    rank: null, claimed: false, handle: null, claimLink: 'https://earnkit.com/claim/abcdefghijkl', fund: [], ask: null, branch: 'checking',
  };
  assert.equal(benchReply(v), ['Where you stand', checkingBranchLine('Recipe planner'), 'Claim your page with X: https://earnkit.com/claim/abcdefghijkl'].join('\n'));
  assert.equal(benchReply({ ...v, branch: 'failed' }).split('\n')[1], cantShowLine('Recipe planner'));
  for (const b of ['checking', 'failed'] as const) assert.doesNotMatch(benchReply({ ...v, branch: b }), /\?|earnkit\.txt|sign in/i);
});

// ---- Through find

test('O1.2 a branch on the repo: the first reply has one https link and the branch for the agent; the next find confirms, ranks, starts the log, uses the code and tells the agent to delete it', dbTest, () =>
  withEnv(ON, async () => {
    const key = `${uniq('maya')}/recipes`;
    const gh = fakeGitHub();
    const id = await install();
    const r1 = await find(id, named(key), { ...NO_MATCH, proofBranchFetch: gh.f });
    const lines = r1.show_to_builder.split('\n');
    assert.equal(lines[1], checkingBranchLine('Recipe planner'), r1.show_to_builder);
    assert.match(r1.claim?.link ?? '', /^https:\/\/earnkit\.com\/claim\/[a-z2-7]{12}$/);
    assert.equal(lines[2], `Claim your page with X: ${r1.claim!.link}`);
    assert.equal((r1.show_to_builder.match(/https?:\/\//g) ?? []).length, 1, 'the claim link is the only link');
    const proof = r1.proof as unknown as Record<string, string>;
    const [c] = await codes(id);
    assert.match(c.code, /^[a-z2-7]{12}$/);
    assert.equal(c.repo_key, key);
    assert.equal(c.expires_at.getTime() - c.issued_at.getTime(), PROOF_BRANCH_TTL_MS);
    assert.deepEqual(proof, {
      repo: key, branch: `earnkit-${c.code}`, push: `git push origin HEAD:refs/heads/earnkit-${c.code}`,
      remove: `git push origin :refs/heads/earnkit-${c.code}`, agent_note: PROOF_BRANCH_NOTE,
    });
    assert.equal(await proofFor(id, id, { canPush: true, now: new Date() }), null, 'no line to push under the flag');
    // Asked again before the push: the same code (a new one only after expiry), nothing confirmed.
    const r2 = await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.equal((r2.proof as unknown as Record<string, string>).branch, `earnkit-${c.code}`);
    assert.equal((await codes(id)).length, 1);
    assert.deepEqual(await source(id, key), { state: 'proposed', proof: null });
    // The agent pushed the branch; the next find checks it.
    gh.branches.add(`${key}#earnkit-${c.code}`);
    const r3 = await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.deepEqual(await source(id, key), { state: 'verified', proof: 'proof_branch' });
    assert.equal(await ranked(id), true, 'rescored at once');
    assert.equal(await started(id, key), true, 'the Started row');
    assert.ok((await codes(id))[0].used_at, 'the code is used');
    assert.deepEqual(r3.proof, { remove: removeCommand(c.code), agent_note: `Confirmed. Delete the branch now: ${removeCommand(c.code)}` });
    assert.doesNotMatch(r3.show_to_builder, /temporary branch/);
    // Told once.
    assert.equal((await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f })).proof, undefined);
  }),
);

test('O1.3 a branch on a fork never counts, nor a branch on a main project that is itself a fork', dbTest, () =>
  withEnv(ON, async () => {
    const key = `${uniq('own')}/recipes`;
    const gh = fakeGitHub();
    const id = await install();
    await find(id, named(key), { ...NO_MATCH, proofBranchFetch: gh.f });
    const [c] = await codes(id);
    gh.branches.add(`${uniq('forker')}/recipes#earnkit-${c.code}`);
    assert.equal(await checkProofBranch(id, new Date(), { ghFetch: gh.f }), false);
    // The main project is a fork: the branch is there, but it is not their own work.
    const forked = `${uniq('fk')}/recipes`;
    const gf = fakeGitHub({ repos: { [forked]: { fork: true } } });
    const id2 = await install();
    await find(id2, named(forked), { ...NO_MATCH, proofBranchFetch: gf.f });
    const [c2] = await codes(id2);
    gf.branches.add(`${forked}#earnkit-${c2.code}`);
    assert.equal(await checkProofBranch(id2, new Date(), { ghFetch: gf.f }), false);
    for (const [who, k] of [[id, key], [id2, forked]] as const) {
      assert.deepEqual(await source(who, k), { state: 'proposed', proof: null });
      assert.equal(await ranked(who), false);
      assert.equal((await codes(who))[0].used_at, null);
    }
  }),
);

test('O1.4 an expired code never verifies; after the hour the reply has the plain line, no proof and no new code', dbTest, () =>
  withEnv(ON, async () => {
    const key = `${uniq('late')}/recipes`;
    const gh = fakeGitHub();
    const id = await install();
    await find(id, named(key), { ...NO_MATCH, proofBranchFetch: gh.f });
    const [c] = await codes(id);
    await age(id, PROOF_BRANCH_TTL_MS + 1000);
    gh.branches.add(`${key}#earnkit-${c.code}`);
    assert.equal(await checkProofBranch(id, new Date(), { ghFetch: gh.f }), false);
    const r = await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.equal(r.show_to_builder.split('\n')[1], cantShowLine('Recipe planner'), r.show_to_builder);
    assert.equal(r.proof, undefined);
    assert.equal((await codes(id)).length, 1, 'no loop: no new code');
    assert.deepEqual(await source(id, key), { state: 'proposed', proof: null });
  }),
);

test('O1.5 a used code never verifies again', dbTest, () =>
  withEnv(ON, async () => {
    const key = `${uniq('used')}/recipes`;
    const gh = fakeGitHub();
    const id = await install();
    await find(id, named(key), { ...NO_MATCH, proofBranchFetch: gh.f });
    const [c] = await codes(id);
    gh.branches.add(`${key}#earnkit-${c.code}`);
    assert.equal(await checkProofBranch(id, new Date(), { ghFetch: gh.f }), true);
    // The repo's proof taken away (a revoke): the same branch, the same code, proves nothing now.
    await sql()`UPDATE builder_sources SET state = 'proposed', proof = NULL, verified_at = NULL WHERE builder_id = ${id} AND kind = 'repo'`;
    assert.equal(await checkProofBranch(id, new Date(), { ghFetch: gh.f }), false);
    assert.deepEqual(await source(id, key), { state: 'proposed', proof: null });
  }),
);

test('O1.6 another person\'s code: a branch made for one person never confirms another naming the same repo', dbTest, () =>
  withEnv(ON, async () => {
    const key = `${uniq('shared')}/recipes`;
    const gh = fakeGitHub();
    const [a, b] = [await install(), await install()];
    await find(a, named(key), { ...NO_MATCH, proofBranchFetch: gh.f });
    await find(b, named(key), { ...NO_MATCH, proofBranchFetch: gh.f });
    const [ca] = await codes(a);
    const [cb] = await codes(b);
    assert.notEqual(ca.code, cb.code);
    gh.branches.add(`${key}#earnkit-${ca.code}`);
    assert.equal(await checkProofBranch(b, new Date(), { ghFetch: gh.f }), false);
    assert.deepEqual(await source(b, key), { state: 'proposed', proof: null });
    assert.equal(await checkProofBranch(a, new Date(), { ghFetch: gh.f }), true);
    assert.deepEqual(await source(a, key), { state: 'verified', proof: 'proof_branch' });
  }),
);

test('O1.7 the cron step checks open codes with the run\'s budgeted fetch (none: skipped)', dbTest, () =>
  withEnv(ON, async () => {
    const key = `${uniq('cron')}/recipes`;
    const gh = fakeGitHub();
    const id = await install();
    await find(id, named(key), { ...NO_MATCH, proofBranchFetch: gh.f });
    const [c] = await codes(id);
    gh.branches.add(`${key}#earnkit-${c.code}`);
    assert.deepEqual(await proofBranchStep(new Date(), { only: [id] }), { checked: 0, confirmed: 0 });
    assert.deepEqual(await proofBranchStep(new Date(), { reader: { ghFetch: gh.f } as ReaderDeps, only: [id] }), { checked: 1, confirmed: 1 });
    assert.deepEqual(await source(id, key), { state: 'verified', proof: 'proof_branch' });
  }),
);

test('O1.8 flag off: no branch, today\'s claim link', dbTest, () =>
  withEnv({ ...ON, EARNKIT_BENCH: undefined }, async () => {
    const gh = fakeGitHub();
    const id = await install();
    const r = await find(id, named(`${uniq('off')}/recipes`), { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.doesNotMatch(r.show_to_builder, /temporary branch/);
    assert.equal((r.proof as { branch?: string } | undefined)?.branch, undefined);
    assert.equal((await codes(id)).length, 0);
    assert.deepEqual(gh.calls, []);
    assert.match((await claimLink(id)) ?? '', /^earnkit\.com\/claim\/[a-z2-7]{12}$/);
  }),
);
