import './fixtures/no-network-checks';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { sql } from './db';
import { ProgramFile } from './program-file';
import { listPrograms, upsertProgram } from './programs';
import { checkDefaults } from './verify';
import { freshPick } from './fresh-build';
import { STARTERS } from './starters';
import { STARTER_TEST_MAX_AGE_DAYS, starterAgeWarnings } from './program-file';
import { EVENT_LOG_FLAG } from './events';

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
const FAR = '2099-01-01T00:00:00Z';
const HOUR = 3_600_000;
const sharedUrl = process.env.DATABASE_URL;
const journeyDb = `earnkit_v211_journey_${process.pid}`;
let journeyUrl = '';

const R2_OFF = { R2_ACCOUNT_ID: undefined, R2_ACCESS_KEY_ID: undefined, R2_SECRET_ACCESS_KEY: undefined, R2_BUCKET: undefined };
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
    // v3 Stage 2: an upcoming file stays upcoming (it has no form yet).
    if (!raw.campaign && raw.status !== 'upcoming') Object.assign(raw, { status: 'active', ends_at: raw.ends_at ? FAR : raw.ends_at });
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
checkDefaults.txCounter = async () => 0;
// The real url_checks table (this journey's own database), not the suites' in-memory cache.
delete checkDefaults.cache;

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

// ---- The agent ---------------------------------------------------------------------------------

// ---- The journeys ------------------------------------------------------------------------------

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
