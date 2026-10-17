import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { sql } from './db';
import { tools, listProgramsInput } from './tools';
import { bindX } from './claim';
import { TESTED_STARTERS } from './fixtures/fresh-build';
import { X_ON, avalanche, claimX as claimFx, dropAvalanche, dropPrograms, find, fitsFor, install, person, withEnv } from './fixtures/find';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { raiseLine } from './coin-moments';
import { RAISE_LINES, showRaisingLine } from './raising';
import { bannedInBench } from './fixtures/banned-words';
import RaisingPill from '../../app/components/ui/RaisingPill';
import { FILTER_RAISING } from '../../app/bench/FilterChip';
import { BENCH_HERO_SUBTITLE } from '../../app/components/sections/Hero';
import { BENCH_STEPS } from '../../app/components/sections/BenchHowItWorks';
import { fakeGitHub } from './fixtures/fake-github-branch';
import {
  BENCH_HEADS, NO_PROJECT_LINE, OTHER_PROJECT_ASK, START_ASK, privateLine, startBuildAsk, benchReply, cantSeeLine, checkingBranchLine,
  benchStepKey, chooseAsk, claimAsk, claimLine, enterAsk, installAppAsk, needsLine, type BenchView,
} from './bench-reply';
import { INSTALL_APP_NOTE, START_NOTE, START_YES_NOTE, coinAskBench, fundNeeds, needsPicks } from './bench-find';
import { ownLinks, postUpdate } from './updates';
import { coinLine, coinYes } from './coin-moments';
import { coinBranchProof } from './proof-branch';
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
import type { Card } from './present';
import type { ReaderDeps } from './source-readers';

/**
 * v2.13.3, the owner's own production test (2026-10-17), all under EARNKIT_BENCH: (1) the older find
 * fields (github_user, repos, local remotes, a live link) fill the Bench's identity instead of being
 * dropped; (2) "Ways to get funded" always shows; (3) the no-project reply leads with existing work;
 * (4) the claim link reads as a line; (5) private and org repos through the read-only GitHub App.
 */

(globalThis as { React?: typeof React }).React = React; // the components' JSX under tsx
process.env.EARNKIT_BUILDER_SCORE = 'on';
process.env.EARNKIT_BENCH = 'on';
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
const ON = { EARNKIT_BUILDER_SCORE: 'on', EARNKIT_BENCH: 'on', EARNKIT_URL: undefined, ...X_ON };
const on = <T>(fn: () => Promise<T>) => withEnv(ON, fn);
const NO_MATCH = { matchProjects: async () => ({ checked: 1, scored: 0, fits: [] }) };
const links = (t: string) => (t.match(/https?:\/\/\S+/g) ?? []).map((l) => l.replace(/[.,]$/, ''));
const questions = (t: string) => (t.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const STARTER_ID = `v2133-tip-${RUN}`;
const OWN_FRESH = { deployOn: () => true, hostOn: true, canBuild: true, starters: { [STARTER_ID]: { ...TESTED_STARTERS['arc-tipjar'], id: STARTER_ID } } };
const profile = async (id: number) =>
  (await sql()<{ identity: { github_login?: string | null; projects?: { name: string; repo: string | null; live_url: string | null }[] }; reported: string | null; main: string | null }[]>`
    SELECT identity, reported_github AS reported, main_project_key AS main FROM builder_profiles WHERE builder_id = ${id}`)[0];
const again = async (id: number, extra: Record<string, unknown>) => {
  await sql()`UPDATE proof_branches SET checked_at = checked_at - interval '2 minutes' WHERE builder_id = ${id} AND checked_at IS NOT NULL`;
  return find(id, {}, { ...NO_MATCH, ...extra });
};
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

test('1.2 flag off (Bench off): the older fields fill nothing (today\'s)', () =>
  withEnv({ ...ON, EARNKIT_BENCH: undefined }, async () => {
    const i = listProgramsInput({ github_user: 'jenil04', repos: ['earnkitai/earnkit'] });
    assert.equal(i.identity.github_login, null);
    assert.equal(i.project, null);
  }));

test('1.3 the tester\'s shape (github_user + repos + a live link): identity and reported_github are stored, the repo is the one project and the proof flow runs to confirmed', dbTest, () =>
  on(async () => {
    const login = uniq('jenil');
    const key = `${uniq('earnkitai')}/earnkit`;
    const gh = fakeGitHub();
    gh.repos[key] = { owner: { login: key.split('/')[0], type: 'Organization' } };
    const id = await install();
    const r = await find(id, {
      agent_can_build: true, github_user: login, repos: [key],
      local_repos: [{ name: 'earnkit', url: `https://github.com/${key}`, live_url: 'https://earnkit.com' }],
    }, { ...NO_MATCH, proofBranchFetch: gh.f });
    const p = await profile(id);
    assert.equal(p.reported, login.toLowerCase());
    assert.equal(p.main, key);
    assert.equal(p.identity.github_login, login.toLowerCase());
    assert.deepEqual(p.identity.projects?.map((x) => [x.repo, x.live_url]), [[key, 'https://earnkit.com']]);
    const sources = await sql()<{ kind: string; ref: string }[]>`SELECT kind, ref FROM builder_sources WHERE builder_id = ${id} ORDER BY kind`;
    assert.deepEqual(sources.map((s) => `${s.kind}:${s.ref}`), [`repo:${key}`, 'site:https://earnkit.com']);
    assert.equal(r.show_to_builder.split('\n')[1], checkingBranchLine('Earnkit'), r.show_to_builder);
    const branch = (r.proof as { branch: string } | undefined)?.branch;
    assert.ok(branch, 'the proof branch is given');
    gh.push(key, branch!, login.toLowerCase());
    const done = await again(id, { proofBranchFetch: gh.f });
    const [s] = await sql()<{ state: string; proof: string }[]>`SELECT state, proof FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo'`;
    assert.deepEqual({ ...s }, { state: 'verified', proof: 'proof_branch' }, done.show_to_builder);
  }));

test('1.4 the Bench find description asks for identity.project and identity.github_login, not the older fields (still accepted)', () =>
  on(async () => {
    assert.match(FIND_DESCRIPTION_BENCH, /identity\.project/);
    assert.match(FIND_DESCRIPTION_BENCH, /identity\.github_login/);
    assert.match(FIND_DESCRIPTION_BENCH, /not github_user or repos/);
    assert.ok(FIND_DESCRIPTION_BENCH.length < 800, String(FIND_DESCRIPTION_BENCH.length));
    assert.equal(toolDescriptions(false).find, FIND_DESCRIPTION_BENCH);
  }));

// ---- 2. Ways to get funded always shows -----------------------------------------------------------

const card = (o: Partial<Card>): Card => ({ id: 'p', title: 'P', summary: '', tag: null, each_time: [], max_award_usd: 5000, ...o });
test('2.1 pure: what each program needs, in plain words; a chain program names its chain', () => {
  assert.deepEqual(fundNeeds(card({ title: 'Base Builder Grants', chains: ['base'], tag: 'needs a live product', needs_repo: true })),
    { kind: 'needs', title: 'Base Builder Grants', prize: 'up to $5K', needs: "for a Base app, once it's live" });
  assert.deepEqual(fundNeeds(card({ title: 'Avalanche Team1 Mini Grants', chains: ['avalanche'], needs_repo: false, max_award_usd: 10000 })),
    { kind: 'needs', title: 'Avalanche Team1 Mini Grants', prize: 'up to $10K', needs: 'for an Avalanche app' });
  assert.equal(fundNeeds(card({ any_chain: true, tag: 'needs a live product' })).needs, 'once your app is live');
  assert.equal(fundNeeds(card({ any_chain: true, needs_repo: true })).needs, 'once your code is on GitHub');
  assert.equal(fundNeeds(card({ any_chain: true, needs_repo: false })).needs, 'for any app');
  assert.equal(fundNeeds(card({ chains: ['base', 'tempo', 'robinhood'], needs_repo: true })).needs, 'for an app on Base, Tempo or Robinhood Chain, once its code is on GitHub');
  const v: BenchView = { project: null, rank: null, claimed: true, handle: 'm', claimLink: null, ask: null,
    fund: [{ kind: 'needs', title: 'Base Builder Grants', prize: 'up to $5K', needs: "for a Base app, once it's live" }] };
  assert.equal(benchReply(v).split('\n').slice(3, 5).join('\n'), "Ways to get funded\nBase Builder Grants: up to $5K for a Base app, once it's live.");
});

test('2.2 no project and a project not yet confirmed: up to 2 open programs with what each needs, never a fit claimed', dbTest, () =>
  on(async () => {
    await avalanche();
    const id = await install();
    const r = await find(id, { agent_can_build: false }, NO_MATCH);
    const parts = r.show_to_builder.split('\n\n');
    const fund = parts.find((p) => p.startsWith(BENCH_HEADS.fund));
    assert.ok(fund, r.show_to_builder);
    const lines = fund!.split('\n').slice(1);
    assert.ok(lines.length >= 1 && lines.length <= 2, fund);
    for (const l of lines) assert.match(l, /^[^:]+: .+\.$/, l);
    assert.doesNotMatch(fund!, / fits /);
    // A project being checked (not confirmed): the same.
    const key = `${uniq('maya')}/recipes`;
    const gh = fakeGitHub();
    const m = await install();
    const rm = await find(m, { agent_can_build: true, identity: { github_login: key.split('/')[0], project: { name: 'Recipe planner', repo: key } } }, { ...NO_MATCH, proofBranchFetch: gh.f });
    const f2 = rm.show_to_builder.split('\n\n').find((p) => p.startsWith(BENCH_HEADS.fund));
    assert.ok(f2, rm.show_to_builder);
    assert.ok(f2!.split('\n').length - 1 <= 2);
    assert.doesNotMatch(f2!, / fits /);
    assert.equal(links(rm.show_to_builder).length, 1, 'still one link');
  }));

// ---- 3. No project: lead with existing work ------------------------------------------------------

test('3.1 no project (ruling A): "You\'re not on the Bench yet." and existing work first; never the generic tip jar; a build only aimed at a program whose starter competes', dbTest, () =>
  on(async () => {
    assert.equal(NO_PROJECT_LINE, "You're not on the Bench yet.");
    // Coordinator ruling (v2.13.3): one question, last.
    assert.equal(START_ASK, "I'll put your work on the Bench and find money it can win. What's your GitHub, or a link to something you've made?");
    assert.equal(startBuildAsk('a tip jar on Arc', 'Arc Microgrants'),
      "I'll put your work on the Bench and find money it can win. What's your GitHub, a link to something you've made, or should I build a tip jar on Arc for Arc Microgrants?");
    // No program with a starter that can compete open: the line, no build offer, money shown.
    const id = await install();
    await claimFx(id); // v2.13.4: unclaimed, X is the one ask; this is what follows it
    const r = await find(id, { agent_can_build: true }, { ...NO_MATCH, freshDeps: OWN_FRESH });
    const lines = r.show_to_builder.split('\n');
    assert.equal(lines[1], NO_PROJECT_LINE, r.show_to_builder);
    assert.equal(lines.at(-1), START_ASK);
    assert.equal(questions(r.show_to_builder), 1);
    assert.ok(r.show_to_builder.endsWith('?'));
    assert.doesNotMatch(r.show_to_builder, /tip jar/i);
    assert.equal(r.build_offer, undefined);
    assert.match(r.show_to_builder, new RegExp(`^${BENCH_HEADS.fund}$`, 'm'));
    assert.equal(r.move_up?.kind, 'start');
    assert.equal(r.move_up?.agent_note, START_NOTE);
    assert.match(START_NOTE, /identity/);
    const yes = (await tools.tell({ move_up: { kind: 'start', project_key: null, answer: 'yes' } }, { installationId: id } as never)) as { agent_note?: string };
    assert.equal(yes.agent_note, START_YES_NOTE);
    // A chat-only agent: the same line.
    const c = await install();
    await claimFx(c);
    const rc = await find(c, { agent_can_build: false }, NO_MATCH);
    assert.equal(rc.show_to_builder.split('\n')[1], NO_PROJECT_LINE);
    assert.equal(rc.show_to_builder.split('\n').at(-1), START_ASK);
    // An open program with its own starter: the build aimed at it, beside existing work; one question.
    const arc = { ...committedProgram('arc-microgrants'), id: `v2133-arc-${RUN}`, status: 'active', ends_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), fresh_build: { starter: STARTER_ID } };
    await upsertProgram(ProgramFile.parse(arc));
    try {
      const b = await install();
      await claimFx(b);
      const rb = await find(b, { agent_can_build: true }, { ...NO_MATCH, freshDeps: OWN_FRESH });
      assert.equal(rb.show_to_builder.split('\n').at(-1), startBuildAsk('a tip jar on Arc', arc.title), rb.show_to_builder);
      // The build option is part of the same last question.
      assert.ok(rb.show_to_builder.endsWith('?'));
      assert.equal(questions(rb.show_to_builder), 1, 'one question mark in the whole reply (links stripped)');
      assert.equal(rb.move_up?.kind, 'build');
      assert.equal(rb.move_up?.agent_note, START_NOTE);
      const by = (await tools.tell({ move_up: { kind: 'build', project_key: null, answer: 'yes' } }, { installationId: b } as never)) as { agent_note?: string };
      assert.match(by.agent_note ?? '', new RegExp(`build: \\{ start: true, program_id: '${arc.id}'`));
    } finally {
      await dropPrograms([arc.id]);
    }
  }));

// ---- 4. The claim link is a line -----------------------------------------------------------------

test('4.1 (v2.13.4: the claim is the one ask) the claim link, then one yes or no, last; one link', dbTest, () =>
  on(async () => {
    const link = 'https://earnkit.com/claim/abcdefghijkl';
    assert.equal(claimLine(link), `Your page: claim it with X at ${link}`);
    const id = await install();
    const key = `${uniq('maya')}/recipes`;
    const r = await find(id, { agent_can_build: true, identity: { github_login: key.split('/')[0], project: { name: 'Recipe planner', repo: key } } }, { ...NO_MATCH, proofBranchFetch: fakeGitHub().f });
    assert.ok(r.claim?.link);
    assert.ok(r.show_to_builder.endsWith(claimAsk(r.claim!.link, 'Recipe planner')), r.show_to_builder);
    assert.equal(links(r.show_to_builder).length, 1);
    assert.equal(questions(r.show_to_builder), 1);
    assert.ok(r.show_to_builder.endsWith('?'));
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
    gh: no, ghGraphql: async <T,>() => ({ data: { r0: null } }) as T, probe: no, fetchText: no, json: no, baseTxs: no, tokenTransfers: no, contractOrigin: no,
    arcLogs: no, arcHead: no, arcSender: no, usdPerNative: no, walletCreations: no, now: new Date(), ghFetch: f,
  };
};

test('5.1 App off: a repo EarnKit can\'t see says "EarnKit can only see public repos right now." and asks for a different project', dbTest, () =>
  on(async () => {
    const key = `${uniq('earnkitai')}/secret`;
    const gh = privateGitHub(key);
    const id = await install();
    await claimFx(id);
    const r = await find(id, named(key, uniq('jenil')), { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.equal(cantSeeLine('secret'), "I can't see secret. EarnKit can only see public repos right now.");
    assert.equal(r.show_to_builder.split('\n')[1], cantSeeLine('Secret'), r.show_to_builder);
    assert.ok(r.show_to_builder.endsWith(OTHER_PROJECT_ASK));
    assert.equal(r.proof, undefined);
    assert.doesNotMatch(r.show_to_builder, /github\/verify|Install EarnKit/);
  }));

test('5.2 App on, a private org repo: unclaimed, the X claim first (no App link); claimed, the one install link; installed, the branch is checked with the installation token and the project confirms and ranks; readings work; no token kept or logged', dbTest, () =>
  withEnv({ ...ON, ...APP }, async () => {
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
      // Unclaimed: the claim link is the one link (v2.13.4: the claim is the one ask); the install link comes next reply.
      const r1 = await find(id, named(key, login), { ...NO_MATCH, proofBranchFetch: gh.f });
      assert.equal(r1.show_to_builder.split('\n')[1], privateLine('Earnkit'), r1.show_to_builder);
      assert.equal(links(r1.show_to_builder).length, 1, r1.show_to_builder);
      assert.ok(r1.show_to_builder.endsWith(claimAsk(r1.claim!.link, 'Earnkit')), r1.show_to_builder);
      assert.equal(questions(r1.show_to_builder), 1);
      assert.ok(r1.show_to_builder.endsWith('?'));
      assert.equal(r1.move_up?.kind, 'claim');
      assert.equal(r1.proof, undefined);
      // Claimed: the install link is the one link (v2.13.4: the page named without https), the question last.
      await claimX(id);
      const r2 = await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
      const ls = links(r2.show_to_builder);
      assert.equal(ls.length, 1, r2.show_to_builder);
      assert.match(ls[0], /^https:\/\/earnkit\.com\/github\/verify\?n=/);
      assert.ok(r2.show_to_builder.endsWith(installAppAsk('Earnkit', ls[0])), r2.show_to_builder);
      assert.equal(r2.move_up?.kind, 'install_app');
      assert.equal(r2.move_up?.agent_note, INSTALL_APP_NOTE);
      assert.equal(questions(r2.show_to_builder), 1);
      assert.ok(r2.show_to_builder.endsWith('?'), 'the question is last');
      assert.equal(r2.proof, undefined, 'no branch before the App can read the repo');
      // Installed: the next find reads the repo with the per-call token and gives the branch.
      await installApp(id, key, login);
      const r3 = await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
      assert.equal(r3.show_to_builder.split('\n')[1], checkingBranchLine('Earnkit'), r3.show_to_builder);
      const branch = (r3.proof as { branch: string } | undefined)?.branch;
      assert.ok(branch);
      assert.ok(gh.minted.length > 0, 'a token was minted');
      assert.deepEqual(gh.minted[0], { repositories: ['earnkit'], permissions: { contents: 'read', metadata: 'read' } });
      gh.push(key, branch!, login);
      await again(id, { proofBranchFetch: gh.f });
      const [s] = await sql()<{ state: string; proof: string }[]>`SELECT state, proof FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo' AND lower(ref) = ${key}`;
      assert.deepEqual({ ...s }, { state: 'verified', proof: 'proof_branch' });
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
      assert.equal(reading.signals.contributors?.length, 1);
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
    await find(id, named(key, login), { ...NO_MATCH, proofBranchFetch: gh.f });
    await claimX(id);
    const r = await find(id, {}, { ...NO_MATCH, proofBranchFetch: gh.f });
    assert.equal(r.proof, undefined, r.show_to_builder);
    assert.equal(gh.minted.length, 0, 'no token for a proof that is not this person\'s');
    assert.match(r.show_to_builder, /Earnkit is private, so I can't count it yet\. Install the read-only EarnKit app on it \(one click\): /);
  }));

// ---- Owner rulings A and B (2026-10-17) ----------------------------------------------------------

test('A.1 pure: a project is asked to enter its best fit first, else a community round, before the Bench\'s own steps', () => {
  const p = { key: 'maya/recipes', name: 'Recipe planner', confirmed: true, live: false, weeks: 0 };
  const enter = { kind: 'enter' as const, project_key: p.key, program_id: 'x', line: enterAsk('Base Builder Grants') };
  const coin = { kind: 'coin' as const, project_key: p.key, line: raiseLine('Recipe planner', 'RECIPE', null) };
  const base = { project: p, canHost: true, updatesOn: false, postedThisWeek: false, scheduled: false, build: null, declined: [] as string[], claimed: true };
  assert.equal(chooseAsk({ ...base, coin, enter })?.kind, 'enter');
  assert.equal(chooseAsk({ ...base, coin, enter: null })?.kind, 'coin');
  assert.equal(chooseAsk({ ...base, coin: null, enter: null })?.kind, 'go_live', 'nothing to win yet: the Bench steps as before');
  assert.equal(chooseAsk({ ...base, coin, enter, declined: [benchStepKey('enter', p.key)] })?.kind, 'coin');
  // A project that can't join still asks for a different project first.
  assert.equal(chooseAsk({ ...base, project: { ...p, confirmed: false }, other: true, coin, enter })?.kind, 'other_project');
});

test('A.2 through find: a project with a fit names it in Ways to get funded and asks to enter it', dbTest, () =>
  on(async () => {
    const prog = await avalanche();
    const key = `${uniq('maya')}/recipes`;
    const id = await person({ main: key, claimed: uniq('mf').slice(0, 15), ranked: true, score: 60, projects: [{ key, name: 'Recipe planner', confirmed: true, weeks_shipping: 2 }] });
    const r = await find(id, {}, { matchProjects: async () => ({ checked: 1, scored: 1, fits: fitsFor(prog.id, key) }) });
    assert.match(r.show_to_builder, new RegExp(`^${prog.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} pays up to \\$10K and fits Recipe planner`, 'm'), r.show_to_builder);
    assert.equal(r.show_to_builder.split('\n').at(-1), enterAsk(prog.title));
    assert.equal(r.move_up?.kind, 'enter');
  }));

test('B.1 "community round", never raise or raising, in builder text; the banned-word check under the Bench catches them', () => {
  assert.equal(raiseLine('Recipe planner', 'RECIPE', null), "I'll launch $RECIPE on tokens.fun and you get 40% of its trading fees. Want to open a community round for Recipe planner?");
  assert.equal(FILTER_RAISING, 'Community round');
  assert.match(renderToStaticMarkup(React.createElement(RaisingPill, { symbol: 'RECIPE', url: 'https://tokens.fun/c/1' })), />Community round \$RECIPE</);
  for (const s of [raiseLine('Recipe planner', 'RECIPE', null), showRaisingLine('RECIPE'), RAISE_LINES.on('RECIPE'), RAISE_LINES.off, BENCH_HERO_SUBTITLE, ...BENCH_STEPS, TELL_DESCRIPTION_BENCH.replace('{ raising }', '{ field }')])
    assert.deepEqual(bannedInBench(s, ['Recipe planner']).filter((w) => /rais/.test(w)), [], s);
  assert.notDeepEqual(bannedInBench('Want to raise for it?', []), []);
  assert.notDeepEqual(bannedInBench('Raising $X', []), []);
  assert.notDeepEqual(bannedInBench('Start a fundraise', []), []);
  // The needs lines name their chain and pass the copy check.
  assert.deepEqual(bannedInBench(needsLine('Grants', 'up to $5K', "for a Base app, once it's live"), ['Grants']), []);
  assert.deepEqual(bannedInBench(cantSeeLine('secret'), ['secret']), []);
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

test('R2 (I1) no community round for a repo not read public; once public it is offered; a coin made for a private one uses the safe name and no repo link', dbTest, () =>
  withEnv({ ...ON, EARNKIT_RAISING: 'on', TOKENSFUN_DEPLOY_API_KEY: 'test' }, async () => {
    const key = `${uniq('earnkitai')}/secret`;
    const id = await confirmedRepo(key);
    const p = { key, name: 'secret', confirmed: true, live: true, weeks: 1, people: 0, has_coin: false, streak: 0, shipped: true };
    assert.equal(await coinAskBench(id, p, {}, { check: async () => true }), null, 'private: no offer');
    assert.equal((await sql()`SELECT 1 FROM coin_moments WHERE builder_id = ${id}`).length, 0, 'no moment used up');
    await markPublic(id);
    const ask = await coinAskBench(id, p, {}, { check: async () => true });
    assert.equal(ask?.kind, 'coin');
    assert.match(ask!.line, /\. Want to open a community round for secret\?$/);
    // The repo goes private after the offer: the yes makes the coin under the safe name, with no repo link.
    await sql()`UPDATE builder_sources SET public_at = NULL WHERE builder_id = ${id} AND kind = 'repo'`;
    const yes = await coinYes(id, key, `0x${'d'.repeat(40)}`, { check: async () => true });
    assert.ok('project_id' in yes, JSON.stringify(yes));
    const [x] = await sql()<{ name: string; repo_url: string | null }[]>`SELECT name, repo_url FROM projects WHERE id = ${(yes as { project_id: number }).project_id}`;
    assert.deepEqual({ ...x }, { name: 'Private project', repo_url: null });
  }));

test('R2b the coin gate reads a private repo with the App token (no re-push loop); R5 App on and not installed: the install ask, never "public repos only"', dbTest, () =>
  withEnv({ ...ON, ...APP }, async () => {
    const key = `${uniq('earnkitai')}/secret`;
    const gh = privateGitHub(key);
    const id = await confirmedRepo(key);
    const login = uniq('jenil').toLowerCase();
    const off = await coinBranchProof(id, key, new Date(), { ghFetch: gh.f });
    assert.ok('line' in off, JSON.stringify(off));
    const line = (off as { line: string }).line;
    assert.match(line, /^Secret is private, so I can't count it yet\. Install the read-only EarnKit app on it \(one click\): https:\/\/earnkit\.com\/github\/verify\?n=\S+\nWant me to count it once that's done\?$/);
    assert.doesNotMatch(line, /public repos/);
    await installApp(id, key, login);
    assert.deepEqual(await coinBranchProof(id, key, new Date(), { ghFetch: gh.f }), { ok: true }, 'controlProvenMain read it with the App token');
  }));

test('R4 (M1) a slow App token mint never holds the reply: find answers in time and the install ask stands', dbTest, () =>
  withEnv({ ...ON, ...APP }, async () => {
    const key = `${uniq('earnkitai')}/slow`;
    const gh = privateGitHub(key);
    const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname.startsWith('/app/') || new URL(String(input)).pathname.endsWith('/installation'))
        await new Promise<void>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      return gh.f(input, init);
    }) as typeof fetch;
    const id = await install();
    await find(id, named(key, uniq('jenil')), { ...NO_MATCH, proofBranchFetch: slow });
    await installApp(id, key, uniq('jenil').toLowerCase());
    const t0 = Date.now();
    const r = await find(id, {}, { ...NO_MATCH, proofBranchFetch: slow });
    const ms = Date.now() - t0;
    assert.ok(ms < 3000, `find took ${ms} ms`);
    assert.equal(r.show_to_builder.split('\n')[1], privateLine('Slow'), r.show_to_builder);
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

test('R7 (M5) a program with no known prize is named with what it needs, without a dollar figure', () => {
  const n = fundNeeds(card({ title: 'Open Grants', max_award_usd: null, any_chain: true, needs_repo: true }));
  assert.equal(n.prize, null);
  assert.equal(needsLine(n.title, n.prize, n.needs), 'Open Grants: once your code is on GitHub.');
  const picks = needsPicks([card({ id: 'a', title: 'Open Grants', max_award_usd: null, any_chain: true, status: 'active' } as Partial<Card>)], new Date(), new Set(), 2);
  assert.ok(picks.length <= 1);
});

test('R3 one question, last: the community round and coin lines end on their question (Bench)', () =>
  on(async () => {
    assert.equal(raiseLine('Recipe planner', 'RECIPE', null), "I'll launch $RECIPE on tokens.fun and you get 40% of its trading fees. Want to open a community round for Recipe planner?");
    assert.equal(raiseLine('Recipe planner', 'RECIPE', '0x12ab000000000000000000000000000000009f3e'),
      "I'll launch $RECIPE on tokens.fun and you get 40% of its trading fees, paid to 0x12ab…9f3e. Want to open a community round for Recipe planner?");
    const coin = { name: 'Recipe planner', symbol: 'RECIPE' };
    for (const m of ['built_live', 'countable', 'first_five', 'has_people', 'streak_five'] as const) {
      const l = coinLine(m, 'Recipe planner', null, coin);
      assert.ok(l.endsWith('?'), l);
      assert.equal((l.match(/\?/g) ?? []).length, 1, l);
    }
  }));
