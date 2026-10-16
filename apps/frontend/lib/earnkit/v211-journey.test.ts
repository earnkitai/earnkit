import './fixtures/no-network-checks';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { zipSync } from 'fflate';
import { sql } from './db';
import { ProgramFile } from './program-file';
import { listPrograms, upsertProgram } from './programs';
import { tools } from './tools';
import { OLD_TOOL_NAMES } from './aliases';
import { deployToken } from './tokens';
import { launchLogo } from './token-logo';
import { TECHNICAL_TERMS, type TokenFlowDeps } from './token-launch';
import { checkDefaults } from './verify';
import type { DeployDeps } from './deploy';
import { ARC_CONTRACT as CONTRACT, TIPJAR_ABI, fakeArc } from './fixtures/arc-chain';
import { deploySite } from './hosting';
import { contextLine, freshPick } from './fresh-build';
import { STARTERS } from './starters';
import { STARTER_TEST_MAX_AGE_DAYS, starterAgeWarnings } from './program-file';
import { EVENT_LOG_FLAG } from './events';
import { ARC_TIPJAR_BYTECODE } from './fixtures/arc-tipjar-artifact';
import type { EventRow } from './fixtures/events';

/**
 * v2.11 Task 13: the success metric's journey. A fresh connection with no repos says yes once and
 * ends with a deployed contract, a hosted live link, a ready entry and a submit kit, through the 4
 * tools as an agent calls them.
 *
 * Real: every program file (Arc Microgrants names its fresh build, arc-tipjar), the starter registry
 * (starters.ts STARTERS), the switches (deploys and hosting read the env: the deployer key and the
 * R2 variables are set inside this file only, with fake values), the proof-line gate, the owner
 * proof (fetchLinePusher over GitHub's push record), the entry and confirm flows, the event log and
 * a throwaway database of its own (schema.sql, dropped after).
 *
 * Faked, the outside world only: GitHub (the account read, the user's repos, the new public repo,
 * its push record, commits and earnkit.txt), the deployer's chain (DeployChain), R2 (deploySite's
 * r2), the link probe and getCode (checkDefaults), the live page and icon (the logo), the sanctions
 * screen and tokens.fun's deploy API behind the real deployToken. Every other fetch gets a 503 and is
 * noted; 13.3 asserts nothing else tried the network.
 *
 * Clock: real time (the database's now() writes the events and the upload tokens, so a frozen JS
 * clock would disagree with it). Arc's close moves to 3 days and an hour from now; every other
 * curated program closes in 2099, as in the v2.10 journey. The real arc-tipjar test date must be
 * within 30 days of today, as the real fresh pick requires (13.0 says so plainly when it is not).
 */

const localDb = (() => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL ?? '').hostname);
  } catch {
    return false;
  }
})();
const dbTest = {
  skip: !process.env.DATABASE_URL ? 'no DATABASE_URL' : !localDb && 'DATABASE_URL is not a local Postgres',
};

const PROGRAMS_DIR = join(import.meta.dirname, '../../../../programs');
const SCHEMA = join(import.meta.dirname, '../../db/schema.sql');
const METRIC = join(import.meta.dirname, '../../scripts/v211-metric.mts');
const ROOT = join(import.meta.dirname, '../../../..');
const FAR = '2099-01-01T00:00:00Z';
const HOUR = 3_600_000;
const sharedUrl = process.env.DATABASE_URL;
const journeyDb = `earnkit_v211_journey_${process.pid}`;
let journeyUrl = '';

/** A deployer key made for this test only (never the payout, operator or guardian key). */
const DEPLOYER_KEY = '9a1c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
const R2_ON = { R2_ACCOUNT_ID: 'v211-acct', R2_ACCESS_KEY_ID: 'v211-akid', R2_SECRET_ACCESS_KEY: 's'.repeat(40), R2_BUCKET: 'earnkit-sites' };
const R2_OFF = { R2_ACCOUNT_ID: undefined, R2_ACCESS_KEY_ID: undefined, R2_SECRET_ACCESS_KEY: undefined, R2_BUCKET: undefined };
const DEPLOYS_ON = { DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY };
const DEPLOYS_OFF = { DEPLOYER_PRIVATE_KEY: undefined };

const savedEnv: Record<string, string | undefined> = {};
const ENV: Record<string, string | undefined> = {
  TOKENSFUN_DEPLOY_API_KEY: 'v211-journey-key',
  EARNKIT_AUTH_SECRET: process.env.EARNKIT_AUTH_SECRET || 'v211-journey-secret',
  // The event log is on here (the owner turns it on once /terms says what EarnKit records).
  [EVENT_LOG_FLAG]: 'on',
  // No sign-in and no App: the build path proves the owner from the earnkit.txt line alone.
  GITHUB_OAUTH_CLIENT_ID: undefined,
  GITHUB_OAUTH_CLIENT_SECRET: undefined,
  GITHUB_APP_ID: undefined,
  GITHUB_APP_SLUG: undefined,
  GITHUB_APP_PRIVATE_KEY: undefined,
  GITHUB_TOKEN: undefined,
  // Deploys and hosting are switched on per journey (withEnv).
  ...DEPLOYS_OFF,
  ...R2_OFF,
};

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
  journeyUrl = url.toString();
  const fresh = postgres(journeyUrl, { max: 1, onnotice: () => {} });
  try {
    await fresh.unsafe(readFileSync(SCHEMA, 'utf8'));
  } finally {
    await fresh.end();
  }
  process.env.DATABASE_URL = journeyUrl;
  for (const [k, v] of Object.entries(ENV)) {
    savedEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // Every real program file, as programs:sync loads it. Curated programs close in 2099 so the
  // journey never depends on real dates, except Arc Microgrants, the fresh build's program, which
  // closes in 3 days (the lead's window is 24 hours to 14 days).
  for (const f of readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(join(PROGRAMS_DIR, f), 'utf8'));
    if (!raw.campaign) Object.assign(raw, { status: 'active', ends_at: raw.ends_at ? FAR : raw.ends_at });
    if (raw.id === ARC) raw.ends_at = new Date(Date.now() + 3 * 24 * HOUR + HOUR).toISOString();
    await upsertProgram(ProgramFile.parse(raw));
  }
});

after(async () => {
  if (!sharedUrl || !localDb) return;
  await sql().end();
  globalThis.fetch = realFetch;
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

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const ARC = 'arc-microgrants';

// ---- The outside world -------------------------------------------------------------------------

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => json({ message: 'Not Found' }, 404);
const iso = (ms: number) => new Date(ms).toISOString();
const HEAD = 'c'.repeat(40);

/**
 * GitHub as each builder's agent leaves it. A login starts with no public repos. `createRepo` is
 * `gh repo create <name> --public` (no template, not a fork); `push` is the first push of main: one
 * root commit made just now, holding earnkit.txt, a branch creation a minute after the repo exists.
 */
type GhRepo = { owner: string; name: string; createdAt: number; pushedAt: number | null; commitAt: number | null; earnkitTxt: string | null };
const GITHUB = new Map<string, GhRepo>();
const reposOf = (login: string) => [...GITHUB.values()].filter((r) => r.owner === login);
function createRepo(owner: string, name: string) {
  GITHUB.set(`${owner}/${name}`.toLowerCase(), { owner, name, createdAt: Date.now() - 2 * 60_000, pushedAt: null, commitAt: null, earnkitTxt: null });
}
function push(owner: string, name: string, earnkitTxt: string) {
  const r = GITHUB.get(`${owner}/${name}`.toLowerCase())!;
  Object.assign(r, { commitAt: Date.now() - 30_000, pushedAt: Date.now() - 20_000, earnkitTxt });
}
const repoJson = (r: GhRepo) => ({
  name: r.name,
  full_name: `${r.owner}/${r.name}`,
  html_url: `https://github.com/${r.owner}/${r.name}`,
  homepage: null,
  default_branch: 'main',
  created_at: iso(r.createdAt),
  pushed_at: iso(r.pushedAt ?? r.createdAt),
  fork: false,
  archived: false,
  is_template: false,
  template_repository: null,
  private: false,
  visibility: 'public',
  owner: { login: r.owner, type: 'User' },
  description: null,
  topics: [],
});

const githubSeen: string[] = [];
function github(u: URL): Response {
  const p = u.pathname;
  githubSeen.push(`${u.host}${p}${u.search}`);
  if (u.host === 'raw.githubusercontent.com') {
    const [, owner, repo, ref, ...rest] = p.split('/');
    const r = GITHUB.get(`${owner}/${repo}`.toLowerCase());
    if (!r?.earnkitTxt || rest.join('/') !== 'earnkit.txt' || !['main', 'HEAD', HEAD].includes(ref)) return notFound();
    return new Response(r.earnkitTxt);
  }
  if (p === '/search/commits') return json({ items: [] });
  let m = p.match(/^\/users\/([^/]+)\/repos$/);
  if (m) return json(reposOf(decodeURIComponent(m[1])).filter((r) => r.pushedAt).map(repoJson));
  // v2.11 T9 R3: the public account read: every builder here is a two-year-old User.
  m = p.match(/^\/users\/([^/]+)$/);
  if (m) return json({ login: decodeURIComponent(m[1]), type: 'User', created_at: iso(Date.now() - 730 * 24 * HOUR), public_repos: 5 });
  m = p.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (m) {
    const r = GITHUB.get(`${m[1]}/${m[2]}`.toLowerCase());
    if (!r) return notFound();
    const rest = m[3] ?? '';
    if (rest === '') return json(repoJson(r));
    if (!r.pushedAt) return rest === '/activity' || rest === '/commits' ? json([]) : notFound();
    if (rest === '/activity')
      return json([{ activity_type: 'branch_creation', ref: 'refs/heads/main', before: '0'.repeat(40), after: HEAD, timestamp: iso(r.pushedAt), actor: { login: r.owner } }]);
    if (rest === '/commits')
      return json([{ sha: HEAD, parents: [], author: { login: r.owner }, commit: { author: { date: iso(r.commitAt!) }, committer: { date: iso(r.commitAt!) } } }]);
    if (rest === '/branches') return json([{ name: 'main' }]);
    if (rest === '/contents/earnkit.txt') return r.earnkitTxt ? new Response(r.earnkitTxt) : notFound();
    if (rest.startsWith('/git/trees/'))
      return json({ tree: [{ path: 'README.md', type: 'blob', size: 400 }, { path: 'earnkit.txt', type: 'blob', size: 40 }, { path: 'site/index.html', type: 'blob', size: 900 }] });
    if (rest.startsWith('/contents/')) return notFound();
  }
  return notFound();
}

/** The link probe and getCode: every link loads and every address has code. */
const probed: string[] = [];
checkDefaults.probe = async (url: string) => void probed.push(url);
checkDefaults.getCode = async () => '0x6080';
checkDefaults.blockscout = async () => ({ transactions_count: '0' });
// The real url_checks table (this journey's own database), not the suites' in-memory cache.
delete checkDefaults.cache;

/** The live site: its page names an icon; the icon is a PNG. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const logoDeps = {
  page: async (url: string) => `<html><head><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"></head><body>${url}</body></html>`,
  image: async () => PNG,
  preview: async () => null,
};

/** No network: GitHub is the fake above; every other host gets a 503 and is noted. */
const blocked: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const u = new URL(url);
  if (['api.github.com', 'github.com', 'raw.githubusercontent.com'].includes(u.host)) return github(u);
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return realFetch(input, init);
  blocked.push(url);
  return new Response('v211-journey: no network', { status: 503 });
}) as typeof fetch;

/** tokens.fun's deploy API, behind the real deployToken. */
type Sent = { symbol: string; address: string; wallet: string };
const launched: Sent[] = [];
const tokensFun = (async (_url: string, init: { body: string }) => {
  const body = JSON.parse(init.body) as { symbol: string; creatorWallet: string };
  const address = '0x' + String(launched.length + 1).padStart(40, 'b');
  launched.push({ symbol: body.symbol, address, wallet: body.creatorWallet.toLowerCase() });
  return json({ success: true, tokenAddress: address, txHash: '0x' + 'cd'.repeat(32), urls: { tokensfun: `https://tokens.fun/coin/${address}` } });
}) as unknown as typeof fetch;

/** The deployer's chain (Arc): one creation; owner() reads the constructor's owner, the builder. */
const sends: string[] = [];

/** R2, as deploySite writes to it. */
const r2Keys: string[] = [];
const r2 = { put: async (key: string) => void r2Keys.push(key), list: async () => [], del: async () => {}, copy: async () => {} };

// ---- The agent ---------------------------------------------------------------------------------

type Reply = Record<string, unknown> & { show_to_builder?: string; agent_note?: string };
type Said = { journey: string; label: string; text: string; reply: Reply; agentText: string };
const said: Said[] = [];

/** Every string a builder sees in a reply: show_to_builder, the kit (unless already in it), and a launch's builder words. */
function builderText(r: Reply): string {
  const shown = r.show_to_builder ?? '';
  const kit = (r.kit as { show_to_builder?: string } | undefined)?.show_to_builder;
  const token = r.token as { note?: string; sign_in_line?: string } | undefined;
  return [shown, kit && !shown.includes(kit) ? kit : undefined, token?.note, token?.sign_in_line]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .filter((x, i, all) => all.indexOf(x) === i)
    .join('\n');
}

const WALLET = '0x12ab34cd56ef7890a1b2c3d4e5f6a7b8c9d09f3e';
const TWIST = {
  twist: 'tips for my podcast listeners',
  name: 'PodTips',
  description: 'Podcast listeners tip the show in USDC on Arc.',
  feature: 'Each tip can carry a question for the podcast to answer on air.',
  for_whom: 'for your podcast listeners',
};

async function newInstallation(o: { shared?: boolean } = {}) {
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, shared_client)
    VALUES (${`v211-${process.pid}-${Date.now()}-${Math.random()}`}, ${o.shared ?? false}) RETURNING id`;
  return id;
}

/**
 * Final fix I4: the real registry with arc-tipjar tested today, so no journey depends on the real
 * date passing its tested_at (2026-11-10 and on). A test seam only: every other value, and the
 * 30-day rule itself (13.0), stay the real ones; programs:check warns the owner instead.
 */
const TODAY_STARTERS = { ...STARTERS, 'arc-tipjar': { ...STARTERS['arc-tipjar'], tested_at: new Date().toISOString().slice(0, 10) } };

/** What the MCP route would pass, plus the outside world's fakes and the registry seam (never the switches). */
function ctxFor(id: number, owner: () => string) {
  const tokenDeps: TokenFlowDeps = {
    available: () => true,
    limit: async () => {},
    check: async () => true,
    // The real gate (GitHub faked); only the sanctions screen (an RPC read) is stubbed.
    gate: { screen: async () => {} },
    deploy: (a) => deployToken(a, { fetch: tokensFun, sleep: async () => {} }),
    logo: (a) => launchLogo(a, logoDeps),
  };
  const deployDeps: DeployDeps = { chain: (c) => (c === 'arc' ? fakeArc(owner, sends) : null), usdPerNative: async () => 1 };
  return { installationId: id, ownInstallationId: id, tokenDeps, deployDeps, freshDeps: { starters: TODAY_STARTERS } };
}
type Ctx = ReturnType<typeof ctxFor>;

/** One call to one of the 4 tools, as the agent makes it; its builder-facing text kept. */
async function call(journey: string, label: string, tool: 'find' | 'prepare' | 'confirm' | 'tell', input: unknown, ctx: Ctx): Promise<Reply> {
  const reply = (await (tools[tool] as (i: unknown, c: unknown) => Promise<unknown>)(input, ctx)) as Reply;
  const text = builderText(reply);
  said.push({ journey, label, text, reply, agentText: JSON.stringify(reply) });
  if (process.env.V211_DUMP) console.log(`---- ${journey} ${label}\n${text}\n${JSON.stringify(reply).slice(0, 3000)}`);
  return reply;
}

/** The builder-visible lines of one journey, in order (empty replies left out: the builder sees nothing). */
const shown = (journey: string) => said.filter((s) => s.journey === journey && s.text !== '').map((s) => [s.label, s.text]);

type JourneyOut = {
  inst: number;
  login: string;
  repo: string;
  /** Every call, to replay for 13.2. */
  calls: [label: string, tool: 'find' | 'prepare' | 'confirm' | 'tell', input: unknown][];
  live: string;
  projectId: number;
  symbol: string | null;
  upload: Reply | null;
};

/**
 * The fresh connection, end to end. `token`: the builder's answer to the confirm line ('yes' or
 * 'skip'). `hosting`: EarnKit's R2 hosting, or GitHub Pages (hosting off).
 */
async function journey(name: string, login: string, o: { token: 'yes' | 'skip'; hosting: 'earnkit' | 'pages' }): Promise<JourneyOut> {
  const inst = await newInstallation();
  const ctx = ctxFor(inst, () => WALLET);
  const calls: JourneyOut['calls'] = [];
  const step = async (label: string, tool: 'find' | 'prepare' | 'confirm' | 'tell', input: unknown) => {
    calls.push([label, tool, input]);
    return call(name, label, tool, input, ctx);
  };
  // 1. The agent's first call: the builder's GitHub login (the kit asks for it; gh api user prints it), no repos.
  const found = await step('find', 'find', { github_user: login });
  const offer = found.build_offer as { program_id: string; starter_id: string } | undefined;
  assert.ok(offer, `${name}: build_offer\n${found.show_to_builder}`);
  // 2. The builder says yes, once.
  await step('yes to the lead', 'prepare', { program_id: offer.program_id, build: { start: true, program_id: offer.program_id } });
  // 3. The twist question, answered with the wallet.
  const twisted = await step('the twist and the wallet', 'prepare', { program_id: ARC, build: { program_id: ARC, ...TWIST, wallet: WALLET } });
  assert.ok(twisted.kit, `${name}: the kit`);
  // 4. Prepare the build: the repo first (kit.order), then build.repo_url for the proof line.
  createRepo(login, 'podtips');
  const repo = `https://github.com/${login}/podtips`;
  const withRepo = await step('the build with the repo', 'prepare', { program_id: ARC, build: { program_id: ARC, ...TWIST, wallet: WALLET, repo_url: repo } });
  const line = (withRepo.kit as { proof_line: string | null }).proof_line;
  assert.ok(line, `${name}: the proof line`);
  push(login, 'podtips', `${line}\n`);
  // 5. Deploy and host, in one call.
  const project = { name: 'PodTips', description: TWIST.description, repo_url: repo };
  const deploy = { chain: 'arc', bytecode: ARC_TIPJAR_BYTECODE, abi: TIPJAR_ABI, constructor_args: [WALLET, 'PodTips', '1000000'], owner_wallet: WALLET };
  const shipped = await step('deploy and host', 'prepare', { program_id: ARC, project, deploy, host: true, build: { program_id: ARC } });
  let live: string;
  let upload: Reply | null = null;
  if (o.hosting === 'earnkit') {
    const host = shipped.host as { upload_url?: string } | undefined;
    assert.ok(host?.upload_url, `${name}: the upload URL\n${JSON.stringify(shipped)}`);
    const token = new URL(host.upload_url).searchParams.get('t')!;
    const zip = zipSync({ 'index.html': new TextEncoder().encode('<!doctype html><html><body>PodTips</body></html>') });
    const up = await deploySite(token, zip, { r2 });
    upload = up.body as Reply;
    said.push({ journey: name, label: 'the upload (not shown: the agent is told)', text: '', reply: upload, agentText: JSON.stringify(upload) });
    live = String(upload.url);
  } else {
    assert.deepEqual(shipped.host, { github_pages: true, site_dir: 'site' }, name);
    live = `https://${login}.github.io/podtips/`;
  }
  // 6. The call after the live link: the live, deployed and confirm lines in one reply.
  const joined = await step('after the live link', 'prepare', { program_id: ARC, project: { ...project, live_url: live }, build: { program_id: ARC } });
  const entry = joined.entry as { project: Record<string, unknown>; answers: Record<string, string> };
  const proposed = (joined.token as { proposed: { name: string; symbol: string } }).proposed;
  // 7. The builder's answer to the confirm line.
  const base = { program_id: ARC, project: entry.project, answers: entry.answers };
  const confirmed =
    o.token === 'yes'
      ? await step('yes', 'confirm', { ...base, yes: true, wallet: joined.shown_wallet, token: { name: proposed.name, symbol: proposed.symbol } })
      : await step('skip the token', 'confirm', { ...base, skip_token: true });
  const projectId = Number(confirmed.project_id);
  // 9. Tell: submitted.
  await step('tell submitted', 'tell', { submitted: { program_id: ARC } });
  return { inst, login, repo, calls, live, projectId, symbol: o.token === 'yes' ? proposed.symbol : null, upload };
}

const events = async (inst: number) => [...(await sql()<EventRow[]>`SELECT * FROM builder_events WHERE installation_id = ${inst} ORDER BY id`)];


// ---- The journeys ------------------------------------------------------------------------------

const runs: Record<string, JourneyOut> = {};

const LEAD = 'Arc Microgrants pays 500 USDC and closes in 3 days. A USDC tip page on Arc takes about an hour. Want me to build it?';
const TWIST_Q = 'What should it do for you or your users? One line is enough, like "tips for my podcast listeners". Add the wallet that should own it.';
const BUILDING = "Building PodTips: a USDC tip page on Arc for your podcast listeners. I'll be back with the live link.";
const DEPLOYED = "PodTips is deployed on Arc: 0x0000…11ce. You're the owner.";
const CONFIRM = 'Yes submits your entry and launches $PODTIP (PodTips): 40% of its fees to you, plus the builder bonus. Wallet: 0x12ab…9f3e. yes / skip the token';
/** The v2.10 no-repo line: the reply whenever there is no fresh pick. */
const V210_LINE = /^(\$[\d.,]+[KM]?\+?|Money) is open\. Want the 3 easiest\?$/;

/** The submit kit for Arc Microgrants (DoraHacks: copy and paste; the builder clicks submit). */
const kitText = (login: string, live: string) =>
  [
    'Ready for Arc Microgrants. Paste each answer into the form:',
    'Form: https://dorahacks.io/hackathon/arc-microgrants',
    '',
    'Live deployment on Arc mainnet',
    live,
    '',
    'Public repo',
    `https://github.com/${login}/podtips`,
    '',
    'Short description of what your project does and what it uses Arc for',
    'Podcast listeners tip the show in USDC on Arc.',
    '',
    'Public builder profile',
    `https://github.com/${login}`,
    '',
    'After you submit, paste your entry link here.',
  ].join('\n');

/** Every line the builder sees, in order, for one journey. `tokens`: the round's token count after this launch. */
async function expectedLines(j: JourneyOut, o: { token: 'yes' | 'skip'; liveLine: string; liveInKit: string; tokens?: number }) {
  const context = contextLine(await listPrograms(), new Date());
  assert.ok(context);
  assert.match(context, /^\$[\d.,]+[KM]?\+? in prizes is open right now across \d+ programs\.$/);
  const coin = o.token === 'yes' ? launched.find((l) => l.wallet === WALLET && said.some((s) => s.journey === j.login && s.text.includes(l.address)))! : null;
  const tokenLink = coin && `tokens.fun/coin/${coin.address}`;
  return [
    ['find', `${context}\n${LEAD}`],
    ['yes to the lead', TWIST_Q],
    ['the twist and the wallet', BUILDING],
    ['after the live link', [o.liveLine, DEPLOYED, CONFIRM].join('\n')],
    o.token === 'yes'
      ? ['yes', `Your token $PODTIP is live: ${tokenLink}.\n\n${kitText(j.login, o.liveInKit)}`]
      : ['skip the token', `No token, no builder bonus.\n\n${kitText(j.login, o.liveInKit)}`],
    o.token === 'yes'
      ? [
          'tell submitted',
          [
            `Entered in Arc Microgrants. Your token: ${tokenLink}.`,
            'Send me your dorahacks.io entry link to join the builder bonus.',
            `Builder bonus: ${o.tokens} token${o.tokens === 1 ? '' : 's'} in, fees coming`,
            'This entry already has its token.',
          ].join('\n'),
        ]
      : ['tell submitted', 'Entered in Arc Microgrants.\nThis entry was entered without a token.'],
  ];
}

/**
 * The events of one journey: built, deployed, hosted, entered, submitted, once each, in that order,
 * each with its proof, the builder's login and how it was proven (proof_line: no sign-in here).
 */
async function assertEvents(j: JourneyOut, hosted: { proof_url: string; detail: Record<string, unknown> }) {
  const rows = await events(j.inst);
  assert.deepEqual(rows.map((e) => e.type), ['built', 'deployed', 'hosted', 'entered', 'submitted']);
  for (const e of rows) {
    assert.equal(e.github_login, j.login, e.type);
    assert.equal(e.login_basis, 'proof_line', e.type);
    assert.equal(e.repo_key, `${j.login}/podtips`, e.type);
  }
  const [built, deployed, host, entered, submitted] = rows;
  assert.deepEqual(
    { proof_url: built.proof_url, wallet: built.wallet, program_id: built.program_id, detail: built.detail, dedupe_key: built.dedupe_key },
    { proof_url: j.repo, wallet: WALLET, program_id: ARC, detail: { twist: TWIST.twist, starter: 'arc-tipjar' }, dedupe_key: `built:${j.inst}:${j.login}/podtips:${ARC}` },
  );
  assert.deepEqual(
    { proof_tx: deployed.proof_tx, chain: deployed.chain, wallet: deployed.wallet, detail: deployed.detail },
    { proof_tx: `0x${'ab'.repeat(32)}`, chain: 'arc', wallet: WALLET, detail: { block: 4242, address: CONTRACT, starter: 'arc-tipjar', owner_ok: true } },
  );
  assert.deepEqual({ proof_url: host.proof_url, detail: host.detail }, hosted);
  assert.deepEqual(
    { proof_url: entered.proof_url, program_id: entered.program_id, project_id: entered.project_id },
    { proof_url: `https://earnkit.com/p/${j.projectId}`, program_id: ARC, project_id: j.projectId },
  );
  assert.deepEqual(
    { program_id: submitted.program_id, project_id: submitted.project_id, detail: submitted.detail },
    { program_id: ARC, project_id: j.projectId, detail: { basis: 'builder_said' } },
  );
}

/** The entry is ready: recorded at the confirm step with the build's links and contract, the kit complete, then submitted. */
async function assertReadyEntry(j: JourneyOut, choice: string) {
  const confirm = said.find((s) => s.journey === j.login && ['yes', 'skip the token'].includes(s.label))!.reply;
  const kit = confirm.kit as { mode: string; missing: unknown[] };
  assert.equal(kit.mode, 'copy_paste');
  assert.deepEqual(kit.missing, []);
  const [p] = await sql()<{ program_id: string; repo_url: string; live_url: string; contract_verified_at: Date | null; confirmed_at: Date | null; confirm_choice: string; submission_confirmed_at: Date | null; installation_id: number }[]>`
    SELECT program_id, repo_url, live_url, contract_verified_at, confirmed_at, confirm_choice, submission_confirmed_at, installation_id FROM projects WHERE id = ${j.projectId}`;
  assert.equal(p.program_id, ARC);
  assert.equal(p.installation_id, j.inst);
  assert.equal(p.repo_url, j.repo);
  assert.equal(p.live_url.replace(/\/$/, ''), j.live.replace(/\/$/, ''));
  // The entry carries the contract EarnKit deployed, checked on Arc.
  const joined = said.find((s) => s.journey === j.login && s.label === 'after the live link')!.reply;
  assert.deepEqual((joined.entry as { project: { contracts: string[] } }).project.contracts, [CONTRACT]);
  assert.ok(p.contract_verified_at, 'the contract checked');
  assert.ok(p.confirmed_at, 'confirmed');
  assert.equal(p.confirm_choice, choice);
  assert.ok(p.submission_confirmed_at, 'submitted');
}

/** The builder said yes to the build exactly once: one yes/no question about building, one build.start, no other yes before the confirm line. */
function assertOneYes(j: JourneyOut) {
  const replies = said.filter((s) => s.journey === j.login);
  const confirmAt = replies.findIndex((s) => s.text.includes('yes / skip the token'));
  assert.ok(confirmAt > 0);
  const asked = replies.slice(0, confirmAt).filter((s) => s.text.includes('?'));
  assert.deepEqual(asked.map((s) => s.label), ['find', 'yes to the lead'], 'before the confirm line: the lead (the one yes) and the twist (an answer, not a yes)');
  assert.ok(asked[0].text.endsWith('Want me to build it?'));
  assert.ok(!/\b(yes|no)\b/i.test(asked[1].text), 'the twist question is not a yes/no');
  assert.equal(j.calls.filter(([, , input]) => JSON.stringify(input).includes('"start":true')).length, 1, 'one build.start');
}

test('13.0 the real registry: Arc names arc-tipjar; the 30-day rule still stops a stale starter (the date is injected, never the real one)', dbTest, async () => {
  const arc = (await listPrograms()).find((p) => p.id === ARC)!;
  assert.deepEqual(arc.fresh_build, { starter: 'arc-tipjar' });
  const now = new Date();
  const day = (ago: number) => new Date(now.getTime() - ago * 24 * HOUR).toISOString().slice(0, 10);
  const pick = (testedAt: string) =>
    freshPick([arc], now, { hidden: new Set(), entered: new Set(), deployOn: () => true, hostOn: true, starters: { ...STARTERS, 'arc-tipjar': { ...STARTERS['arc-tipjar'], tested_at: testedAt } } });
  assert.equal(pick(day(0))?.starter.id, 'arc-tipjar', 'tested today');
  assert.equal(pick(day(STARTER_TEST_MAX_AGE_DAYS))?.starter.id, 'arc-tipjar', 'exactly 30 days');
  assert.equal(pick(day(STARTER_TEST_MAX_AGE_DAYS + 1)), undefined, 'production unchanged: a stale starter is never offered');
  // The alarm is programs:check's warning now, never a red test (final fix I4).
  assert.deepEqual(starterAgeWarnings([arc], now, { ...STARTERS, 'arc-tipjar': { ...STARTERS['arc-tipjar'], tested_at: day(10) } }), []);
  assert.match(starterAgeWarnings([arc], now, { ...STARTERS, 'arc-tipjar': { ...STARTERS['arc-tipjar'], tested_at: day(24) } })[0], /^arc-tipjar tested 24 days ago/);
});

test('13.1 the full path, EarnKit hosting: a fresh connection with no repos says yes once and ends with a deployed contract, a hosted live link, a ready entry and the submit kit', dbTest, async () => {
  const sent = sends.length;
  await withEnv({ ...DEPLOYS_ON, ...R2_ON }, async () => {
    runs.yes = await journey('podmaker', 'podmaker', { token: 'yes', hosting: 'earnkit' });
  });
  const j = runs.yes;
  assert.equal(j.live, 'https://podtips-podmaker.earnkit.com');
  const liveLine = 'PodTips is live: podtips-podmaker.earnkit.com';
  assert.deepEqual(shown('podmaker'), await expectedLines(j, { token: 'yes', liveLine, liveInKit: 'https://podtips-podmaker.earnkit.com/', tokens: 1 }));
  // The calls between the twist and the joined reply show the builder nothing: the repo_url call
  // (nothing new), the deploy-and-host call (the deployed line waits) and the upload (its own live
  // line waits for the joined reply: the agent is told not to show it).
  const quiet = said.filter((s) => s.journey === 'podmaker' && s.text === '').map((s) => s.label);
  assert.deepEqual(quiet, ['the build with the repo', 'deploy and host', 'the upload (not shown: the agent is told)']);
  const ship = said.find((s) => s.journey === 'podmaker' && s.label === 'deploy and host')!.reply;
  assert.equal(ship.show_to_builder, '');
  assert.match(ship.agent_note ?? '', /Don't show the upload's show_to_builder/);
  assert.deepEqual(ship.deploy, { address: CONTRACT, chain: 'arc', owner_ok: true });
  assert.equal(j.upload?.show_to_builder, liveLine);
  // One deploy (constructor_args[0], the owner, is the builder's wallet); one launch, to that wallet.
  assert.equal(sends.length - sent, 1);
  assert.deepEqual(launched.map((l) => [l.symbol, l.wallet]), [['PODTIP', WALLET]]);
  assert.ok(r2Keys.some((k) => k.includes('podtips-podmaker')), 'the site went to R2');
  assertOneYes(j);
  await assertEvents(j, { proof_url: 'https://podtips-podmaker.earnkit.com', detail: { host: 'earnkit', slug: 'podtips-podmaker' } });
  await assertReadyEntry(j, 'go');
  const [{ fresh_offer_at }] = await sql()<{ fresh_offer_at: Date | null }[]>`SELECT fresh_offer_at FROM installations WHERE id = ${j.inst}`;
  assert.ok(fresh_offer_at, 'the metric starts at the lead');
});

test('13.2 a rerun of every call writes no new event, deploys nothing and launches nothing', dbTest, async () => {
  const j = runs.yes;
  const before = await events(j.inst);
  const [offer] = await sql()<{ fresh_offer_at: Date }[]>`SELECT fresh_offer_at FROM installations WHERE id = ${j.inst}`;
  const [sent, coins] = [sends.length, launched.length];
  await withEnv({ ...DEPLOYS_ON, ...R2_ON }, async () => {
    const ctx = ctxFor(j.inst, () => WALLET);
    for (const [label, tool, input] of j.calls) await call('rerun', label, tool, input, ctx);
  });
  assert.deepEqual((await events(j.inst)).map((e) => e.id), before.map((e) => e.id));
  assert.equal(sends.length, sent, 'no second deploy');
  assert.equal(launched.length, coins, 'no second launch');
  const [again] = await sql()<{ fresh_offer_at: Date }[]>`SELECT fresh_offer_at FROM installations WHERE id = ${j.inst}`;
  assert.equal(again.fresh_offer_at.getTime(), offer.fresh_offer_at.getTime(), 'fresh_offer_at is set once');
});

test('13.4 "skip the token": the same path ends with a ready entry and the kit, no token, and the same five events', dbTest, async () => {
  const coins = launched.length;
  await withEnv({ ...DEPLOYS_ON, ...R2_ON }, async () => {
    runs.skip = await journey('quietmaker', 'quietmaker', { token: 'skip', hosting: 'earnkit' });
  });
  const j = runs.skip;
  assert.deepEqual(
    shown('quietmaker'),
    await expectedLines(j, { token: 'skip', liveLine: 'PodTips is live: podtips-quietmaker.earnkit.com', liveInKit: 'https://podtips-quietmaker.earnkit.com/' }),
  );
  assert.equal(launched.length, coins, 'no launch');
  assertOneYes(j);
  await assertEvents(j, { proof_url: 'https://podtips-quietmaker.earnkit.com', detail: { host: 'earnkit', slug: 'podtips-quietmaker' } });
  await assertReadyEntry(j, 'skip');
});

test('13.4 hosting off (no R2): the GitHub Pages fallback reaches the same ready entry and kit', dbTest, async () => {
  await withEnv({ ...DEPLOYS_ON, ...R2_OFF }, async () => {
    runs.pages = await journey('pagesmaker', 'pagesmaker', { token: 'yes', hosting: 'pages' });
  });
  const j = runs.pages;
  assert.deepEqual(
    shown('pagesmaker'),
    await expectedLines(j, { token: 'yes', liveLine: 'PodTips is live: pagesmaker.github.io/podtips', liveInKit: 'https://pagesmaker.github.io/podtips/', tokens: 2 }),
  );
  const ship = said.find((s) => s.journey === 'pagesmaker' && s.label === 'deploy and host')!.reply;
  assert.equal(ship.show_to_builder, '');
  assertOneYes(j);
  await assertEvents(j, { proof_url: 'https://pagesmaker.github.io/podtips/', detail: { host: 'github_pages' } });
  await assertReadyEntry(j, 'go');
});

test('13.4 fail closed: the same fresh connection with deploys off (and with R2 only) gets the v2.10.2 reply byte for byte, no build_offer, no fresh_offer_at, and no build', dbTest, async () => {
  for (const [label, vars] of [['deploys and hosting off', { ...DEPLOYS_OFF, ...R2_OFF }], ['R2 only', { ...DEPLOYS_OFF, ...R2_ON }]] as const) {
    const login = `offmaker${label.length}`;
    const inst = await newInstallation();
    const ctx = ctxFor(inst, () => WALLET);
    await withEnv(vars, async () => {
      const first = await call('off', `${label}: find`, 'find', { github_user: login }, ctx);
      assert.match(first.show_to_builder ?? '', V210_LINE, label);
      assert.ok(!('build_offer' in first), label);
      // The second call (the first carries the one-time schedule_daily_check), then the same call
      // with no fresh_build on Arc at all: v2.10.2's reply, byte for byte.
      const second = JSON.stringify(await call('off', `${label}: find again`, 'find', { github_user: login }, ctx));
      const [{ fresh_build }] = await sql()<{ fresh_build: unknown }[]>`SELECT fresh_build FROM programs WHERE id = ${ARC}`;
      await sql()`UPDATE programs SET fresh_build = NULL WHERE id = ${ARC}`;
      try {
        assert.equal(JSON.stringify(await call('off', `${label}: find, no fresh_build`, 'find', { github_user: login }, ctx)), second, label);
      } finally {
        await sql()`UPDATE programs SET fresh_build = ${sql().json(fresh_build as never)} WHERE id = ${ARC}`;
      }
      // An agent that tries the build anyway gets an agent note only; nothing is stored.
      const start = await call('off', `${label}: build.start`, 'prepare', { program_id: ARC, build: { start: true, program_id: ARC } }, ctx);
      assert.equal(start.show_to_builder, '', label);
      assert.match(start.agent_note ?? '', /can't start a build/, label);
    });
    const [row] = await sql()<{ fresh_offer_at: Date | null; build: unknown }[]>`SELECT fresh_offer_at, build FROM installations WHERE id = ${inst}`;
    assert.deepEqual({ ...row }, { fresh_offer_at: null, build: null }, label);
    assert.deepEqual(await events(inst), [], label);
  }
});

test('13.3 every reply: at most one "?"; the copy rules; "40%" only on the confirm line; no address outside the deployed line; no wallet the builder didn\'t give; nothing else on the network', dbTest, () => {
  assert.ok(said.length >= 30, `${said.length} replies`);
  const coinWords = (text: string) =>
    text
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\b[\w-]+(?:\.[\w-]+)+\/\S*/g, ' ')
      .match(/\bcoins?\b/gi) ?? [];
  const toolName = new RegExp(
    `\\b(${[...OLD_TOOL_NAMES, 'sponsor_campaign'].join('|')})\\b|\\bcall(s|ing)? (find|prepare|confirm|tell)\\b|\\b(find|prepare|confirm|tell)( with\\b|\\()|\\bthe (find|prepare|confirm|tell) tool\\b`,
  );
  for (const s of said) {
    const where = `${s.journey} ${s.label}: ${s.text}`;
    const text = s.text;
    assert.ok((text.match(/\?/g) ?? []).length <= 1, where);
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, where);
    assert.doesNotMatch(s.agentText, /—/, where);
    assert.doesNotMatch(s.agentText, /clanker/i, where);
    assert.doesNotMatch(text, /\bvaults?\b/i, where);
    assert.deepEqual(coinWords(text), [], where);
    assert.doesNotMatch(text, toolName, where);
    assert.doesNotMatch(s.reply.show_to_builder ?? '', TECHNICAL_TERMS, where);
    assert.doesNotMatch(text, /\bWETH\b|\bgas\b|token-creator-agreement|risk-disclosure|\/terms\b/, where);
    for (const line of text.split('\n')) {
      if (/\bskip\b/i.test(line)) assert.match(line, /\/ skip the token$|^No token, no builder bonus\.$/, where);
      if (line.includes('40%')) assert.equal(line, CONFIRM, where);
      // Addresses: the contract only in the deployed line, the wallet only in the confirm line (the
      // one the builder gave), and full addresses only inside the token's own tokens.fun link.
      const short = line.match(/0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}/g) ?? [];
      for (const a of short) {
        if (a === '0x0000…11ce') assert.match(line, /^PodTips is deployed on Arc: /, where);
        else {
          assert.equal(a, '0x12ab…9f3e', where);
          assert.match(line, /^Yes submits your entry and launches /, where);
        }
      }
      assert.doesNotMatch(line.replace(/tokens\.fun\/coin\/0x[0-9a-f]{40}/g, ''), /0x[0-9a-fA-F]{6,}/, where);
    }
  }
  // "40%" once per journey, on the confirm line (the rerun's confirm line drops it: said once).
  for (const j of ['podmaker', 'quietmaker', 'pagesmaker'])
    assert.equal(said.filter((s) => s.journey === j).reduce((n, s) => n + (s.text.match(/40%/g)?.length ?? 0), 0), 1, j);
  assert.equal(said.filter((s) => s.journey === 'rerun').reduce((n, s) => n + (s.text.match(/40%/g)?.length ?? 0), 0), 0);
  // Nothing tried the network but the soft price reads that fail closed (DefiLlama).
  assert.deepEqual(blocked.filter((u) => !u.startsWith('https://coins.llama.fi/')), []);
});

test('13.5 the metric script, owner-run and read-only, counts the journeys: shared, chat-only and unfinished sessions apart, no target', dbTest, async () => {
  const run = (asOf: Date) => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', METRIC, '--as-of', asOf.toISOString()], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: journeyUrl },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const day = 24 * HOUR;
  const later = new Date(Date.now() + day + HOUR);
  const out = run(later);
  assert.match(out, /^v2\.11 metric: no-repo builders who shipped in their first session\. Shown, never a target\.$/m);
  assert.match(out, /^3 of 3 no-repo builders shipped in their first session \(100%\)$/m, out);
  assert.doesNotMatch(out, /target:|goal:/i);
  // Before the sessions end, nothing is called shipped or not yet.
  assert.match(run(new Date(Date.now() + HOUR)), /^No no-repo builder has finished a first session yet\.$/m);

  // Others, read the same way: a shared client (left out), a chat-only client that never started a
  // build (shown the lead only), a build that stopped at the deploy, one that shipped after its first
  // 24 hours, and one still inside them.
  const db = sql();
  const offer = new Date(Date.now() - HOUR);
  const add = async (o: { shared?: boolean; build?: boolean; offer?: Date; events?: [string, number][] }) => {
    const id = await newInstallation({ shared: o.shared });
    await db`UPDATE installations SET fresh_offer_at = ${o.offer ?? offer},
      build = ${o.build ? db.json({ program_id: ARC, starter_id: 'arc-tipjar', started_at: (o.offer ?? offer).toISOString() }) : null} WHERE id = ${id}`;
    for (const [type, afterMs] of o.events ?? [])
      await db`INSERT INTO builder_events (at, type, installation_id, dedupe_key) VALUES (${new Date((o.offer ?? offer).getTime() + afterMs)}, ${type}, ${id}, ${`v211-metric:${type}:${id}`})`;
  };
  const all: [string, number][] = [['deployed', HOUR], ['hosted', HOUR], ['entered', HOUR]];
  await add({ shared: true, build: true, events: all });
  await add({ build: false });
  await add({ build: true, events: [['deployed', HOUR]] });
  await add({ build: true, events: [['deployed', HOUR], ['hosted', HOUR], ['entered', day + HOUR]] });
  await add({ build: true, offer: new Date(later.getTime() - HOUR), events: all });
  const more = run(later);
  assert.match(more, /^Shown the build lead \(shared clients left out\): 7$/m, more);
  assert.match(more, /^Said yes to the build: 6$/m);
  assert.match(more, /^Still in their first 24 hours \(left out of the share\): 1$/m);
  assert.match(more, /^Shipped in their first 24 hours \(deployed, hosted and entered with the submit kit\): 3$/m);
  assert.match(more, /^3 of 5 no-repo builders shipped in their first session \(60%\)$/m);
  // Final fix M2 (b): the second share counts only builds that reached a repo (the 3 journeys here).
  assert.match(more, /^3 of 3 whose agent made the repo shipped in their first session \(100%\)$/m, more);
  // Read-only: the script changed nothing.
  const [{ n }] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events`;
  run(later);
  assert.equal((await db<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events`)[0].n, n);
});
