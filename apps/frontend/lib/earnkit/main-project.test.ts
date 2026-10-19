import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { benchProject, noteIdentity, projectKeyOf } from './identity-input';
import { fillGithubUser, mainProjectOf, pickMainProject, setMainProject } from './main-project';
import type { ReaderDeps } from './source-readers';
import { tools } from './tools';

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
// the first is the one project, only its sources are proposed, never verified; v2.14: no proof branch or line.
test('2.3 find records the one project: its sources only, proposed, and no proof step in the reply', dbTest, async () => {
  const id = await person();
  // Every read fails (offline); the GitHub budget is never spent. No program matching leaves the process.
  const offline = new Proxy({}, { get: (_t, k) => (k === 'now' ? new Date() : k === 'ghSpent' ? () => false : async () => { throw new Error('offline'); }) }) as ReaderDeps;
  const ctx = { installationId: id, readerDeps: offline, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) } as never;
  const identity = { github_login: `maya${RUN}`, projects: [{ name: 'A', repo: `maya${RUN}/a`, live_url: 'https://a.example.com' }, { name: 'B', repo: `maya${RUN}/b` }] };
  const r = (await tools.find({ identity }, ctx)) as { proof?: unknown; remove_branch?: unknown };
  assert.equal(await mainProjectOf(id), `maya${RUN}/a`);
  const rows = await sql()<{ ref: string; state: string }[]>`SELECT ref, state FROM builder_sources WHERE builder_id = ${id} ORDER BY ref`;
  assert.deepEqual(rows.map((x) => x.ref), ['https://a.example.com', `maya${RUN}/a`]);
  assert.ok(rows.every((x) => x.state === 'proposed'), 'an agent report never confirms');
  // v2.14 spec 2: the read-only App is the only proof: no branch, line or file for the agent.
  assert.equal(r.proof, undefined);
  assert.equal(r.remove_branch, undefined);
  assert.equal((await sql()`SELECT github_user FROM installations WHERE id = ${id}`)[0].github_user, `maya${RUN}`);
  // v2.13.1 O2 (B6): a different project sent later replaces the one project while it isn't confirmed.
  await tools.find({ identity: { github_login: `maya${RUN}`, project: { name: 'C', repo: `maya${RUN}/c` } } }, ctx);
  assert.equal(await mainProjectOf(id), `maya${RUN}/c`);
  const later = await sql()<{ ref: string }[]>`SELECT ref FROM builder_sources WHERE builder_id = ${id} ORDER BY ref`;
  assert.ok(later.some((x) => x.ref === `maya${RUN}/c`), 'the new one project is proposed');
});

test('2.4 github_user is filled with the repo owner, never overwritten', dbTest, async () => {
  const id = await person();
  const key = `maya${RUN}/proof`;
  await setMainProject(id, { name: 'P', what: null, repo: key, live_url: null, package: null, contracts: [] });
  await fillGithubUser(id, key, null);
  assert.equal((await sql()`SELECT github_user FROM installations WHERE id = ${id}`)[0].github_user, `maya${RUN}`);
  await fillGithubUser(id, key, 'someone-else');
  assert.equal((await sql()`SELECT github_user FROM installations WHERE id = ${id}`)[0].github_user, `maya${RUN}`, 'never overwritten');
});

test('2.5 a repo the agent does not own stays proposed; github_user is never set to someone else (B3)', dbTest, async () => {
  const id = await person();
  const key = `notmaya${RUN}/stolen`;
  await setMainProject(id, { name: 'S', what: null, repo: key, live_url: null, package: null, contracts: [] });
  await noteIdentity(id, { github_login: `maya${RUN}`, projects: [{ name: 'S', what: null, repo: key, live_url: null, package: null, contracts: [] }], wallets: [] }, new Date());
  await fillGithubUser(id, key, `maya${RUN}`);
  // github_login reported as maya; the repo's owner is notmaya: github_user is not set to either (B3).
  assert.equal((await sql()`SELECT github_user FROM installations WHERE id = ${id}`)[0].github_user, null);
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




