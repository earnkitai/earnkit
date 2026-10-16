import './fixtures/no-network-checks';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { join } from 'node:path';
import postgres from 'postgres';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { tools } from './tools';
import { saveInstallation, touchInstallation } from './installations';
import { EVENT_LOG_FLAG } from './events';
import { claimThroughX } from './fixtures/claim-x';
import { resolveHandle } from './profiles';
import { refreshPerson, REFRESH_BUDGET_MS, rescorePerson } from './person-score';
import { mainProjectOf } from './main-project';
import { benchCardFacts, benchRows, parseBenchFilter, profileData } from './bench-data';
import { UPDATES_ASK, buildAsk, checkingBranchLine, takenLine } from './bench-reply';
import { NOT_CONFIRMED_NOTE, UPDATE_LINES } from './updates';
import { pillOf } from './raising';
import { feedWeeks, feedRankStep } from './feed';
import { weeklyFactsStep } from './week-facts';
import { readLanding } from './landing';
import { toolDescriptions } from './mcp';
import { OWNED_REPOS_QUERY, PERSON_GITHUB_QUERY } from './person-github';
import { STARTERS } from './starters';
import { withEnv } from './fixtures/find';
import { ARC_TIPJAR_BYTECODE } from './fixtures/arc-tipjar-artifact';
import { ARC_CONTRACT, TIPJAR_ABI, fakeArc } from './fixtures/arc-chain';
import type { ReaderDeps } from './source-readers';
import type { XOAuthDeps } from './x-oauth';
import type { TokenFlowDeps } from './token-launch';
import type { DeployDeps } from './deploy';
import type { FreshOn } from './present';
import BenchProfileView from '../../app/[handle]/BenchProfileView';
import type { ProfileTab } from '../../app/[handle]/handle-view';
import BenchView from '../../app/bench/BenchView';
import HomeView from '../../app/HomeView';
import TermsPage from '../../app/terms/page';
import { GET as llms } from '../../app/llms.txt/route';

/**
 * v2.13 T16 (spec "Acceptance test" 1 to 7, as the runbook walks them): one person with a project,
 * one without, the weekly update, the Bench filters, the raise, the landing page and no builder
 * bonus, through the real flag-on code paths (EARNKIT_BUILDER_SCORE and EARNKIT_BENCH on): find,
 * prepare, confirm and tell as an agent calls them, the claim with X, the proof branch pushed by the
 * repo's agent (v2.13.1 O1), the refresh, the rescore, the weekly facts and feed rank steps, and the pages'
 * data and views. Plus Review Focus 3 (a claimant of the same repo who never pushed the line never
 * reaches the Bench, the feed or the raise ask) and Review Focus 4 (flag off: the find heading,
 * /bench and /feed a 404).
 *
 * Real: every program file, the tools, the readers' parsing, discovery and the proof-line pusher
 * read, the score and rank, the claim, the starter build (deploy and its proof), the coin launch
 * behind deployToken, and a throwaway database of its own (schema.sql, dropped after).
 *
 * Faked, the outside world only: GitHub (the by-name GraphQL repo read, the profile read, the REST
 * repo, push record, compare, commits and earnkit.txt), the site probe, Blockscout (five callers),
 * tokens.fun (ticker check and deploy), X (token exchange and /2/users/me), the Arc deployer chain
 * and the sanctions screen. Every other fetch is noted and refused; 16.8 asserts none happened.
 *
 * Clock: real time (the database's now() stamps rows). The week finishing is the one jump: the
 * weekly facts and feed rank steps run at the next Monday 15:30 UTC (ruling: an update reaches
 * /feed only after its week is finished and ranked).
 */

const localDb = (() => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL ?? '').hostname);
  } catch {
    return false;
  }
})();
const db = { skip: !process.env.DATABASE_URL ? 'no DATABASE_URL' : !localDb && 'DATABASE_URL is not a local Postgres' };

const PROGRAMS_DIR = join(import.meta.dirname, '../../../../programs');
const SCHEMA = join(import.meta.dirname, '../../db/schema.sql');
const FAR = '2099-01-01T00:00:00Z';
const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = new Date();
const ARC = 'arc-microgrants';
const sharedUrl = process.env.DATABASE_URL;
const journeyDb = `earnkit_v213_journey_${process.pid}`;

(globalThis as { React?: typeof React }).React = React;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

/** A deployer key made for this test only. */
const DEPLOYER_KEY = '9a1c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
const savedEnv: Record<string, string | undefined> = {};
const ENV: Record<string, string | undefined> = {
  EARNKIT_BUILDER_SCORE: 'on',
  EARNKIT_BENCH: 'on',
  // Final fix: the raise path (16.5) runs as built, with EARNKIT_RAISING on.
  EARNKIT_RAISING: 'on',
  [EVENT_LOG_FLAG]: 'on',
  EARNKIT_AUTH_SECRET: process.env.EARNKIT_AUTH_SECRET || 'v213-journey-secret',
  X_CLIENT_ID: 'v213-journey-x',
  X_CLIENT_SECRET: 'v213-journey-xs',
  EARNKIT_URL: 'https://earnkit.com',
  TOKENSFUN_DEPLOY_API_KEY: 'v213-journey-key',
  // No sign-in and no App: every repo is proven by the earnkit.txt line its owner pushed.
  GITHUB_OAUTH_CLIENT_ID: undefined,
  GITHUB_OAUTH_CLIENT_SECRET: undefined,
  GITHUB_APP_ID: undefined,
  GITHUB_APP_SLUG: undefined,
  GITHUB_APP_PRIVATE_KEY: undefined,
  GITHUB_TOKEN: undefined,
  // Hosting off (the build falls to GitHub Pages); the deployer is switched on for 16.2 only.
  R2_ACCOUNT_ID: undefined,
  R2_ACCESS_KEY_ID: undefined,
  R2_SECRET_ACCESS_KEY: undefined,
  R2_BUCKET: undefined,
  DEPLOYER_PRIVATE_KEY: undefined,
};

// ---- The outside world -------------------------------------------------------------------------

const iso = (ms: number) => new Date(ms).toISOString();
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => json({ message: 'Not Found' }, 404);
const sha = (c: string) => c.repeat(40);

/**
 * GitHub as the builders' agents leave it. maya/recipes is 400 days old, live at its homepage, with
 * a commit in each of the last three ISO weeks; `pushBranch` is the agent's temporary proof branch
 * (v2.13.1 O1). maya2/tipjar is made and pushed by the starter build (a new repo: its
 * first push is a branch creation).
 */
type GhRepo = {
  owner: string; name: string; createdAt: number; homepage: string | null;
  /** Newest first, as GitHub's activity list. */
  activity: { activity_type: string; ref: string; before: string; after: string; timestamp: string; actor: { login: string } }[];
  /** earnkit.txt at a commit. */
  files: Map<string, string>;
  /** The commit the newest push brought, and when. */
  head: { before: string; after: string; at: number } | null;
};
const GITHUB = new Map<string, GhRepo>();
const ACCOUNTS = new Set(['maya', 'maya2', 'eve']);
function repo(owner: string, name: string, createdAt: number, homepage: string | null): GhRepo {
  const r: GhRepo = { owner, name, createdAt, homepage, activity: [], files: new Map(), head: null };
  GITHUB.set(`${owner}/${name}`, r);
  return r;
}
const RECIPES = repo('maya', 'recipes', NOW.getTime() - 400 * DAY, 'https://recipes.app');
/** maya's three weeks of commits (this week, last week, the week before). */
const COMMITS = [NOW.getTime() - 1_000, NOW.getTime() - 7 * DAY, NOW.getTime() - 14 * DAY];
/** v2.13.1 O1: the agent's temporary proof branch (`owner/repo#branch`), pointing at the current commit. */
const BRANCHES = new Set<string>();
function pushBranch(r: GhRepo, branch: string) {
  BRANCHES.add(`${r.owner}/${r.name}#${branch}`);
  // GitHub's activity record of the push: the repo's owner created the branch (fix round 1: the pusher is checked).
  r.activity.unshift({ activity_type: 'branch_creation', ref: `refs/heads/${branch}`, before: sha('0'), after: sha('b'), timestamp: iso(Date.now()), actor: { login: r.owner } });
}
/** The starter build's `gh repo create` and first push (v2.11 journey). */
function firstPush(r: GhRepo, line: string) {
  const at = Date.now();
  const after = sha('c');
  r.files.set(after, `${line}\n`);
  r.head = { before: sha('0'), after, at: at - 10_000 };
  r.activity.unshift({ activity_type: 'branch_creation', ref: 'refs/heads/main', before: sha('0'), after, timestamp: iso(at), actor: { login: r.owner } });
}
const repoJson = (r: GhRepo) => ({
  name: r.name, full_name: `${r.owner}/${r.name}`, html_url: `https://github.com/${r.owner}/${r.name}`, homepage: r.homepage, has_pages: false,
  default_branch: 'main', created_at: iso(r.createdAt), pushed_at: iso(r.head?.at ?? r.createdAt), fork: false, archived: false, is_template: false,
  template_repository: null, private: false, visibility: 'public', owner: { login: r.owner, type: 'User' }, description: null, topics: [],
});
/** The by-name GraphQL node (person-github.ts REPO_FIELDS). */
const repoNode = (r: GhRepo, now: Date) => ({
  nameWithOwner: `${r.owner}/${r.name}`, description: null, homepageUrl: r.homepage, isFork: false, isTemplate: false, isPrivate: false,
  createdAt: iso(r.createdAt), pushedAt: iso(r.head?.at ?? COMMITS[0]), stargazerCount: 0, forkCount: 0, primaryLanguage: { name: 'TypeScript' },
  owner: { __typename: 'User', login: r.owner }, parent: null, templateRepository: null, stargazers: { edges: [] }, forks: { nodes: [] },
  defaultBranchRef: { target: { history: { nodes: (r === RECIPES ? COMMITS : r.head ? [r.head.at] : []).filter((t) => t <= now.getTime()).map((t) => ({ committedDate: iso(t) })) } } },
});

/** Every GitHub path asked (REST, raw), for the report on a failure. */
const githubSeen: string[] = [];
function github(u: URL): Response {
  const p = u.pathname;
  githubSeen.push(`${u.host}${p}${u.search}`);
  if (u.host === 'raw.githubusercontent.com') {
    const [, owner, name, ref, ...rest] = p.split('/');
    const r = GITHUB.get(`${owner}/${name}`.toLowerCase());
    // A branch name or HEAD reads the newest push's commit.
    const text = r?.files.get(['main', 'HEAD'].includes(ref) && r.head ? r.head.after : ref);
    return text && rest.join('/') === 'earnkit.txt' ? new Response(text) : notFound();
  }
  if (p === '/search/commits') return json({ total_count: 0, items: [] });
  if (p.startsWith('/search/issues')) return json({ items: [] });
  let m = p.match(/^\/users\/([^/]+)$/);
  if (m) {
    const login = decodeURIComponent(m[1]).toLowerCase();
    if (!ACCOUNTS.has(login)) return notFound();
    return json({ login, type: 'User', created_at: iso(NOW.getTime() - 400 * DAY), public_repos: 1, blog: null, twitter_username: null });
  }
  m = p.match(/^\/users\/([^/]+)\/(repos|orgs)$/);
  if (m) return json(m[2] === 'orgs' ? [] : [...GITHUB.values()].filter((r) => r.owner === m![1].toLowerCase()).map(repoJson));
  m = p.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (m) {
    const r = GITHUB.get(`${m[1]}/${m[2]}`.toLowerCase());
    if (!r) return notFound();
    const rest = m[3] ?? '';
    if (rest === '') return json(repoJson(r));
    if (rest === '/activity') return json(r.activity);
    // maya/recipes has its three weeks of commits (COMMITS); a built repo, its first push.
    if (rest === '/commits' && r === RECIPES && !r.head)
      return json([{ sha: sha('d'), parents: [], author: { login: r.owner }, commit: { author: { date: iso(COMMITS[0]) }, committer: { date: iso(COMMITS[0]) } } }]);
    if (rest === '/commits')
      return json(r.head ? [{ sha: r.head.after, parents: [], author: { login: r.owner }, commit: { author: { date: iso(r.head.at) }, committer: { date: iso(r.head.at) } } }] : []);
    if (rest.startsWith('/compare/') && r.head && rest === `/compare/${r.head.before}...${r.head.after}`)
      return json({ status: 'ahead', total_commits: 1, commits: [{ sha: r.head.after, parents: [{ sha: r.head.before }], commit: { committer: { date: iso(r.head.at) } } }] });
    if (rest === '/branches') return json([{ name: 'main' }]);
    const ref = rest.match(/^\/git\/ref\/heads\/(.+)$/);
    if (ref)
      return BRANCHES.has(`${r.owner}/${r.name}#${ref[1]}`)
        ? json({ ref: `refs/heads/${ref[1]}`, url: `https://api.github.com/repos/${r.owner}/${r.name}/git/refs/heads/${ref[1]}`, object: { sha: sha('b'), type: 'commit' } })
        : notFound();
    if (rest === '/contents/earnkit.txt') {
      const text = r.head && r.files.get(r.head.after);
      return text ? new Response(text) : notFound();
    }
    if (rest === '/contributors') return json([{ login: r.owner }]);
    if (rest.startsWith('/git/trees/')) return json({ tree: [] });
  }
  return notFound();
}

/** No network: GitHub and tokens.fun are the fakes here; every other host gets a 503 and is noted. */
const blocked: string[] = [];
const launched: { symbol: string; wallet: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const u = new URL(url);
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return realFetch(input, init);
  if (['api.github.com', 'github.com', 'raw.githubusercontent.com'].includes(u.host)) return github(u);
  if (u.hostname === 'tokens.fun' && u.pathname === '/api/check-ticker') return json({ available: true });
  if (u.hostname === 'tokens.fun' && u.pathname === '/api/v1/deploy') {
    const body = JSON.parse(String(init?.body)) as { symbol: string; creatorWallet: string };
    launched.push({ symbol: body.symbol, wallet: body.creatorWallet.toLowerCase() });
    const tokenAddress = `0x${randomBytes(20).toString('hex')}`;
    return json({ success: true, tokenAddress, txHash: `0x${'c'.repeat(64)}`, chainId: 8453, urls: { tokensfun: `https://tokens.fun/coin/${tokenAddress}` } });
  }
  blocked.push(url);
  return new Response('v213-journey: no network', { status: 503 });
}) as typeof fetch;

/** Every GraphQL query sent (16.8: never the person query). */
const graphqlSent: { query: string; bench: boolean }[] = [];
/** maya's tracked contract on Base, and its callers (none until 16.5 gives five). */
const CONTRACT = `0x${randomBytes(20).toString('hex')}`;
let callers: { timestamp: string; status: string; from: { hash: string }; value: string }[] = [];

const ghJson = async <T,>(path: string): Promise<T> => {
  const res = github(new URL(`https://api.github.com${path}`));
  if (res.status !== 200) throw new Error(`v213-journey: GitHub ${path} ${res.status}`);
  return (await res.json()) as T;
};
const FAKE_READER: ReaderDeps = {
  get now() {
    return new Date();
  },
  ghGraphql: async <T,>(q: string, v: Record<string, unknown>) => {
    graphqlSent.push({ query: q, bench: process.env.EARNKIT_BENCH === 'on' });
    if (typeof v.login === 'string') {
      const login = v.login.toLowerCase();
      return { data: { user: ACCOUNTS.has(login) ? { login, twitterUsername: null, websiteUrl: null, repositories: { nodes: [] } } : null } } as T;
    }
    const data: Record<string, unknown> = {};
    for (let i = 0; v[`o${i}`] !== undefined; i++) {
      const r = GITHUB.get(`${v[`o${i}`]}/${v[`n${i}`]}`.toLowerCase());
      if (r) data[`r${i}`] = repoNode(r, new Date());
    }
    return { data } as T;
  },
  gh: ghJson,
  ghFetch: ((input: RequestInfo | URL) => Promise.resolve(github(new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)))) as typeof fetch,
  probe: async (url) => ({ status: /^https:\/\/recipes\.app\/?$/.test(url) ? 200 : 404 }),
  fetchText: async () => {
    throw new Error('not found');
  },
  baseTxs: async () => ({ items: callers, next_page_params: null }),
  contractOrigin: async () => ({ deployer: MAYA_WALLET, created_at: iso(NOW.getTime() - 30 * DAY) }),
  tokenTransfers: async () => ({ items: [], next_page_params: null }),
  json: async () => {
    throw new Error('v213-journey: npm/pypi not served');
  },
  arcLogs: async () => [],
  arcHead: async () => 0n,
  arcSender: async () => {
    throw new Error('v213-journey: Arc sender not served');
  },
  usdPerNative: async () => 3000,
  walletCreations: async () => [],
};

/** tokens.fun's launches go through the real deployToken (the fetch above); the sanctions screen (an RPC read) is stubbed. */
const FAKE_TOKENS: TokenFlowDeps = { available: () => true, limit: async () => {}, gate: { screen: async () => {} }, logo: async () => null };
/** Deploys and hosting on, a client that builds, arc-tipjar tested today (no date rot). */
const FRESH_ON: FreshOn = {
  deployOn: () => true, hostOn: true, canBuild: true,
  starters: { ...STARTERS, 'arc-tipjar': { ...STARTERS['arc-tipjar'], tested_at: new Date().toISOString().slice(0, 10) } },
};
const ctx = (id: number, extra: Record<string, unknown> = {}) => ({ installationId: id, readerDeps: FAKE_READER, tokenDeps: FAKE_TOKENS, freshDeps: FRESH_ON, ...extra }) as never;

/** X: the token exchange and /2/users/me, as X answers for the person signing in. */
let xUser = { id: 'x-maya', username: 'maya_makes', name: 'Maya Chen', avatar: 'https://pbs.twimg.com/profile_images/1/m_400x400.jpg' as string | null };
const fakeX: XOAuthDeps = { exchange: async () => 'x-token', me: async () => xUser };

// ---- The database ------------------------------------------------------------------------------

before(async () => {
  if (!sharedUrl || !localDb) return;
  const admin = postgres(sharedUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${journeyDb}`);
    await admin.unsafe(`CREATE DATABASE ${journeyDb}`);
  } finally {
    await admin.end();
  }
  const url = new URL(sharedUrl);
  url.pathname = `/${journeyDb}`;
  const fresh = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await fresh.unsafe(readFileSync(SCHEMA, 'utf8'));
  } finally {
    await fresh.end();
  }
  process.env.DATABASE_URL = url.toString();
  for (const [k, v] of Object.entries(ENV)) {
    savedEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // Every real program file. Curated programs close in 2099 so no step depends on real dates, except
  // Arc Microgrants (the starter build's program), which closes in 3 days (the build lead's window).
  for (const f of readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(join(PROGRAMS_DIR, f), 'utf8'));
    if (!raw.campaign) Object.assign(raw, { status: 'active', ends_at: raw.ends_at ? FAR : raw.ends_at });
    if (raw.id === ARC) raw.ends_at = new Date(Date.now() + 3 * DAY + HOUR).toISOString();
    await upsertProgram(ProgramFile.parse(raw));
  }
});

after(async () => {
  globalThis.fetch = realFetch;
  if (!sharedUrl || !localDb) return;
  await sql().end();
  process.env.DATABASE_URL = sharedUrl;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const admin = postgres(sharedUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${journeyDb}`);
  } finally {
    await admin.end();
  }
});

// ---- Helpers -----------------------------------------------------------------------------------

type Reply = {
  show_to_builder: string; agent_note?: string; claim?: { link: string }; proof?: { line?: string; branch?: string; remove?: string; agent_note?: string };
  move_up?: { kind: string; project_key: string | null }; build_offer?: { program_id: string }; schedule_weekly_update?: string;
  kit?: { proof_line?: string | null }; project_id?: number;
};
async function newInstall(): Promise<number> {
  const token = `v213-${randomBytes(16).toString('hex')}`;
  await saveInstallation(token);
  const id = await touchInstallation(token);
  assert.ok(id);
  return id;
}
const call = async (tool: 'find' | 'prepare' | 'confirm' | 'tell' | 'score', input: unknown, c: unknown) =>
  (await (tools[tool] as (i: unknown, c: unknown) => Promise<unknown>)(input, c)) as Reply;

/** The claim through X (fixtures/claim-x.ts); the person lands on their page. */
async function claimX(link: string): Promise<void> {
  const done = await claimThroughX(link, fakeX);
  assert.equal(done.status, 200, await done.clone().text());
}

/** As if `ms` passed since the person's last read (the refresh guard). */
async function advanceRefreshGuard(id: number, ms: number) {
  await sql()`UPDATE builder_live SET read_at = read_at - ${`${ms} milliseconds`}::interval WHERE builder_id = ${id}`;
  await sql()`UPDATE source_live SET read_at = read_at - ${`${ms} milliseconds`}::interval WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id = ${id})`;
}

/**
 * The profile at earnkit.com/<handle> on `tab` (F4): the Bench view rendered from profileData, as
 * handle-view.tsx's BenchPage renders it (HandleView itself needs a request for headers()).
 */
async function renderProfile(handle: string, tab: ProfileTab): Promise<string> {
  const r = await resolveHandle(handle);
  assert.ok(r && !('redirect' in r), `no page at ${handle}`);
  const data = await profileData(r.builderId, new Date());
  assert.ok(data, `no profile data for ${handle}`);
  return html(React.createElement(BenchProfileView, { data, tab }));
}

/** The next Monday at 15:30 UTC: the week is finished and the Monday steps have run. */
function nextMonday15(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 15, 30));
  d.setUTCDate(d.getUTCDate() + (((8 - d.getUTCDay()) % 7) || 7));
  return d;
}

/** Five people call maya's tracked contract, then her refresh reads them (the first_five moment). */
async function giveFivePeople(id: number) {
  callers = Array.from({ length: 5 }, (_, i) => ({ timestamp: iso(Date.now() - (1 + i) * DAY), status: 'ok', from: { hash: `0x${randomBytes(20).toString('hex')}` }, value: '0' }));
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${MAYA_WALLET.toLowerCase()}, ${id}) ON CONFLICT DO NOTHING`;
  await sql()`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by, verified_at)
    VALUES (${id}, 'contract', ${`base:${CONTRACT}`}, 'maya/recipes', 'verified', 'deploy_wallet', 'server', now())`;
  await advanceRefreshGuard(id, 11 * 60_000);
  await refreshPerson(id, { now: new Date(), deadline: Date.now() + REFRESH_BUDGET_MS, reader: FAKE_READER });
}

/**
 * `n` listed people whose one project has an EarnKit deploy on Base, each confirmed by its own repo
 * proof, rescored. Returns the handle of the highest score.
 */
async function seedBaseBuilders(n: number): Promise<string> {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const id = await newInstall();
    const key = `base${i}/app`;
    await sql()`
      INSERT INTO builder_profiles (builder_id, slug, x_user_id, x_handle, claimed_at, main_project_key, github_login)
      VALUES (${id}, ${`base${i}`}, ${`x-base${i}`}, ${`base_${i}`}, now(), ${key}, ${`base${i}`})
      ON CONFLICT (builder_id) DO UPDATE SET x_user_id = EXCLUDED.x_user_id, x_handle = EXCLUDED.x_handle, claimed_at = now(),
        main_project_key = EXCLUDED.main_project_key, github_login = EXCLUDED.github_login`;
    await sql()`
      INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by, verified_at)
      VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'server', now())`;
    await sql()`
      INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, address, status, owner_ok, cost_micro_usd, created_at)
      VALUES (${id}, ${`base${i}`}, ${key}, 'base', ${`0x${randomBytes(32).toString('hex')}`}, ${`0x${randomBytes(20).toString('hex')}`}, 'deployed', true, 1000,
        now() - ${`${i + 1} days`}::interval)`;
    await rescorePerson(id, new Date());
    ids.push(id);
  }
  const [top] = await sql()<{ handle: string }[]>`
    SELECT p.x_handle AS handle FROM builder_live l JOIN builder_profiles p USING (builder_id) WHERE l.builder_id IN ${sql()(ids)} AND l.ranked
    ORDER BY l.score DESC, lower(p.x_handle) LIMIT 1`;
  assert.ok(top, 'a ranked Base builder');
  return top.handle;
}

/** The starter build of the v2.11 journey (13.1 to 13.4 with the fakes), repo maya2/tipjar, through its deploy. */
async function runStarterBuild(id: number, programId: string): Promise<void> {
  const deployDeps: DeployDeps = { chain: (c) => (c === 'arc' ? fakeArc(() => MAYA2_WALLET) : null), usdPerNative: async () => 1 };
  const c = ctx(id, { ownInstallationId: id, deployDeps });
  const twist = { twist: 'tips for my podcast listeners', name: 'PodTips', description: 'Podcast listeners tip the show in USDC on Arc.', feature: 'Each tip can carry a question.', for_whom: 'for your podcast listeners' };
  await withEnv({ DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY }, async () => {
    await call('prepare', { program_id: programId, build: { start: true, program_id: programId } }, c);
    const kit = await call('prepare', { program_id: programId, build: { program_id: programId, ...twist, wallet: MAYA2_WALLET } }, c);
    assert.ok(kit.kit, JSON.stringify(kit));
    const tipjar = repo('maya2', 'tipjar', Date.now() - 2 * 60_000, null);
    const repoUrl = 'https://github.com/maya2/tipjar';
    const withRepo = await call('prepare', { program_id: programId, build: { program_id: programId, ...twist, wallet: MAYA2_WALLET, repo_url: repoUrl } }, c);
    const line = withRepo.kit?.proof_line;
    assert.ok(line, JSON.stringify(withRepo));
    firstPush(tipjar, line);
    const deploy = { chain: 'arc', bytecode: ARC_TIPJAR_BYTECODE, abi: TIPJAR_ABI, constructor_args: [MAYA2_WALLET, 'PodTips', '1000000'], owner_wallet: MAYA2_WALLET };
    const shipped = await call('prepare', { program_id: programId, project: { name: 'PodTips', description: twist.description, repo_url: repoUrl }, deploy, host: true, build: { program_id: programId } }, c);
    assert.equal((shipped as { deploy?: { address?: string } }).deploy?.address, ARC_CONTRACT, JSON.stringify(shipped));
  });
}

const MAYA_WALLET = `0x${'1a'.repeat(20)}`;
const MAYA2_WALLET = '0x12ab34cd56ef7890a1b2c3d4e5f6a7b8c9d09f3e';
/** The 16.1 person (set by 16.1). */
const MAYA = { id: 0, wallet: MAYA_WALLET };
/** The highest of seedBaseBuilders (set by 16.4). */
let BASE_HANDLE = '';
/** The Review Focus 3 claimant of maya/recipes (set by 16.1b). */
let EVE = 0;
const RECIPES_PROJECT = { name: 'Recipe planner', what: 'a recipe planner', repo: 'https://github.com/maya/recipes.git', live_url: 'https://recipes.app' };

// ---- The journey -------------------------------------------------------------------------------

test('16.1 acceptance 1, with a project: the first reply names it and carries the claim link and the proof; after X and the proof branch it is on the Bench; the page shows the photo, the Started card and the Project tab', db, async () => {
  const id = await newInstall();
  MAYA.id = id;
  const r1 = await call('find', { identity: { github_login: 'maya', project: RECIPES_PROJECT } }, ctx(id));
  assert.equal(r1.show_to_builder.split('\n')[0], 'Where you stand', r1.show_to_builder);
  assert.equal(r1.show_to_builder.split('\n')[1], checkingBranchLine('Recipe planner'), r1.show_to_builder);
  assert.match(r1.claim?.link ?? '', /^https:\/\/earnkit\.com\/claim\/[a-z2-7]{12}$/);
  assert.ok(r1.show_to_builder.includes(`Claim your page with X: ${r1.claim!.link}`));
  const branch = r1.proof?.branch;
  assert.match(branch ?? '', /^earnkit-[a-z2-7]{12}$/, JSON.stringify(r1.proof));
  await claimX(r1.claim!.link);
  // v2.13.1 O1: the agent pushed the temporary branch in the same turn; the next find checks it.
  pushBranch(RECIPES, branch!);
  await advanceRefreshGuard(id, 61_000);
  const r2 = await call('find', {}, ctx(id));
  assert.match(r2.show_to_builder, /^Recipe planner is on the Bench(: [^,]+)?, 3 weeks shipping\.$/m, r2.show_to_builder);
  assert.ok(r2.show_to_builder.endsWith(UPDATES_ASK), r2.show_to_builder);
  assert.equal(r2.claim, undefined, 'claimed: no claim link');
  assert.equal(r2.proof?.agent_note, `Confirmed. Delete the branch now: git push origin :refs/heads/${branch}`);
  const page = await renderProfile('maya_makes', 'log');
  assert.match(page, /src="https:\/\/pbs\.twimg\.com\/profile_images\/1\/m_400x400\.jpg"/);
  assert.ok(page.includes('Started tracking Recipe planner.'), page);
  assert.ok((await renderProfile('maya_makes', 'project')).includes('https://recipes.app'));
});

test('16.1b review focus 3: a second person naming maya/recipes (already on the Bench under maya) is told so and stays off it: no Bench, no update', db, async () => {
  EVE = await newInstall();
  xUser = { id: 'x-eve', username: 'eve_ships', name: 'Eve', avatar: null };
  const r = await call('find', { identity: { github_login: 'eve', project: { ...RECIPES_PROJECT, name: 'My recipes' } } }, ctx(EVE));
  assert.equal(r.show_to_builder.split('\n')[1], takenLine('My recipes'), r.show_to_builder);
  await claimX(r.claim!.link);
  await advanceRefreshGuard(EVE, 61_000);
  const again = await call('find', {}, ctx(EVE));
  assert.equal(again.show_to_builder.split('\n')[1], takenLine('My recipes'), again.show_to_builder);
  assert.notEqual(again.move_up?.kind, 'updates');
  const update = await call('tell', { update: { text: 'Shipped the fridge photo import.' } }, ctx(EVE));
  assert.equal(update.agent_note, NOT_CONFIRMED_NOTE);
  assert.ok(!(await benchRows(parseBenchFilter({}))).rows.some((x) => x.handle === 'eve_ships'));
});

test('16.2 acceptance 2, without a project: ways to get funded and one build offer; the build becomes the one project', db, async () => {
  const id = await newInstall();
  const r = await call('find', { agent_can_build: true, github_user: 'maya2' }, ctx(id));
  assert.match(r.show_to_builder, /^You're not on the Bench yet\./m, r.show_to_builder);
  assert.match(r.show_to_builder, /^Ways to get funded\n.+ pays .+ for .+\./m, r.show_to_builder);
  assert.ok(r.show_to_builder.endsWith(buildAsk('a tip jar on Arc')), r.show_to_builder);
  assert.equal(r.move_up?.kind, 'build');
  const yes = await call('tell', { move_up: { kind: 'build', project_key: null, answer: 'yes' } }, ctx(id));
  assert.ok(yes.agent_note?.includes(`build: { start: true, program_id: '${r.build_offer!.program_id}' }`), JSON.stringify(yes));
  await runStarterBuild(id, r.build_offer!.program_id);
  assert.equal(await mainProjectOf(id), 'maya2/tipjar');
});

test('16.3 acceptance 3, the weekly update: yes, then "post this week\'s update now": a long card with chips; after the week is ranked it reaches /feed', db, async () => {
  const id = MAYA.id;
  const yes = await call('tell', { move_up: { kind: 'updates', project_key: 'maya/recipes', answer: 'yes' } }, ctx(id));
  assert.equal(yes.show_to_builder, UPDATE_LINES.on);
  assert.ok(yes.schedule_weekly_update);
  const posted = await call('tell', { update: { text: 'Added fridge photo import, so it plans a week of meals from a picture.' } }, ctx(id));
  assert.equal(posted.show_to_builder, UPDATE_LINES.postedAt('earnkit.com/maya_makes'));
  const log = await renderProfile('maya_makes', 'log');
  assert.match(log, /data-shape="long"[\s\S]*Added fridge photo import[\s\S]*commit/, log);
  assert.doesNotMatch(log, /written by an agent/i);
  // Not in /feed at once: only finished, ranked weeks.
  assert.deepEqual(await feedWeeks(new Date(), { only: [id] }), []);
  // The week finishes: the Monday step (from 15:00 UTC) and the daily rank, then the feed.
  const monday = nextMonday15(NOW);
  assert.deepEqual(await weeklyFactsStep(monday, { deadline: Date.now() + 20_000, only: [id] }), { people: 1, rows: 1 });
  assert.deepEqual(await feedWeeks(monday, { only: [id] }), [], 'finished but not ranked yet');
  assert.ok('rows' in (await feedRankStep(monday)));
  const feed = await feedWeeks(monday, { only: [id] });
  assert.ok(feed[0]?.cards.some((c) => c.text?.startsWith('Added fridge photo import') && c.chips.some((x) => /commit/.test(x))), JSON.stringify(feed));
  // Review focus 3: the Confirming claimant of the same repo is never in it.
  assert.ok(!(await feedWeeks(monday)).flatMap((w) => w.cards).some((c) => c.handle === 'eve_ships'));
});

test('16.4 acceptance 4, Bench filters: /bench?chain=base lists only Base projects with the Base logo; the profile shows the Base line (#N of M under 20)', db, async () => {
  BASE_HANDLE = await seedBaseBuilders(10);
  const filter = parseBenchFilter({ chain: 'base' });
  const base = await benchRows(filter);
  assert.ok(base.rows.length >= 10 && base.rows.every((r) => r.chains.includes('base')), JSON.stringify(base.rows));
  assert.ok(!base.rows.some((r) => r.handle === 'maya_makes'), 'maya is not on Base yet');
  assert.ok(base.chips.includes('base'));
  assert.match(html(React.createElement(BenchView, { ...base, filter, raising: true })), /alt="Base"/);
  assert.match(await renderProfile(BASE_HANDLE, 'log'), /#\d+ of \d+ on Base|Top \d+(\.\d)?% on Base/);
});

test('16.5 acceptance 5, raise: the yes launches the coin, the pill shows on the profile, the Bench row and the card; stop raising removes it', db, async () => {
  const id = MAYA.id;
  await giveFivePeople(id);
  const offer = await call('find', {}, ctx(id));
  assert.match(offer.show_to_builder, /Want to raise for Recipe planner\? I'll launch \$\w+ on tokens\.fun and you get 40% of its trading fees/, offer.show_to_builder);
  assert.equal(offer.move_up?.kind, 'coin');
  // Review focus 3: the Confirming claimant is never asked to raise.
  await advanceRefreshGuard(EVE, 11 * 60_000);
  assert.doesNotMatch((await call('find', {}, ctx(EVE))).show_to_builder, /raise/i);
  const yes = await call('tell', { coin: { project_key: 'maya/recipes', answer: 'yes', wallet: MAYA.wallet } }, ctx(id));
  assert.ok(yes.project_id, JSON.stringify(yes));
  // v2.13.1 O1 fix round 1 (ruling a): the repo's proof branch stands in for the earnkit.txt line: nothing is pushed.
  const launch = await call('confirm', { project_id: yes.project_id, yes: true, wallet: MAYA.wallet }, ctx(id));
  assert.equal(launched.length, 1, JSON.stringify(launch));
  const pill = await pillOf(id);
  assert.ok(pill, JSON.stringify(launch));
  assert.ok((await renderProfile('maya_makes', 'log')).includes(`Raising $${pill.symbol}`));
  const row = (await benchRows(parseBenchFilter({ raising: '1' }))).rows.find((r) => r.handle === 'maya_makes');
  assert.deepEqual(row?.raising, pill);
  assert.equal((await benchCardFacts(id))?.raising, pill.symbol, 'the share card');
  const [p] = await sql()<{ coin_tx: string; coin_chain_id: number }[]>`SELECT coin_tx, coin_chain_id FROM projects WHERE id = ${yes.project_id!}`;
  assert.deepEqual({ ...p }, { coin_tx: `0x${'c'.repeat(64)}`, coin_chain_id: 8453 });
  await call('tell', { coin: { raising: false } }, ctx(id));
  assert.equal(await pillOf(id), null);
});

test('16.6 acceptance 6, the landing page: the hero, the Bench top 10 and the square cards', db, async () => {
  const landing = await readLanding(nextMonday15(NOW));
  const page = html(React.createElement(HomeView, { landing }));
  assert.ok(page.includes('Ship every week. Get funded.') && page.includes('The Bench') && page.includes('This week on the Bench'));
  assert.ok((landing.bench?.rows.length ?? 0) <= 10);
  assert.match(page, /data-shape="square"/);
  assert.ok(landing.bench?.cards.some((c) => c.handle === 'maya_makes'));
});

test('16.7 acceptance 7, no builder bonus text anywhere a builder can see', db, async () => {
  const texts = [
    (await call('find', {}, ctx(MAYA.id))).show_to_builder,
    html(React.createElement(HomeView, { landing: await readLanding(NOW) })),
    html(React.createElement(TermsPage)),
    await (await llms()).text(),
    ...Object.values(toolDescriptions(true, true)),
  ];
  for (const t of texts) assert.doesNotMatch(t, /bonus/i, t.slice(0, 400));
});

/** The app's `@/` import alias (tsconfig paths, which the test runner does not read from the repo root), for the pages 16.7b imports. */
const FRONTEND = join(import.meta.dirname, '../..');
type Resolve = (spec: string, context: unknown, next: (spec: string, context: unknown) => unknown) => unknown;
// module.registerHooks (Node 22.15+); the installed @types/node predates it.
(nodeModule as unknown as { registerHooks: (h: { resolve: Resolve }) => void }).registerHooks({
  resolve: (spec, context, next) => next(spec.startsWith('@/') ? join(FRONTEND, spec.slice(2)) : spec, context),
});

test('16.7b review focus 4, flag off: the find heading is today\'s, /bench and /feed are a 404', db, () =>
  withEnv({ EARNKIT_BENCH: undefined }, async () => {
    const id = await newInstall();
    const r = await call('find', { identity: { github_login: 'off', project: { name: 'Off', repo: 'https://github.com/off/app' } } }, ctx(id));
    assert.match(r.show_to_builder, /^Ways to earn right now$/m, r.show_to_builder);
    assert.doesNotMatch(r.show_to_builder, /Bench|Ways to get funded/);
    for (const page of [await import('../../app/bench/page'), await import('../../app/feed/page')])
      await assert.rejects(
        async () => (page.default as (p: unknown) => Promise<unknown>)({ searchParams: Promise.resolve({}) }),
        (err: { digest?: string }) => /404/.test(String(err.digest)),
      );
  }),
);

test('16.8 no network: every outside read went through a fake, and no person query was sent under the flag', db, () => {
  assert.deepEqual(blocked, []);
  const bench = graphqlSent.filter((q) => q.bench).map((q) => q.query);
  assert.ok(bench.length > 0);
  assert.ok(!bench.some((q) => q === PERSON_GITHUB_QUERY || q === OWNED_REPOS_QUERY));
});
