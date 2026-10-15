import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { benchProject, noteIdentity, projectKeyOf } from './identity-input';
import { MAIN_PROOF_MIN_MS, PROOF_NOTE, confirming, fillGithubUser, mainProjectOf, pickMainProject, proofFor, setMainProject } from './main-project';
import { proofLineCheck } from './discovery';
import type { ReaderDeps } from './source-readers';
import { tools } from './tools';

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

test('2.2 the project is set once: a later, different project never replaces it (R1)', dbTest, async () => {
  const id = await person();
  const a = await setMainProject(id, { name: 'A', what: null, repo: `maya${RUN}/a`, live_url: null, package: null, contracts: [] });
  assert.deepEqual(a, { key: `maya${RUN}/a`, set: true });
  const b = await setMainProject(id, { name: 'B', what: null, repo: `maya${RUN}/b`, live_url: null, package: null, contracts: [] });
  assert.deepEqual(b, { key: `maya${RUN}/a`, set: false });
  assert.equal(await mainProjectOf(id), `maya${RUN}/a`);
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
  const r = (await tools.find({ identity }, ctx)) as { proof?: { file?: string; line?: string; agent_note: string } };
  assert.equal(await mainProjectOf(id), `maya${RUN}/a`);
  const rows = await sql()<{ ref: string; state: string }[]>`SELECT ref, state FROM builder_sources WHERE builder_id = ${id} ORDER BY ref`;
  assert.deepEqual(rows.map((x) => x.ref), ['https://a.example.com', `maya${RUN}/a`]);
  assert.ok(rows.every((x) => x.state === 'proposed'), 'an agent report never confirms');
  assert.equal(r.proof?.file, 'earnkit.txt');
  assert.match(r.proof?.line ?? '', /^token: [0-9a-f]{10,}$/);
  assert.equal(r.proof?.agent_note, PROOF_NOTE);
  assert.equal((await sql()`SELECT github_user FROM installations WHERE id = ${id}`)[0].github_user, `maya${RUN}`);
  // A different project sent later never replaces the one project (review focus 3).
  await tools.find({ identity: { github_login: `maya${RUN}`, project: { name: 'C', repo: `maya${RUN}/c` } } }, ctx);
  assert.equal(await mainProjectOf(id), `maya${RUN}/a`);
});

test('2.4 the proof line: issued for an unconfirmed repo, recorded, github_user filled with the owner; none once confirmed', dbTest, async () => {
  const id = await person();
  const key = `maya${RUN}/proof`;
  await setMainProject(id, { name: 'P', what: null, repo: key, live_url: null, package: null, contracts: [] });
  await fillGithubUser(id, key, null);
  assert.equal((await sql()`SELECT github_user FROM installations WHERE id = ${id}`)[0].github_user, `maya${RUN}`);
  await fillGithubUser(id, key, 'someone-else');
  assert.equal((await sql()`SELECT github_user FROM installations WHERE id = ${id}`)[0].github_user, `maya${RUN}`, 'never overwritten');
  const p = await proofFor(id, id, { canPush: true, now: new Date() });
  assert.ok(p && 'line' in p);
  assert.match(p.line, /^token: [0-9a-f]{10,}$/);
  assert.equal(p.file, 'earnkit.txt');
  assert.equal(p.agent_note, PROOF_NOTE);
  assert.equal(await confirming(id), true);
  const [issued] = await sql()`SELECT 1 FROM proof_line_issues WHERE installation_id = ${id} AND repo_key = ${key}`;
  assert.ok(issued, 'commits after this moment count (v2.11 R4 b)');
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, ${key}, 'P', 'code', true, false)`;
  assert.equal(await proofFor(id, id, { canPush: true, now: new Date() }), null);
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

test('2.6 the lazy pick for a person with projects and no main one: confirmed, most people, then newest (B2)', dbTest, async () => {
  const id = await person();
  const k = (s: string) => `p${RUN}/${s}`;
  for (const [key, confirmed, people, days] of [[k('old'), true, 3, 9], [k('busy'), true, 40, 30], [k('mine'), false, 99, 1]] as const)
    await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people, last_active_at)
      VALUES (${id}, ${key}, ${key}, 'app', ${confirmed}, true, ${people}, now() - ${`${days} days`}::interval)`;
  assert.equal(await pickMainProject(id, sql()), k('busy'));
  assert.equal(await mainProjectOf(id), k('busy'), 'stored once');
  await sql()`UPDATE builder_projects SET people = 500 WHERE builder_id = ${id} AND project_key = ${k('old')}`;
  assert.equal(await pickMainProject(id, sql()), k('busy'), 'never moves on its own');
});
