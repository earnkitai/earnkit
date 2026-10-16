import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { withEnv } from './fixtures/find';
import { benchProject, noteIdentity, projectKeyOf } from './identity-input';
import { MAIN_PROOF_MIN_MS, PROOF_NOTE, confirming, confirmingFast, fillGithubUser, mainProjectOf, pickMainProject, proofFor, setMainProject } from './main-project';
import { proofLineCheck } from './discovery';
import type { ReaderDeps } from './source-readers';
import { tools } from './tools';
import { refreshDiscovery } from './person-score';
import { PROOF_BRANCH_NOTE } from './proof-branch';

process.env.EARNKIT_BUILDER_SCORE = 'on';
process.env.EARNKIT_BENCH = 'on';
process.env.EARNKIT_AUTH_SECRET ||= 'v213-main-secret';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = randomBytes(3).toString('hex');

async function person(): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v213-main-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`v213m-${id}`})`;
  return id;
}

test('2.1 the one project: identity.project wins, else the first of an old agent\'s projects[]; the rest are ignored', () => {
  const one = benchProject({ project: { name: 'Recipe planner', what: 'a recipe planner', repo: 'https://github.com/Maya/recipes.git', live_url: 'https://recipes.app/x', chain: 'base' }, projects: [{ name: 'Other', repo: 'maya/other' }] });
  assert.deepEqual(one, { name: 'Recipe planner', what: 'a recipe planner', repo: 'maya/recipes', live_url: 'https://recipes.app', package: null, contracts: [] });
  assert.equal(projectKeyOf(one!), 'maya/recipes');
  const old = benchProject({ projects: [{ name: 'First', repo: 'maya/first' }, { name: 'Second', repo: 'maya/second' }] });
  assert.equal(old?.repo, 'maya/first');
  assert.equal(benchProject({ project: [{ name: 'a list', repo: 'maya/a' }] }), null, 'a list is not the project');
  assert.equal(benchProject({ project: { name: 'No links' } }), null, 'nothing to read');
  assert.equal(benchProject('junk'), null);
  assert.equal(benchProject(undefined), null);
});

test('2.2 the project is set once it is confirmed; before that a different project replaces it (R1, v2.13.1 O2 B6)', dbTest, async () => {
  const id = await person();
  const a = await setMainProject(id, { name: 'A', what: null, repo: `maya${RUN}/a`, live_url: null, package: null, contracts: [] });
  assert.deepEqual(a, { key: `maya${RUN}/a`, set: true });
  const b = await setMainProject(id, { name: 'B', what: null, repo: `maya${RUN}/b`, live_url: null, package: null, contracts: [] });
  assert.deepEqual(b, { key: `maya${RUN}/b`, set: true }, 'not confirmed: replaced');
  assert.deepEqual(await setMainProject(id, { name: 'B', what: null, repo: `maya${RUN}/b`, live_url: null, package: null, contracts: [] }), { key: `maya${RUN}/b`, set: false });
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, ${`maya${RUN}/b`}, 'B', 'app', true, true)`;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at) VALUES (${id}, 'repo', ${`maya${RUN}/b`}, ${`maya${RUN}/b`}, 'proof_line', 'verified', 'agent', now())`;
  const c = await setMainProject(id, { name: 'C', what: null, repo: `maya${RUN}/c`, live_url: null, package: null, contracts: [] });
  assert.deepEqual(c, { key: `maya${RUN}/b`, set: false }, 'confirmed: set once');
  assert.equal(await mainProjectOf(id), `maya${RUN}/b`);
});

// Preflight F17: through the real find (tools.ts list_programs), an old agent's two projects: only
// the first is the one project, only its sources are proposed, never verified, and its proof line is
// in the same reply.
test('2.3 under the flag find records the one project: its sources only, proposed, and the proof line in the reply', dbTest, async () => {
  const id = await person();
  // Every read fails (offline); the GitHub budget is never spent. No program matching leaves the process.
  const offline = new Proxy({}, { get: (_t, k) => (k === 'now' ? new Date() : k === 'ghSpent' ? () => false : async () => { throw new Error('offline'); }) }) as ReaderDeps;
  const ctx = { installationId: id, readerDeps: offline, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) } as never;
  const identity = { github_login: `maya${RUN}`, projects: [{ name: 'A', repo: `maya${RUN}/a`, live_url: 'https://a.example.com' }, { name: 'B', repo: `maya${RUN}/b` }] };
  const r = (await tools.find({ identity }, ctx)) as { proof?: { branch?: string; push?: string; agent_note: string } };
  assert.equal(await mainProjectOf(id), `maya${RUN}/a`);
  const rows = await sql()<{ ref: string; state: string }[]>`SELECT ref, state FROM builder_sources WHERE builder_id = ${id} ORDER BY ref`;
  assert.deepEqual(rows.map((x) => x.ref), ['https://a.example.com', `maya${RUN}/a`]);
  assert.ok(rows.every((x) => x.state === 'proposed'), 'an agent report never confirms');
  // v2.13.1 O1: the proof is a temporary branch for the agent to push (no line, no file).
  assert.match(r.proof?.branch ?? '', /^earnkit-[a-z2-7]{12}$/);
  assert.equal(r.proof?.push, `git push origin HEAD:refs/heads/${r.proof?.branch}`);
  assert.equal(r.proof?.agent_note, PROOF_BRANCH_NOTE);
  assert.equal((await sql()`SELECT github_user FROM installations WHERE id = ${id}`)[0].github_user, `maya${RUN}`);
  // v2.13.1 O2 (B6): a different project sent later replaces the one project while it isn't confirmed.
  await tools.find({ identity: { github_login: `maya${RUN}`, project: { name: 'C', repo: `maya${RUN}/c` } } }, ctx);
  assert.equal(await mainProjectOf(id), `maya${RUN}/c`);
  const later = await sql()<{ ref: string }[]>`SELECT ref FROM builder_sources WHERE builder_id = ${id} ORDER BY ref`;
  assert.ok(later.some((x) => x.ref === `maya${RUN}/c`), 'the new one project is proposed');
});

test('2.4 the proof line (flag off only; none under the flag): issued for an unconfirmed repo, recorded, github_user filled with the owner; none once confirmed', dbTest, async () => {
  const id = await person();
  const key = `maya${RUN}/proof`;
  await setMainProject(id, { name: 'P', what: null, repo: key, live_url: null, package: null, contracts: [] });
  await fillGithubUser(id, key, null);
  assert.equal((await sql()`SELECT github_user FROM installations WHERE id = ${id}`)[0].github_user, `maya${RUN}`);
  await fillGithubUser(id, key, 'someone-else');
  assert.equal((await sql()`SELECT github_user FROM installations WHERE id = ${id}`)[0].github_user, `maya${RUN}`, 'never overwritten');
  assert.equal(await proofFor(id, id, { canPush: true, now: new Date() }), null, 'flag on: no line to push');
  const p = await withEnv({ EARNKIT_BENCH: undefined }, () => proofFor(id, id, { canPush: true, now: new Date() }));
  assert.ok(p && 'line' in p);
  assert.match(p.line, /^token: [0-9a-f]{10,}$/);
  assert.equal(p.file, 'earnkit.txt');
  assert.equal(p.agent_note, PROOF_NOTE);
  assert.equal(await confirming(id), true);
  const [issued] = await sql()`SELECT 1 FROM proof_line_issues WHERE installation_id = ${id} AND repo_key = ${key}`;
  assert.ok(issued, 'commits after this moment count (v2.11 R4 b)');
  // T4 fix round 1 (ruling): a confirmed row alone (a coin or an entry naming the repo) is not the repo's proof.
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, ${key}, 'P', 'code', true, false)`;
  assert.equal(await confirming(id), true, 'still Confirming without the repo proof');
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'server')`;
  assert.equal(await withEnv({ EARNKIT_BENCH: undefined }, () => proofFor(id, id, { canPush: true, now: new Date() })), null);
  assert.equal(await confirming(id), false);
});

test('2.5 a repo the agent does not own stays Confirming: proposed, unranked, and the cron proof check names no one (review focus 3)', dbTest, async () => {
  const id = await person();
  const key = `notmaya${RUN}/stolen`;
  await setMainProject(id, { name: 'S', what: null, repo: key, live_url: null, package: null, contracts: [] });
  await noteIdentity(id, { github_login: `maya${RUN}`, projects: [{ name: 'S', what: null, repo: key, live_url: null, package: null, contracts: [] }], wallets: [] }, new Date());
  await fillGithubUser(id, key, `maya${RUN}`);
  // github_login reported as maya; the repo's owner is notmaya: github_user is not set to either (B3).
  assert.equal((await sql()`SELECT github_user FROM installations WHERE id = ${id}`)[0].github_user, null);
  // A reader whose activity log says someone else pushed the line: no login, nothing verified.
  const reader = { now: new Date(), ghFetch: async () => new Response('[]', { status: 200 }), ghSpent: () => false } as unknown as ReaderDeps;
  const check = proofLineCheck(reader, Date.now() + 10_000, { minMs: MAIN_PROOF_MIN_MS });
  assert.equal(await check(id, key), null);
  const [src] = await sql()<{ state: string }[]>`SELECT state FROM builder_sources WHERE builder_id = ${id} AND ref = ${key}`;
  assert.equal(src.state, 'proposed');
});

test('2.6 the lazy pick for a person with projects and no main one: Bench-confirmed only, most people, then newest (B2, final fix I2)', dbTest, async () => {
  const id = await person();
  const k = (s: string) => `p${RUN}/${s}`;
  for (const [key, confirmed, people, days] of [[k('old'), true, 3, 9], [k('busy'), true, 40, 30], [k('mine'), false, 99, 1]] as const)
  {
    await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people, last_active_at)
      VALUES (${id}, ${key}, ${key}, 'app', ${confirmed}, true, ${people}, now() - ${`${days} days`}::interval)`;
    // Final fix I2: only a project the Bench counts as confirmed (the repo's own proof) is picked.
    if (confirmed) await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent')`;
  }
  assert.equal(await pickMainProject(id, sql()), k('busy'));
  assert.equal(await mainProjectOf(id), k('busy'), 'stored once');
  await sql()`UPDATE builder_projects SET people = 500 WHERE builder_id = ${id} AND project_key = ${k('old')}`;
  assert.equal(await pickMainProject(id, sql()), k('busy'), 'never moves on its own');
});

test('2.9 the fast confirming mode lasts an hour after the line was issued: then the normal cadence and no discovery bypass (fix round 1)', dbTest, async () => {
  const now = new Date();
  // A reader that records every read discovery makes (each one fails, as offline).
  const touched: string[] = [];
  const reader = new Proxy({}, {
    get: (_t, k) => (k === 'now' ? now : k === 'ghSpent' ? () => false : async () => { touched.push(String(k)); throw new Error('offline'); }),
  }) as ReaderDeps;
  const at = async (ago: number) => {
    const id = await person();
    const key = `late${RUN}/p${id}`;
    await setMainProject(id, { name: 'P', what: null, repo: key, live_url: null, package: null, contracts: [] });
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'agent')`;
    await sql()`INSERT INTO proof_line_issues (installation_id, repo_key, first_at) VALUES (${id}, ${key}, ${new Date(now.getTime() - ago)})`;
    // Discovery ran just now, so only the fast mode reruns it inside a refresh.
    await sql()`INSERT INTO discovery_queue (builder_id, reason, done_at) VALUES (${id}, 'first_find', now())`;
    touched.length = 0;
    await refreshDiscovery(id, now, { deadline: Date.now() + 10_000, reader }).catch(() => {});
    return { id, fast: await confirmingFast(id, now), read: touched.length > 0 };
  };
  const old = await at(2 * 3_600_000);
  assert.equal(await confirming(old.id), true, 'still Confirming');
  assert.deepEqual({ fast: old.fast, read: old.read }, { fast: false, read: false }, 'normal cadence, the daily discovery gate holds');
  const fresh = await at(5 * 60_000);
  assert.deepEqual({ fast: fresh.fast, read: fresh.read }, { fast: true, read: true }, 'every refresh checks, within the hour');
});

test('2.10 the fast proof check: over the 4 s floor it runs; under it, it hands the line back to the cron (fix round 1)', dbTest, async () => {
  const now = new Date();
  const reader = new Proxy({}, { get: (_t, k) => (k === 'now' ? now : k === 'ghSpent' ? () => false : async () => []) }) as ReaderDeps;
  const queued = async (left: number) => {
    const id = await person();
    const key = `short${RUN}/p${id}`;
    await setMainProject(id, { name: 'P', what: null, repo: key, live_url: null, package: null, contracts: [] });
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'agent')`;
    await sql()`INSERT INTO proof_line_issues (installation_id, repo_key, first_at) VALUES (${id}, ${key}, ${now})`;
    await refreshDiscovery(id, now, { deadline: Date.now() + left, reader }).catch(() => {});
    const [q] = await sql()<{ reason: string; done_at: Date | null }[]>`SELECT reason, done_at FROM discovery_queue WHERE builder_id = ${id}`;
    return q && { reason: q.reason, done: q.done_at !== null };
  };
  // 8 s left (under the cron's 15 s, over 4 s): the line is checked here; discovery is done.
  assert.deepEqual(await queued(8_000), { reason: 'first_find', done: true });
  // Under MAIN_PROOF_MIN_MS left: skipped, and the queue row waits for the cron.
  assert.deepEqual(await queued(MAIN_PROOF_MIN_MS - 1_000), { reason: 'proof_line', done: false });
});
