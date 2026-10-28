import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { sql } from './db';
import { walletOffered } from './fixtures/wallet-step';
import { tools, listProgramsInput } from './tools';
import { bindX } from './x-install';
import { TESTED_STARTERS } from './fixtures/fresh-build';
import { X_ON, avalanche, claimX as claimFx, dropAvalanche, dropPrograms, find, fitsFor, install, person, withEnv } from './fixtures/find';
import * as React from 'react';
import { bannedInBench } from './fixtures/banned-words';
import { HERO_SUB, STEPS } from './site-copy';
import { fakeGitHub } from './fixtures/fake-github-branch';
import { INTRO_LINE, SHIP_ASK, STATE_COPY, applyAsk, pickRepoAsk, stateAsk } from './bench-reply';
import { INSTALL_APP_NOTE, START_NOTE, START_YES_NOTE } from './bench-find';
import { ownLinks, postUpdate } from './updates';
import { proveByApp } from './repo-proof';
import { appTokenFor } from './github-app';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { committedProgram } from './fixtures/program-file';
import { benchProject, benchIdentity, identityInput } from './identity-input';
import { localGitInput } from './discovery';
import { readSources } from './sources';
import { readPersonLive } from './person-score';
import { safeNames } from './page-data';
import { FIND_DESCRIPTION_BENCH, TELL_DESCRIPTION_BENCH, toolDescriptions } from './mcp';
import type { ReaderDeps } from './source-readers';
import { padPool } from './fixtures/rank-pool';

/**
 * v2.13.3, the owner's own production test (2026-10-17), all on the Bench: (1) the older find
 * fields (github_user, repos, local remotes, a live link) fill the Bench's identity instead of being
 * dropped; (2) "Ways to get funded" always shows; (3) the no-project reply leads with existing work;
 * (4) the claim link reads as a line; (5) private and org repos through the read-only GitHub App.
 */

(globalThis as { React?: typeof React }).React = React; // the components' JSX under tsx
process.env.EARNKIT_AUTH_SECRET ||= 'v2133-secret';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropAvalanche();
  await sql().end();
});

const RUN = randomBytes(3).toString('hex');
let seq = 0;
const uniq = (p: string) => `${p}${RUN}${++seq}`;
const ON = { EARNKIT_URL: undefined, ...X_ON };
const on = <T>(fn: () => Promise<T>) => withEnv(ON, fn);
const NO_MATCH = { matchProjects: async () => ({ checked: 1, scored: 0, fits: [] }) };
const links = (t: string) => (t.match(/https?:\/\/\S+/g) ?? []).map((l) => l.replace(/[.,]$/, ''));
const questions = (t: string) => (t.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const STARTER_ID = `v2133-tip-${RUN}`;
const OWN_FRESH = { deployOn: () => true, hostOn: true, canBuild: true, starters: { [STARTER_ID]: { ...TESTED_STARTERS['arc-tipjar'], id: STARTER_ID } } };
const profile = async (id: number) =>
  (await sql()<{ identity: { github_login?: string | null; projects?: { name: string; repo: string | null; live_url: string | null }[] }; reported: string | null; main: string | null }[]>`
    SELECT identity, reported_github AS reported, main_project_key AS main FROM builder_profiles WHERE builder_id = ${id}`)[0];
const claimX = async (id: number) => {
  const r = await bindX(id, { id: `v2133${randomBytes(6).toString('hex')}`, username: uniq('maya').slice(0, 15), name: 'Maya', avatar: null }, new Date());
  assert.equal(r.ok, true);
};

// ---- 1. The older find fields fill the Bench's identity ------------------------------------------

test('1.1 pure: github_user, the first repo (else local remotes) and a live link fill identity when it does not carry them', () =>
  on(async () => {
    const raw = { github_user: 'Jenil04', repos: ['earnkitai/earnkit'], local_repos: [{ name: 'earnkit', url: 'https://github.com/earnkitai/earnkit', live_url: 'https://earnkit.com' }] };
    const i = listProgramsInput(raw);
    assert.equal(i.identity.github_login, 'jenil04');
    assert.deepEqual(i.project, { name: 'earnkit', what: null, repo: 'earnkitai/earnkit', live_url: 'https://earnkit.com', package: null, contracts: [] });
    // Local remotes only (local_git), with its live link.
    const g = listProgramsInput({ local_git: { remotes: ['git@github.com:maya/recipes.git'], live_urls: ['https://recipes.app'] } });
    assert.equal(g.project?.repo, 'maya/recipes');
    assert.equal(g.project?.live_url, 'https://recipes.app');
    // local_repos' url when no repos.
    assert.equal(listProgramsInput({ local_repos: [{ name: 'tipjar', url: 'https://github.com/lee/tipjar' }] }).project?.repo, 'lee/tipjar');
    // identity.project wins; its missing live link is filled only from the same repo.
    const both = listProgramsInput({ github_user: 'other', repos: ['maya/recipes'], local_repos: [{ name: 'r', url: 'https://github.com/maya/recipes', live_url: 'https://recipes.app' }],
      identity: { github_login: 'maya', project: { name: 'Recipe planner', repo: 'maya/recipes' } } });
    assert.equal(both.identity.github_login, 'maya');
    assert.deepEqual(both.project, { name: 'Recipe planner', what: null, repo: 'maya/recipes', live_url: 'https://recipes.app', package: null, contracts: [] });
    const other = listProgramsInput({ repos: ['lee/tipjar'], identity: { project: { name: 'Recipe planner', repo: 'maya/recipes' } } });
    assert.equal(other.project?.repo, 'maya/recipes');
    assert.equal(other.project?.live_url, null);
    // The pure mapping itself (benchIdentity), unchanged when there is nothing to fill.
    const plain = identityInput({}, localGitInput(undefined));
    assert.deepEqual(benchIdentity({ identity: plain, project: benchProject({}), local_git: localGitInput(undefined) }), { identity: plain, project: null });
  }));

test('1.3 the tester\'s shape (github_user + repos + a live link): identity and reported_github are stored, the repo is the one project, not counted until the App proves it', dbTest, () =>
  on(async () => {
    const login = uniq('jenil');
    const key = `${uniq('earnkitai')}/earnkit`;
    const id = await install();
    const r = await find(id, {
      agent_can_build: true, github_user: login, repos: [key],
      local_repos: [{ name: 'earnkit', url: `https://github.com/${key}`, live_url: 'https://earnkit.com' }],
    }, NO_MATCH);
    const p = await profile(id);
    assert.equal(p.reported, login.toLowerCase());
    assert.equal(p.main, key);
    assert.equal(p.identity.github_login, login.toLowerCase());
    assert.deepEqual(p.identity.projects?.map((x) => [x.repo, x.live_url]), [[key, 'https://earnkit.com']]);
    const sources = await sql()<{ kind: string; ref: string }[]>`SELECT kind, ref FROM builder_sources WHERE builder_id = ${id} ORDER BY kind`;
    assert.deepEqual(sources.map((s) => `${s.kind}:${s.ref}`), [`repo:${key}`, 'site:https://earnkit.com']);
    // v2.14 spec 2: not counted until the read-only App is installed (no proof branch).
    // v2.14 T9: unsigned: not on the Bench yet (the sign-in link is the question).
    assert.equal(r.show_to_builder.split('\n')[0], INTRO_LINE, r.show_to_builder);
    assert.equal(r.proof, undefined);
    const [s] = await sql()<{ state: string }[]>`SELECT state FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo'`;
    assert.equal(s.state, 'proposed');
  }));

test('1.4 the Bench find description asks for identity.project and identity.github_login, not the older fields (still accepted)', () =>
  on(async () => {
    assert.match(FIND_DESCRIPTION_BENCH, /identity\.project/);
    assert.match(FIND_DESCRIPTION_BENCH, /identity\.github_login/);
    assert.match(FIND_DESCRIPTION_BENCH, /not github_user or repos/);
    assert.ok(FIND_DESCRIPTION_BENCH.length < 800, String(FIND_DESCRIPTION_BENCH.length));
    assert.equal(toolDescriptions(false).find, FIND_DESCRIPTION_BENCH);
  }));

// ---- 2. (Task 16: no "Ways to get funded" list; a fit is named only for a counted project) -----------

test('2.2 no project and a project not yet confirmed: never a fit claimed', dbTest, () =>
  on(async () => {
    await avalanche();
    const id = await install();
    const r = await find(id, { agent_can_build: false }, NO_MATCH);
    assert.doesNotMatch(r.show_to_builder, /You qualify|Ways to get funded/, r.show_to_builder);
    // A project being checked (not confirmed): the same.
    const key = `${uniq('maya')}/recipes`;
    const m = await install();
    const rm = await find(m, { agent_can_build: true, identity: { github_login: key.split('/')[0], project: { name: 'Recipe planner', repo: key } } }, NO_MATCH);
    assert.doesNotMatch(rm.show_to_builder, /You qualify|Ways to get funded/, rm.show_to_builder);
    // v2.14 T9: unsigned: the sign-in link is the one link (no App link before a page exists).
    assert.equal(links(rm.show_to_builder).length, 1, rm.show_to_builder);
    assert.match(links(rm.show_to_builder)[0], /\/signin\//);
  }));

// ---- 3. No project: lead with existing work ------------------------------------------------------

test('3.1 no project (ruling A): "You\'re in" and their work asked for; never a build (v2.14 A18)', dbTest, () =>
  on(async () => {
    // v2.14 spec 4 (no_project): one question, last.
    assert.equal(STATE_COPY.no_project.noApp(), "What's your GitHub, or a link to something you've made?");
    // No program with a starter that can compete open: the line, no build offer, money shown.
    const id = await install();
    await claimFx(id); // v2.13.4: unclaimed, X is the one ask; this is what follows it
    const r = await find(id, { agent_can_build: true }, { ...NO_MATCH, freshDeps: OWN_FRESH });
    const lines = r.show_to_builder.split('\n');
    assert.match(lines[0], /^You're in, @/, r.show_to_builder);
    assert.equal(lines.at(-1), STATE_COPY.no_project.noApp());
    assert.equal(questions(r.show_to_builder), 1);
    assert.ok(r.show_to_builder.endsWith('?'));
    assert.doesNotMatch(r.show_to_builder, /tip jar/i);
    assert.equal(r.build_offer, undefined);
    assert.equal(r.move_up?.kind, 'start');
    assert.equal(r.move_up?.agent_note, START_NOTE);
    assert.match(START_NOTE, /identity/);
    const yes = (await tools.tell({ move_up: { kind: 'start', project_key: null, answer: 'yes' } }, { installationId: id } as never)) as { agent_note?: string };
    assert.equal(yes.agent_note, START_YES_NOTE);
    // A chat-only agent: the same line.
    const c = await install();
    await claimFx(c);
    const rc = await find(c, { agent_can_build: false }, NO_MATCH);
    assert.match(rc.show_to_builder.split('\n')[0], /^You're in, @/);
    assert.equal(rc.show_to_builder.split('\n').at(-1), STATE_COPY.no_project.noApp());
    // v2.14 A18: an open program with its own starter changes nothing: no build offered in find.
    const arc = { ...committedProgram('arc-microgrants'), id: `v2133-arc-${RUN}`, status: 'active', ends_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), fresh_build: { starter: STARTER_ID } };
    await upsertProgram(ProgramFile.parse(arc));
    try {
      const b = await install();
      await claimFx(b);
      const rb = await find(b, { agent_can_build: true }, { ...NO_MATCH, freshDeps: OWN_FRESH });
      assert.equal(rb.show_to_builder.split('\n').at(-1), STATE_COPY.no_project.noApp(), rb.show_to_builder);
      assert.equal(questions(rb.show_to_builder), 1, 'one question mark in the whole reply (links stripped)');
      assert.equal(rb.build_offer, undefined);
      assert.equal(rb.move_up?.kind, 'start');
    } finally {
      await dropPrograms([arc.id]);
    }
  }));

// ---- 4. (v2.14 T7: the claim link and the claim ask are gone) ----------------------------------------

test('4.1 (v2.14 T7) an unsigned install with a project: no claim link, no claim ask; at most one link and one question, last', dbTest, () =>
  on(async () => {
    const id = await install();
    const key = `${uniq('maya')}/recipes`;
    const r = await find(id, { agent_can_build: true, identity: { github_login: key.split('/')[0], project: { name: 'Recipe planner', repo: key } } }, NO_MATCH);
    assert.equal((r as { claim?: unknown }).claim, undefined);
    assert.doesNotMatch(r.show_to_builder, /claim/i);
    assert.ok(links(r.show_to_builder).length <= 1);
    assert.equal(questions(r.show_to_builder), 1);
    assert.ok(r.show_to_builder.endsWith('Done with step 1?'), r.show_to_builder);
  }));

// ---- 5. Private and org repos through the read-only GitHub App -----------------------------------

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const APP = { GITHUB_OAUTH_CLIENT_ID: 'v2133-client', GITHUB_OAUTH_CLIENT_SECRET: 'v2133-secret', GITHUB_APP_ID: '424242', GITHUB_APP_SLUG: 'earnkit-read', GITHUB_APP_PRIVATE_KEY: privateKey };
const TOKEN = `ghs_v2133_${RUN}_secret`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * GitHub where `key` is a private org repo: EarnKit's own token gets 404 for it (REST and GraphQL); the
 * installation token (minted for installation 77) reads it. Everything else is fakeGitHub's.
 */
function privateGitHub(key: string) {
  const base = fakeGitHub();
  const org = key.split('/')[0];
  base.repos[key] = { owner: { login: org, type: 'Organization' }, private: true } as never;
  const minted: unknown[] = [];
  const week = new Date(Date.now() - 86_400_000).toISOString();
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get('authorization');
    if (url.pathname === '/app/installations/77/access_tokens' && init?.method === 'POST') {
      minted.push(JSON.parse(String(init.body)));
      return json(201, { token: TOKEN });
    }
    // v2.13.3 review M4: the installation GitHub names for the repo (asked with the App's JWT).
    if (url.pathname.toLowerCase() === `/repos/${key}/installation`) return json(200, { id: 77 });
    const mine = auth === `Bearer ${TOKEN}`;
    if (url.pathname === '/graphql')
      return mine
        ? json(200, { data: { r0: {
            nameWithOwner: key, isPrivate: true, isFork: false, isTemplate: false, owner: { __typename: 'Organization', login: org },
            stargazers: { edges: [] }, forks: { nodes: [] }, stargazerCount: 0, forkCount: 0, defaultBranchRef: { target: { history: { nodes: [{ committedDate: week }] } } },
          } } })
        : json(200, { data: { r0: null }, errors: [{ type: 'NOT_FOUND' }] });
    if (url.pathname.toLowerCase().startsWith(`/repos/${key}`)) {
      if (!mine) return json(404, { message: 'Not Found' });
      if (url.pathname.endsWith('/contributors')) return json(200, [{ login: 'jenil' }]);
    }
    return base.f(input, init);
  }) as typeof fetch;
  return { ...base, f, minted };
}
/** The builder installed the App (installation 77) on `key`, proven through the setup URL (a `via = 'app'` row). */
const installApp = (id: number, key: string, login: string) => sql()`
  INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose, via, github_installation_id)
  VALUES (${key}, ${login}, ${id}, now() - interval '2 years', 3, 'app', 'app', 77)`;
const named = (key: string, login: string, name = key.split('/')[1]) => ({ agent_can_build: true, identity: { github_login: login, project: { name, repo: key } } });
/** A reader whose GraphQL is EarnKit's own (the private repo is not found) and whose REST goes to `f`. */
const reader = (f: typeof fetch): ReaderDeps => {
  const no = async (): Promise<never> => {
    throw new Error('unexpected read');
  };
  return {
    gh: no, ghGraphql: async <T,>() => ({ data: { r0: null } }) as T, probe: no, fetchText: no, json: no, contractOrigin: no,
    walletCreations: no, now: new Date(), ghFetch: f,
  };
};

test('5.1 v2.14, App off: a repo is not counted yet, with no install link and no proof step', dbTest, () =>
  on(async () => {
    const key = `${uniq('earnkitai')}/secret`;
    const id = await install();
    await claimFx(id);
    const r = await find(id, named(key, uniq('jenil')), NO_MATCH);
    // v3.1 cold read: never "<Project> isn't counted yet.": the reply is the step alone.
    assert.equal(STATE_COPY.not_counted.stand('Secret'), null);
    assert.equal(r.show_to_builder.split('\n')[0], 'Want me to suggest one small thing to ship in Secret this week?', r.show_to_builder);
    // v2.14 A15: the App off: one small thing to ship, no install link.
    assert.equal(r.move_up?.kind, 'suggest');
    assert.equal(r.proof, undefined);
    assert.doesNotMatch(r.show_to_builder, /github\/verify|Install EarnKit/);
  }));

test('5.2 App on, a private org repo: unclaimed, no App link (v2.14 T7: no claim ask); claimed, the one install link; installed, the setup URL proves it with the installation token and the project confirms and ranks; readings work; no token kept or logged', dbTest, () =>
  withEnv({ ...ON, ...APP }, async () => {
    // v3.1 F3: the pool reaches RANK_MIN_POOL, so a rank shows.
    await padPool(9);
    const logged: string[] = [];
    const was = { error: console.error, log: console.log, warn: console.warn };
    const spy = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
    console.error = spy;
    console.log = spy;
    console.warn = spy;
    try {
      const login = uniq('jenil').toLowerCase();
      const key = `${uniq('earnkitai')}/earnkit`;
      const gh = privateGitHub(key);
      const id = await install();
      // Unclaimed: no App link yet (S7: it names the page); v2.14 T9: the sign-in link is the one link and question.
      const r1 = await find(id, named(key, login), NO_MATCH);
      assert.equal(r1.show_to_builder.split('\n')[0], INTRO_LINE, r1.show_to_builder);
      assert.equal(links(r1.show_to_builder).length, 1, r1.show_to_builder);
      assert.match(links(r1.show_to_builder)[0], /\/signin\//);
      assert.equal(r1.move_up?.kind, 'sign_in');
      assert.equal(questions(r1.show_to_builder), 1);
      assert.ok(r1.show_to_builder.endsWith('Done with step 1?'));
      assert.notEqual(r1.move_up?.kind, 'install_app');
      assert.equal(r1.proof, undefined);
      // Claimed: the install link is the one link (v2.13.4: the page named without https), the question last.
      await claimX(id);
      const r2 = await find(id, {}, NO_MATCH);
      const ls = links(r2.show_to_builder);
      assert.equal(ls.length, 1, r2.show_to_builder);
      assert.match(ls[0], /^https:\/\/earnkit\.com\/github\/verify\?n=/);
      assert.ok(r2.show_to_builder.endsWith(`${STATE_COPY.not_counted.ask(ls[0], false)}`), r2.show_to_builder);
      assert.match(r2.show_to_builder, /^You're in, @/);
      assert.equal(r2.move_up?.kind, 'install_app');
      assert.equal(r2.move_up?.agent_note, INSTALL_APP_NOTE);
      assert.equal(questions(r2.show_to_builder), 1);
      assert.ok(r2.show_to_builder.endsWith('Done?'), '2026-10-22: the question last, no points line');
      assert.equal(r2.proof, undefined, 'no branch before the App can read the repo');
      // Installed: the setup URL (appSetup's last step) reads the repo with the per-call token and proves it.
      await installApp(id, key, login);
      assert.equal((await proveByApp({ builderId: id, repoKey: key, githubInstallationId: 77 }, { fetch: gh.f })).ok, true);
      assert.ok(gh.minted.length > 0, 'a token was minted');
      assert.deepEqual(gh.minted[0], { repositories: ['earnkit'], permissions: { contents: 'read', metadata: 'read' } });
      const [s] = await sql()<{ state: string; proof: string }[]>`SELECT state, proof FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo' AND lower(ref) = ${key}`;
      assert.deepEqual({ ...s }, { state: 'verified', proof: 'github_app' });
      // v4.0: setup step 3 answered (this test is about another reply).
      await walletOffered(id);
      const r3 = await find(id, {}, NO_MATCH);
      assert.match(r3.show_to_builder, /^Earnkit (is on the leaderboard: |· )(#\d+ of \d+ builders?|Top [\d.]+% of builders)/m, r3.show_to_builder);
      const [live] = await sql()<{ ranked: boolean }[]>`SELECT ranked FROM builder_live WHERE builder_id = ${id}`;
      assert.equal(live?.ranked, true, 'the project ranks');
      // Readings: the daily read and the live refresh read the private repo with the installation token.
      const before = gh.minted.length;
      await readSources(new Date(), { deadline: Date.now() + 10_000, reader: reader(gh.f), only: [id] });
      const [reading] = await sql()<{ ok: boolean; signals: { private?: boolean; commit_counts?: Record<string, number>; contributors?: unknown[] } }[]>`
        SELECT r.ok, r.signals FROM source_readings r JOIN builder_sources b ON b.id = r.source_id WHERE b.builder_id = ${id} AND b.kind = 'repo' ORDER BY r.day DESC LIMIT 1`;
      assert.equal(reading?.ok, true, JSON.stringify(reading));
      assert.equal(reading.signals.private, true);
      assert.equal(Object.values(reading.signals.commit_counts ?? {}).reduce((a, b) => a + b, 0), 1);
      assert.deepEqual(reading.signals.contributors, [], 'R16b: no contributors call for an org repo');
      await sql()`DELETE FROM source_live WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id = ${id})`;
      await readPersonLive(id, new Date(), { deadline: Date.now() + 10_000, reader: reader(gh.f) });
      const [lv] = await sql()<{ ok: boolean }[]>`SELECT l.ok FROM source_live l JOIN builder_sources b ON b.id = l.source_id WHERE b.builder_id = ${id} AND b.kind = 'repo'`;
      assert.equal(lv?.ok, true);
      assert.ok(gh.minted.length > before, 'minted per call');
      // I1: the agent's name for it is the repo's own, so pages show the private-safe name.
      assert.equal((await safeNames([id]))(id, key), 'Private project');
      // Never stored or logged.
      assert.ok(!logged.some((l) => l.includes(TOKEN)), 'never logged');
      const [kept] = await sql()<{ n: number }[]>`
        SELECT ((SELECT count(*) FROM source_readings r JOIN builder_sources b ON b.id = r.source_id WHERE b.builder_id = ${id} AND r.signals::text LIKE ${`%${TOKEN}%`})
          + (SELECT count(*) FROM source_live l JOIN builder_sources b ON b.id = l.source_id WHERE b.builder_id = ${id} AND l.signals::text LIKE ${`%${TOKEN}%`})
          + (SELECT count(*) FROM builder_profiles WHERE builder_id = ${id} AND (standing_seen::text LIKE ${`%${TOKEN}%`} OR identity::text LIKE ${`%${TOKEN}%`})))::int AS n`;
      assert.equal(kept.n, 0, 'never stored');
    } finally {
      Object.assign(console, was);
    }
  }));

test('5.3 App on, but the proof is another person\'s: their installation never reads this person\'s repo', dbTest, () =>
  withEnv({ ...ON, ...APP }, async () => {
    const login = uniq('jenil').toLowerCase();
    const key = `${uniq('earnkitai')}/earnkit`;
    const gh = privateGitHub(key);
    const other = await install();
    await installApp(other, key, login);
    const id = await install();
    await find(id, named(key, login), NO_MATCH);
    await claimX(id);
    const r = await find(id, {}, NO_MATCH);
    assert.equal(r.proof, undefined, r.show_to_builder);
    assert.equal(gh.minted.length, 0, 'no token for a proof that is not this person\'s');
    assert.equal(r.move_up?.kind, 'install_app');
    assert.ok(r.show_to_builder.endsWith(`${pickRepoAsk(links(r.show_to_builder)[0], false)}`), r.show_to_builder);
  }));

// ---- Owner rulings A and B (2026-10-17) ----------------------------------------------------------

test('A.1 pure (R8 supersedes owner ruling A): a ranked project moves up by shipping, never an entry or a community round; one that can\'t join asks for another project', () => {
  const p = { key: 'maya/recipes', name: 'Recipe planner', confirmed: true, live: false, weeks: 0 };
  assert.deepEqual(stateAsk({ state: 'ranked', variant: null, project: p, link: null }), { kind: 'ship', project_key: p.key, line: SHIP_ASK });
  // v4.0 Task 11: no backing offer; the drafted application is the ranked ask.
  const apply = { program_id: 'base-builder-grants', title: 'Base Builder Grant Program', amount: '$5,000', when: null };
  assert.equal(stateAsk({ state: 'ranked', variant: null, project: p, link: null, apply }).kind, 'apply');
  // A project that can't join (v2.14: not counted, taken) asks for a different project, never an entry.
  assert.equal(stateAsk({ state: 'not_counted', variant: 'taken', project: { ...p, confirmed: false }, link: null }).kind, 'other_project');
});

test('A.2 through find (R8, R12, v3.1 spec 3.2): a project with a fit is offered the draft once (Task 16 step 5), then the step is to ship with the fit named', dbTest, () =>
  on(async () => {
    const prog = await avalanche();
    const key = `${uniq('maya')}/recipes`;
    const id = await person({ main: key, claimed: uniq('mf').slice(0, 15), ranked: true, score: 60, projects: [{ key, name: 'Recipe planner', confirmed: true, weeks_shipping: 2 }] });
    const r = await find(id, {}, { matchProjects: async () => ({ checked: 1, scored: 1, fits: fitsFor(prog.id, key) }) });
    // v3.1 spec 3.2: the rolling fit is first offered as a draft (once a program); then the step is to ship.
    assert.ok(r.show_to_builder.endsWith(applyAsk(prog.title, '$10,000', null)), r.show_to_builder);
    assert.equal(r.move_up?.kind, 'apply');
    const next = await find(id, {}, { matchProjects: async () => ({ checked: 1, scored: 1, fits: fitsFor(prog.id, key) }) });
    // v3.1 cold read: the unchanged standing isn't repeated and the points line was this week's already.
    assert.ok(next.show_to_builder.includes(`You qualify for the ${prog.title}, up to $10,000.\n${SHIP_ASK}`), next.show_to_builder);
    assert.equal(next.move_up?.kind, 'ship');
  }));

test('B.1 never a community round, raise or raising, in builder text; the banned-word check under the Bench catches them', () => {
  for (const s of [HERO_SUB, STEPS[2].text, TELL_DESCRIPTION_BENCH])
    assert.deepEqual(bannedInBench(s, ['Recipe planner']).filter((w) => /rais/.test(w)), [], s);
  assert.notDeepEqual(bannedInBench('Want to raise for it?', []), []);
  assert.notDeepEqual(bannedInBench('Raising $X', []), []);
  assert.notDeepEqual(bannedInBench('Start a fundraise', []), []);
  assert.notDeepEqual(bannedInBench('Open a community round', []), []);
});

// ---- Review fix round (v2.13.3) -----------------------------------------------------------------

/** A claimed person whose one project is a confirmed repo (proof_line), with no reading yet. */
const confirmedRepo = async (key: string) => {
  const id = await person({ main: key, claimed: uniq('rf').slice(0, 15), projects: [{ key, name: key.split('/')[1], confirmed: true }] });
  await sql()`UPDATE builder_sources SET gh_owner_type = 'Organization' WHERE builder_id = ${id} AND kind = 'repo'`;
  return id;
};
const markPublic = (id: number) => sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${id} AND kind = 'repo'`;

test('R1 (I1) the ship log links the repo only while it was read public in the last week', dbTest, () =>
  on(async () => {
    // v2.13.4: a key with no run of digits (a random hex RUN plus the counter could make 7 in a row, which
    // the update text rule refuses before the link rule this test is about).
    const key = `earnkitai-${randomBytes(4).toString('hex').replace(/[0-9]/g, 'x')}/secret`;
    const id = await confirmedRepo(key);
    assert.equal((await ownLinks(id)).repo, null, 'a repo never read public: no link');
    const r = await postUpdate(id, `Shipped the import. https://github.com/${key}`, new Date());
    assert.match(String(r.agent_note), /link/i, JSON.stringify(r));
    await markPublic(id);
    assert.equal((await ownLinks(id)).repo, key);
    // A public reading that says private, newer than the cheap read: no link again.
    const [s] = await sql()<{ id: number }[]>`SELECT id::int FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo'`;
    await sql()`INSERT INTO source_live (source_id, signals, ok, read_at) VALUES (${s.id}, '{"private": true}'::jsonb, true, now() + interval '1 second')`;
    assert.equal((await ownLinks(id)).repo, null);
  }));

test('R4 (M1) a slow App token mint never holds the reply: find answers in time and the install ask stands', dbTest, () =>
  withEnv({ ...ON, ...APP }, async () => {
    const key = `${uniq('earnkitai')}/slow`;
    const id = await install();
    await find(id, named(key, uniq('jenil')), NO_MATCH);
    await installApp(id, key, uniq('jenil').toLowerCase());
    const t0 = Date.now();
    const r = await find(id, {}, NO_MATCH);
    const ms = Date.now() - t0;
    assert.ok(ms < 3000, `find took ${ms} ms`);
    // Unsigned (v2.14 T9): not on the Bench yet; the reply came in time.
    assert.equal(r.show_to_builder.split('\n')[0], INTRO_LINE, r.show_to_builder);
    assert.equal(r.proof, undefined);
  }));

test('R6 (M4) the token is minted for the installation GitHub names for the repo (the stored id is a hint); none when GitHub lists no installation', dbTest, () =>
  withEnv({ ...ON, ...APP }, async () => {
    const key = `${uniq('earnkitai')}/moved`;
    const id = await install();
    await installApp(id, key, 'jenil');
    const minted: string[] = [];
    const fake = (answer: number | null) => (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === `/repos/${key}/installation`) return answer === null ? json(404, { message: 'Not Found' }) : json(200, { id: answer });
      const m = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path);
      if (m && init?.method === 'POST') {
        minted.push(m[1]);
        return json(201, { token: TOKEN });
      }
      return json(404, {});
    }) as typeof fetch;
    assert.equal(await appTokenFor({ installationId: id, repoKey: key }, { fetch: fake(88) }), TOKEN);
    assert.deepEqual(minted, ['88'], 'GitHub\'s installation, not the stored 77');
    assert.equal(await appTokenFor({ installationId: id, repoKey: key }, { fetch: fake(null) }), null, 'fail closed');
    assert.deepEqual(minted, ['88']);
  }));

