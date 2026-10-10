import './fixtures/no-network-checks';
import { withoutQuotedFacts } from './fixtures/quoted-facts';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { decodeFunctionData, keccak256, parseTransaction, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sql } from './db';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { handlers, tools } from './tools';
import { OLD_TOOL_NAMES, aliasCall } from './aliases';
import { tokenLineFor } from './token-gate';
import { deployToken } from './tokens';
import { TECHNICAL_TERMS, type TokenFlowDeps } from './token-launch';
import { CANT_PUSH } from './confirm';
import { checkDefaults } from './verify';
import { LIVE_FAILED_LINE, PLACEHOLDER_LINE } from './placeholder';
import { verifyCallback, verifyConfirm, verifyStart } from './github-verify';
import { BASE_BONUS, FEE_LOCKER_ABI, type BonusRpc } from './bonus-ledger';
import { runCron } from './cron';
import { MINI_FEE_RECIPIENT } from './policy';
import type { FetchResult } from './ownership';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { strToU8, zipSync } from 'fflate';
import { HOST_LINES, HOST_REVIEW, UPLOAD_NOTE, expireSites, hostSignInLine, hostTakedownPost, hostUploadPost, sitesInReview } from './hosting';
import { HOST_HEADERS } from './host-names';
import type { R2 } from './r2';
import { ENDED_PAGE, handle as workerHandle } from '../../../../infra/host-worker/src/route';
import {
  EMAIL_NOTE,
  EMAIL_ON,
  EMAIL_QUESTION,
  EMAIL_SIGN_IN,
  UNSUB_CONFIRM,
  UNSUB_DONE,
  digestUnsubscribeGet,
  digestUnsubscribePost,
  sendDigests,
  type Mailer,
} from './digest';
import { periodKey } from './free-tier';
import { OutcomeFile, syncOutcomeFile } from './outcomes';
import { readStats, readWonUsd, wonSource } from './stats';
import { readLanding } from './landing';
import { listPrograms } from './programs';
import { moneyText, openMoneyUsd } from './pool';
import { LEGAL_REDIRECTS } from '../../next.config';
import TermsPage from '../../app/terms/page';
import { FOOTER_COLUMNS } from './footer-links';

// The app's pages use the classic JSX runtime under tsx (as public-pages.test.ts does).
(globalThis as { React?: typeof React }).React = React;

/**
 * v2.9 Task 12, Part 1 slice (Ruling G1): builder journeys through the real tools layer for what
 * Part 1 ships: owned repos and the real-product score (T2), tell_earnkit (T3), row difficulty (T4),
 * link and contract checks (T1), Sign in with GitHub (T5), the token offer after the match (T6) and
 * the automatic creator and MINI claims (T9). Every real program file; a throwaway database of its
 * own (as v281-journey.test.ts).
 *
 * Mocks only the outside world: GitHub (REST, raw files and the OAuth endpoints), tokens.fun
 * (check-ticker and the deploy API behind the real deployToken), the link probe and RPC getCode
 * (verify.ts checkDefaults), and the chain under the cron's claims. Every other fetch gets a 503 and
 * is noted; the last test asserts nothing else tried the network.
 *
 * Part 2 (T12 Part 2 slice): hosting (12.3, R2 in memory and the Worker over it), the weekly email
 * (12.10, Resend recorded), the won line (12.8), the one money figure (12.9), /terms (12.11) and Also
 * qualifies' precision (12.6b, Ruling G15 M1).
 *
 * Asserted across every reply: "40%" exactly once per entry flow; "skip" only as "skip the token" (v2.10); no
 * emoji, em dash, "coin", "vault", "Clanker" or tool name in builder text; every reply under 50 s.
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
const sharedUrl = process.env.DATABASE_URL;
const journeyDb = `earnkit_v29_journey_${process.pid}`;
const savedEnv: Record<string, string | undefined> = {};
const ENV: Record<string, string | undefined> = {
  TOKENSFUN_DEPLOY_API_KEY: 'v29-journey-key',
  EARNKIT_AUTH_SECRET: process.env.EARNKIT_AUTH_SECRET || 'v29-journey-secret',
  // Sign-in is switched on per journey (withSignIn); off by default, as in production until the owner sets it.
  GITHUB_OAUTH_CLIENT_ID: undefined,
  GITHUB_OAUTH_CLIENT_SECRET: undefined,
  GITHUB_TOKEN: undefined,
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
  // Every real program file, as programs:sync loads it; curated programs open with a 2099 deadline
  // so the journeys never depend on real dates (campaign files keep their status).
  for (const f of readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(join(PROGRAMS_DIR, f), 'utf8'));
    if (!raw.campaign) Object.assign(raw, { status: 'active', ends_at: raw.ends_at ? FAR : raw.ends_at });
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

// ---- The outside world -------------------------------------------------------------------------

const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const README = `# TipJar\n\n${'Fans tip creators in USDC on Arc; payouts settle in seconds. '.repeat(40)}`;

type GhRepo = Record<string, unknown> & { name: string; full_name: string; html_url: string };
const ghRepo = (owner: string, name: string, extra: Record<string, unknown> = {}): GhRepo => ({
  name,
  full_name: `${owner}/${name}`,
  html_url: `https://github.com/${owner}/${name}`,
  homepage: null,
  default_branch: 'main',
  created_at: daysAgo(120),
  pushed_at: daysAgo(2),
  fork: false,
  archived: false,
  is_template: false,
  owner: { login: owner },
  description: null,
  topics: [],
  ...extra,
});

/** GitHub as each journey's builder has it: their repos by owner, and every repo by full name. */
const GITHUB = {
  users: new Map<string, GhRepo[]>(),
  repos: new Map<string, GhRepo>(),
  /** OAuth: the login each one-time code signs in as (GitHub's authorize step, done in the browser). */
  oauthCodes: new Map<string, string>(),
  /** A repo's hardhat.config.ts (chain ids, RPC hosts and contract addresses matching reads). */
  configs: new Map<string, string>(),
  /** When a login's GitHub account was made (the hosting gate); 2019 by default. */
  accountCreated: new Map<string, string>(),
};
function addRepos(owner: string, repos: GhRepo[]) {
  GITHUB.users.set(owner, [...(GITHUB.users.get(owner) ?? []), ...repos]);
  for (const r of repos) GITHUB.repos.set(r.full_name.toLowerCase(), r);
}

/** The link probe: these hosts don't load. */
const DOWN = new Set<string>();
/** RPC getCode: these addresses have no code. */
const NO_CODE = new Set<string>();
const probed: string[] = [];
checkDefaults.probe = async (url: string) => {
  probed.push(url);
  if (DOWN.has(new URL(url).hostname)) throw new Error('down');
};
checkDefaults.getCode = async (_rpc: string, address: string) => (NO_CODE.has(address.toLowerCase()) ? '0x' : '0x6080');
// The real url_checks table (this journey's own database), not the suites' in-memory cache.
delete checkDefaults.cache;

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => json({ message: 'Not Found' }, 404);

function github(u: URL, init?: RequestInit): Response {
  const auth = new Headers(init?.headers).get('authorization');
  const p = u.pathname;
  if (u.host === 'github.com' && p === '/login/oauth/access_token') {
    const { code } = JSON.parse(String(init?.body ?? '{}')) as { code?: string };
    return code && GITHUB.oauthCodes.has(code) ? json({ access_token: `gho_${code}` }) : json({ error: 'bad_verification_code' });
  }
  if (u.host === 'raw.githubusercontent.com') {
    const [, owner, repo] = p.split('/');
    if (!GITHUB.repos.has(`${owner}/${repo}`.toLowerCase())) return notFound();
    if (p.toLowerCase().endsWith('/readme.md')) return new Response(README);
    const config = GITHUB.configs.get(`${owner}/${repo}`.toLowerCase());
    return p.endsWith('/hardhat.config.ts') && config ? new Response(config) : notFound();
  }
  // The OAuth token's own reads (github-verify.ts githubOAuth).
  if (auth?.startsWith('Bearer gho_')) {
    const login = GITHUB.oauthCodes.get(auth.slice('Bearer gho_'.length))!;
    if (p === '/user') return json({ login, created_at: GITHUB.accountCreated.get(login) ?? '2019-01-01T00:00:00Z', public_repos: 4 });
    const m = p.match(/^\/repos\/([^/]+)\/([^/]+)$/);
    const r = m && GITHUB.repos.get(`${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`.toLowerCase());
    if (!r) return notFound();
    const owner = (r.owner as { login: string }).login.toLowerCase();
    return json({ ...r, permissions: { push: owner === login.toLowerCase(), admin: owner === login.toLowerCase() } });
  }
  let m = p.match(/^\/users\/([^/]+)\/repos$/);
  if (m) return json(GITHUB.users.get(decodeURIComponent(m[1]).toLowerCase()) ?? []);
  if (p === '/search/commits') return json({ items: [] });
  m = p.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (m) {
    const r = GITHUB.repos.get(`${m[1]}/${m[2]}`.toLowerCase());
    if (!r) return notFound();
    const rest = m[3] ?? '';
    if (rest === '') return json(r);
    if (rest.startsWith('/git/trees/'))
      return json({
        tree: [
          { path: 'README.md', type: 'blob', size: README.length },
          { path: 'src/index.ts', type: 'blob', size: 900 },
          ...(GITHUB.configs.has(r.full_name.toLowerCase()) ? [{ path: 'hardhat.config.ts', type: 'blob', size: 300 }] : []),
        ],
      });
    if (rest === '/commits') {
      // The builder's commit in the last 90 days (active); the repo's last 100 commits, all the owner's.
      const owner = (r.owner as { login: string }).login;
      return json(u.searchParams.has('author') ? [{ sha: 'a' }] : Array.from({ length: 20 }, () => ({ sha: 'b', author: { login: owner } })));
    }
  }
  return notFound();
}

/** No network: GitHub is the mock above; every other host gets a 503 and is noted. */
const blocked: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const u = new URL(url);
  if (['api.github.com', 'github.com', 'raw.githubusercontent.com'].includes(u.host)) return github(u, init);
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return realFetch(input, init);
  blocked.push(url);
  return new Response('v29-journey: no network', { status: 503 });
}) as typeof fetch;

/** tokens.fun's check-ticker: these are taken. */
const TAKEN = new Set(['TIPJAR']);
const deployed: { symbol: string; address: string; wallet: string }[] = [];
/** tokens.fun's deploy API, behind the real deployToken. */
const tokensFun = (async (_url: string, init: { body: string }) => {
  const body = JSON.parse(init.body) as { symbol: string; creatorWallet: string };
  const address = '0x' + String(deployed.length + 1).padStart(40, 'b');
  deployed.push({ symbol: body.symbol, address, wallet: body.creatorWallet });
  return json({ success: true, tokenAddress: address, txHash: '0x' + 'cd'.repeat(32), urls: { tokensfun: `https://tokens.fun/coin/${address}` } });
}) as unknown as typeof fetch;

/** Every installation's proof line, in the repos whose owner pushed it (`PUSHED`). */
const OWNERS = new Set<number>();
const PUSHED = new Set<string>();
const earnkitTxt = async (r: { owner: string; repo: string }): Promise<FetchResult> => {
  if (!PUSHED.has(`${r.owner}/${r.repo}`.toLowerCase())) return { status: 'missing' };
  const url = `https://github.com/${r.owner}/${r.repo}`;
  return { status: 'ok', text: [...OWNERS].map((id) => tokenLineFor(id, url)).join('\n') + '\n' };
};

async function newInstallation(o: { shared?: boolean } = {}) {
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, shared_client)
    VALUES (${`v29-${process.pid}-${Date.now()}-${Math.random()}`}, ${o.shared ?? false}) RETURNING id`;
  OWNERS.add(id);
  return id;
}

const goodRepo = async () => ({ fork: false, hasCommits: true, aheadOfParent: null });
function ctxFor(id: number, o: { shared?: boolean } = {}) {
  const tokenDeps: TokenFlowDeps = {
    available: () => true,
    limit: async () => {},
    check: async (symbol) => !TAKEN.has(symbol),
    gate: { repo: goodRepo, owner: earnkitTxt, latest: async () => null, screen: async () => {} },
    deploy: (a) => deployToken(a, { fetch: tokensFun, sleep: async () => {} }),
  };
  return {
    installationId: id,
    ownInstallationId: id,
    ...(o.shared && { sharedClient: true }),
    roundPools: async () => new Map(),
    tokenDeps,
    pickupDeps: { owner: earnkitTxt, latest: async () => null },
    entryDeps: { fetchProof: async (u: string) => `<html><a href="https://github.com/alice/TipJar">${u}</a></html>` },
  };
}
type Ctx = ReturnType<typeof ctxFor>;

async function withSignIn<T>(fn: () => Promise<T>): Promise<T> {
  process.env.GITHUB_OAUTH_CLIENT_ID = 'v29-client';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'v29-secret';
  try {
    return await fn();
  } finally {
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  }
}

/**
 * The builder opens the sign-in link in a browser, confirms, and GitHub sends them back: the real
 * routes (GET confirm page, POST to GitHub, the callback), GitHub's endpoints mocked. Returns the
 * page's last line (on a shared client, the code to paste).
 */
async function browserSignIn(link: string, login: string): Promise<string> {
  const ip = { 'x-forwarded-for': '203.0.113.9' };
  const page = await verifyStart(new Request(link, { headers: ip }));
  assert.equal(page.status, 200, await page.clone().text());
  const html = await page.text();
  const cookie = page.headers.get('set-cookie')!.split(';')[0];
  const form = new URLSearchParams({
    n: html.match(/name="n" value="([^"]+)"/)![1],
    csrf: html.match(/name="csrf" value="([^"]+)"/)![1],
  });
  const toGitHub = await verifyConfirm(
    new Request('https://earnkit.com/github/verify', {
      method: 'POST',
      headers: { ...ip, cookie, origin: 'https://earnkit.com', 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    }),
  );
  assert.equal(toGitHub.status, 303);
  const authorize = new URL(toGitHub.headers.get('location')!);
  assert.equal(authorize.host, 'github.com');
  assert.equal(authorize.searchParams.get('scope'), null, 'no scopes requested');
  // GitHub: the builder approves as `login`; GitHub redirects back with a code and the state.
  const code = `c${Math.random().toString(36).slice(2)}`;
  GITHUB.oauthCodes.set(code, login);
  const back = new URL(authorize.searchParams.get('redirect_uri')!);
  back.searchParams.set('code', code);
  back.searchParams.set('state', authorize.searchParams.get('state')!);
  const done = await verifyCallback(new Request(back, { headers: { ...ip, cookie } }));
  const text = (await done.text()).replace(/<[^>]+>/g, '\n').trim();
  assert.equal(done.status, 200, text);
  return text.split('\n').filter(Boolean).pop()!;
}

/** The expected log lines (a failed probe, the alerts' and the cron's soft WETH price read) are kept out of the output. */
const logError = console.error;
console.error = (...a: unknown[]) => {
  if (typeof a[0] === 'string' && /^\[(verify|fees)\]|^\[cron\] fees$/.test(a[0])) return;
  logError(...a);
};

// ---- The recorder ------------------------------------------------------------------------------

type Reply = Record<string, unknown> & { show_to_builder?: string };
type Said = { journey: string; label: string; text: string; ms: number; reply: Reply; agentText: string };
const said: Said[] = [];
const MAX_REPLY_MS = 50_000;

/**
 * Every string a builder sees in a reply: show_to_builder, the kit (unless already in it), and a
 * launch's builder words (Ruling 31: launch_token's note; the sign-in line).
 */
function builderText(r: Reply): string {
  const shown = r.show_to_builder ?? '';
  const kit = (r.kit as { show_to_builder?: string } | undefined)?.show_to_builder;
  const token = r.token as { note?: string; sign_in_line?: string } | undefined;
  const launch = typeof r.status === 'string' ? [r.note, r.sign_in_line] : [];
  return [shown, kit && !shown.includes(kit) ? kit : undefined, ...launch, token?.note, token?.sign_in_line]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .filter((x, i, all) => all.indexOf(x) === i)
    .join('\n');
}

/** One tool call, as the agent makes it; timed, and its builder-facing text kept. */
async function call(journey: string, label: string, tool: keyof typeof handlers | keyof typeof tools, input: unknown, ctx: Ctx): Promise<Reply> {
  const started = Date.now();
  // v2.10 item 2: these journeys read the first reply's tables, which are behind "show more".
  const given = tool === 'list_programs' && input && typeof input === 'object' && !('more' in input) ? { ...input, more: true } : input;
  // v2.10 item 4: the v2.9 handlers by their old names, the 4 tools by theirs.
  const fn = (Object.hasOwn(handlers, tool) ? handlers[tool as keyof typeof handlers] : tools[tool as keyof typeof tools]) as (i: unknown, c: unknown) => Promise<unknown>;
  const reply = (await fn(given, ctx)) as Reply;
  const ms = Date.now() - started;
  const text = builderText(reply);
  said.push({ journey, label, text, ms, reply, agentText: JSON.stringify(reply) });
  if (process.env.V29_DUMP) console.log(`---- ${journey} ${label} (${ms} ms)\n${text}\n${JSON.stringify(reply).slice(0, 1500)}`);
  assert.ok(ms < MAX_REPLY_MS, `${journey} ${label}: replied in ${ms} ms`);
  return reply;
}
const forty = (journey: string) => said.filter((s) => s.journey === journey).reduce((n, s) => n + (s.text.match(/40%/g)?.length ?? 0), 0);
const dump = (journey: string) => said.filter((s) => s.journey === journey).map((s) => `[${s.label}]\n${s.text}`).join('\n\n');
const rowOf = (text: string, title: string) => text.split('\n').find((l) => l.startsWith(`| ${title}`));

const W = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
const CC = { browser: true, can_push: true };
const GROK = { browser: false, can_push: false };
const ARC_CONTRACT = '0x7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a';

/** What the agent drafts for a program's form, plus the builder's answers. */
const DRAFT: Record<string, string> = {
  description: 'TipJar lets fans tip creators in USDC on Arc; 120 creators received 900 tips in the first month.',
  builder_profile: 'https://github.com/alice',
  full_name: 'Alice Doe',
  email: 'alice@tipjar.xyz',
  x_handle: '@alice',
  telegram: '@alice',
  project_name: 'TipJar',
  project_name_description: 'TipJar: tips for creators in USDC.',
  one_sentence_description: 'Tips for creators in USDC.',
  summary: 'TipJar lets fans tip creators in USDC on Arc; 120 creators in month one.',
  x_profile: '@alice',
};
function answersFor(programId: string, over: Record<string, string> = {}) {
  const p = JSON.parse(readFileSync(join(PROGRAMS_DIR, `${programId}.json`), 'utf8')) as {
    submission_requirements: { key: string; type: string; options?: string[] }[];
  };
  const a: Record<string, string> = {};
  for (const r of p.submission_requirements) {
    if (r.type === 'choice' && r.options) a[r.key] = r.options[0];
    else if (DRAFT[r.key]) a[r.key] = DRAFT[r.key];
  }
  return { ...a, ...over };
}

// ---- The journeys ------------------------------------------------------------------------------

test('12.1 (v2.10 item 5) Claude Code, a real product on Arc: owned repos only, Arc Easy, no token in the first reply; one yes at confirm, one launch, "40%" once', dbTest, async () => {
  const J = '12.1';
  const id = await newInstallation();
  const ctx = ctxFor(id);
  // alice's GitHub: TipJar (live link, recent work), her fork of someone's repo, a tutorial clone and
  // an archived experiment. Locally: TipJar, an EarnKit kit clone and that fork.
  addRepos('alice', [
    ghRepo('alice', 'TipJar', { homepage: 'https://tipjar.xyz', description: 'Tips for creators in USDC on Arc' }),
    ghRepo('alice', 'wagmi-fork', { fork: true }),
    ghRepo('alice', 'todo-app', { description: 'Follow along with the course' }),
    ghRepo('alice', 'old-experiment', { archived: true }),
  ]);
  PUSHED.add('alice/tipjar');
  const local_repos = [
    { name: 'TipJar', url: 'https://github.com/alice/TipJar', chains: [{ chain: 'arc', mainnet: true }], live_url: 'https://tipjar.xyz', contracts: [ARC_CONTRACT], last_commit_at: daysAgo(1) },
    { name: 'starter-agent-service', url: 'https://github.com/earnkitai/starter-agent-service', chains: [{ chain: 'base', mainnet: true }], last_commit_at: daysAgo(1) },
    { name: 'wagmi-fork', url: 'https://github.com/alice/wagmi-fork', chains: [{ chain: 'base', mainnet: true }], live_url: 'https://wagmi-fork.xyz', last_commit_at: daysAgo(3) },
  ];
  const list = await call(J, 'list', 'list_programs', { github_user: 'alice', local_repos }, ctx);
  const text = list.show_to_builder!;
  // Owned repos only: TipJar is the only repo in any row; the fork, the tutorial, the archived repo
  // and the kit clone produce nothing, and their links are never probed.
  const repoCells = text.split('\n').filter((l) => l.startsWith('| ') && l.split('|').length === 7).slice(1).map((l) => l.split('|')[5].trim());
  assert.ok(repoCells.length >= 1, text);
  for (const cell of repoCells) assert.match(cell, /^TipJar\b/, text);
  // v2.10.1 B4: the two the agent named (the kit clone, the fork) are never dropped silently: one
  // "Not matched" line says why; the GitHub list's own noise stays out.
  assert.match(text, /^Not matched: starter-agent-service \(EarnKit's own repo\); wagmi-fork \(a fork\)\.$/m, text);
  const withoutNotMatched = text.replace(/^Not matched: .+$/m, '');
  for (const noise of ['wagmi', 'todo-app', 'old-experiment', 'starter-agent']) assert.ok(!withoutNotMatched.includes(noise), `${noise}: ${text}`);
  assert.ok(!probed.some((u) => u.includes('wagmi-fork')), 'a dropped fork costs no check');
  assert.deepEqual([...new Set((list.matches as { repo: string }[]).map((m) => m.repo))], ['TipJar']);
  // The Arc row: Easy (verified live link, a contract with code on Arc mainnet, an owned product).
  assert.match(rowOf(text, 'Arc Microgrants') ?? '', /^\| Arc Microgrants \| 500 USDC × 20 grants \| Easy \| .+ \| TipJar \|$/, text);
  // v2.10 item 5: the first reply never pitches the token; it closes on the usual offer.
  assert.ok(!('token_offer' in list), Object.keys(list).join());
  assert.doesNotMatch(text, /40%|launches \$|\bskip\b/, text);
  assert.match(text, /\n\nWant me to start on Arc Microgrants with TipJar\?$/, text);

  // The coach, the draft (the one confirm line), then one yes: one entry, one launch, to that wallet.
  const before = deployed.length;
  const program = 'arc-microgrants';
  const project = { name: 'TipJar', repo_url: 'https://github.com/alice/TipJar', live_url: 'https://tipjar.xyz', contracts: [ARC_CONTRACT] };
  await call(J, 'coach', 'prepare_submission', { program_id: program, project, agent: CC }, ctx);
  const answers = { ...answersFor(program), payout_wallet: W };
  const d = await call(J, 'draft', 'prepare_submission', { program_id: program, project, agent: CC, answers, coach_asked: true }, ctx);
  assert.equal(d.ready, true, d.show_to_builder);
  assert.ok(
    d.show_to_builder!.endsWith('\n\nReady. Yes submits your entry and launches $TIP (TipJar): 40% of its fees to you, plus the builder bonus. Wallet: 0x1581…b9a3. yes / skip the token'),
    d.show_to_builder,
  );
  const yes = { program_id: program, project, answers, builder_confirmed: true, decision: 'go', wallet: W, agent: CC };
  const c = await call(J, 'go', 'confirm_entry', yes, ctx);
  assert.ok(c.kit, 'the kit');
  assert.match(c.show_to_builder!, /^Your token \$TIP is live: tokens\.fun\/coin\/0x/);
  assert.deepEqual(deployed.slice(before).map((x) => [x.symbol, x.wallet]), [['TIP', W]]);
  const again = await call(J, 'go (retry)', 'confirm_entry', yes, ctx);
  assert.equal(again.project_id, c.project_id, 'a retry reuses the entry');
  assert.equal(deployed.length, before + 1, 'and never launches twice');
  const rec = await call(J, 'record', 'record_submission', { program_id: program, project, submission_data: answers, builder_submitted: true, external_submission_url: 'https://dorahacks.io/buidl/31337', payout_wallet: W }, ctx);
  assert.match(rec.show_to_builder!, /^Entered in Arc Microgrants\. Your token: tokens\.fun\/coin\/0x/);
  assert.equal(deployed.length, before + 1);
  // The entry is complete: the live link loaded and the Arc contract has code (T1).
  const [row] = await sql()<{ complete_at: Date | null; live_verified_at: Date | null; contract_verified_at: Date | null; confirm_choice: string }[]>`
    SELECT complete_at, live_verified_at, contract_verified_at, confirm_choice FROM projects WHERE id = ${c.project_id as number}`;
  assert.ok(row.complete_at && row.live_verified_at && row.contract_verified_at, JSON.stringify(row));
  assert.equal(row.confirm_choice, 'go');
  // "40%" once in the whole flow: the draft's confirm line.
  assert.equal(forty(J), 1, dump(J));
  assert.deepEqual(said.filter((x) => x.journey === J && /40%/.test(x.text)).map((x) => x.label), ['draft']);
});

test('12.1b noise only: a fork, a template, a tutorial and an EarnKit kit: no row, no token offer, never "40%"', dbTest, async () => {
  const J = '12.1b';
  const ctx = ctxFor(await newInstallation());
  addRepos('nora', [
    ghRepo('nora', 'viem-fork', { fork: true, homepage: 'https://viemfork.xyz' }),
    ghRepo('nora', 'dapp-template', { is_template: true }),
    ghRepo('nora', 'solidity-course', { description: 'Homework for the solidity course' }),
  ]);
  const list = await call(J, 'list', 'list_programs', {
    github_user: 'nora',
    local_repos: [{ name: 'chain-kits', url: 'https://github.com/earnkitai/chain-kits', chains: [{ chain: 'base', mainnet: true }], live_url: 'https://kits.xyz' }],
  }, ctx);
  assert.match(list.show_to_builder!, /None of your 4 repos fits an open program yet\./, list.show_to_builder);
  assert.ok(!('token_offer' in list));
  assert.deepEqual(list.matches, []);
  assert.equal(forty(J), 0, dump(J));
  assert.ok(!probed.some((u) => /viemfork|kits\.xyz/.test(u)), 'noise is never probed');
  const [{ fit_repos }] = await sql()<{ fit_repos: unknown[] }[]>`SELECT fit_repos FROM installations WHERE id = ${ctx.installationId}`;
  assert.deepEqual(fit_repos, [], 'and never alerted on');
});

const W2 = '0x2222222222222222222222222222222222222abc';
/** A public GitHub TipJar on Arc mainnet (homepage, an Arc config naming its contract), as Grok Bot's builders have it. */
function publicTipJar(owner: string) {
  if (GITHUB.repos.has(`${owner}/tipjar`)) return;
  addRepos(owner, [ghRepo(owner, 'TipJar', { homepage: `https://tipjar-${owner}.xyz`, description: 'Tips for creators in USDC' })]);
  const contract = `0x${Buffer.from(owner).toString('hex').padEnd(40, '4').slice(0, 40)}`;
  GITHUB.configs.set(`${owner}/tipjar`, `networks: { arc: { url: 'https://rpc.mainnet.arc.io', chainId: 5042 } } // TipJar at ${contract}`);
}

test('12.2 (v2.10 item 5) Grok Bot (shared client), GitHub sign-in on: no first-reply offer; the confirm line names the wallet given; yes gives the sign-in line, the code launches $TIP', dbTest, () =>
  withSignIn(async () => {
    const J = '12.2';
    publicTipJar('kim');
    const ctx = ctxFor(await newInstallation({ shared: true }), { shared: true });
    const list = await call(J, 'list', 'list_programs', { agent_can_build: false, repos: ['kim/TipJar'] }, ctx);
    assert.ok(!('token_offer' in list), Object.keys(list).join());
    assert.doesNotMatch(list.show_to_builder!, /40%|launches \$|\bskip\b/);
    assert.match(rowOf(list.show_to_builder!, 'Arc Microgrants') ?? '', /\| Easy \|/);
    const program = 'arc-microgrants';
    const project = { name: 'TipJar', repo_url: 'https://github.com/kim/TipJar', live_url: 'https://tipjar-kim.xyz' };
    const answers = { ...answersFor(program, { builder_profile: 'https://github.com/kim' }), payout_wallet: W2 };
    await call(J, 'coach', 'prepare_submission', { program_id: program, project, agent: GROK }, ctx);
    const d = await call(J, 'draft', 'prepare_submission', { program_id: program, project, agent: GROK, answers, coach_asked: true }, ctx);
    // No remembered wallet on a shared client (G13): only the one given in this flow is named.
    assert.ok(
      d.show_to_builder!.endsWith('Ready. Yes submits your entry and launches $TIP (TipJar): 40% of its fees to you, plus the builder bonus. Wallet: 0x2222…2abc. yes / skip the token'),
      d.show_to_builder,
    );
    // Yes: Grok Bot can't push, so the sign-in line; nothing launched.
    const yes = { program_id: program, project, answers, builder_confirmed: true, decision: 'go', wallet: W2, agent: GROK };
    const before = deployed.length;
    const first = await call(J, 'yes', 'confirm_entry', yes, ctx);
    assert.match(first.show_to_builder!, /^One click to prove TipJar is yours, then \$TIP launches: https:\/\/earnkit\.com\/github\/verify\?n=[\w-]{43}$/);
    assert.equal(deployed.length, before);
    const link = (first.token as { sign_in: string }).sign_in;
    // The builder opens the link, confirms, and GitHub sends them back: the page shows the code.
    const page = await browserSignIn(link, 'kim');
    const code = page.match(/^Done\. Paste this code to your agent: ([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2})$/)?.[1];
    assert.ok(code, page);
    // Without the code (another Grok Bot user, or the agent forgot it): nothing launches (G10).
    const noCode = await call(J, 'yes again, no code', 'confirm_entry', yes, ctx);
    assert.notEqual((noCode.token as { status?: string } | undefined)?.status, 'launched');
    assert.equal(deployed.length, before);
    // With the code: $TIP launches to the wallet the sign-in named (G11), with the kit.
    const c = await call(J, 'yes again, signed in', 'confirm_entry', { ...yes, signed_in: code }, ctx);
    assert.equal((c.token as { status: string }).status, 'launched', JSON.stringify(c));
    assert.ok(c.kit, c.show_to_builder);
    assert.deepEqual(deployed.slice(before).map((x) => [x.symbol, x.wallet]), [['TIP', W2]]);
    for (const x of said.filter((y) => y.journey === J)) assert.ok(!x.text.includes(CANT_PUSH), `${x.label}: ${x.text}`);
    const [row] = await sql()<{ complete_at: Date | null; contract_verified_at: Date | null }[]>`SELECT complete_at, contract_verified_at FROM projects WHERE id = ${c.project_id as number}`;
    assert.ok(row.complete_at && row.contract_verified_at, 'complete: the Arc contract matching found has code');
    assert.equal(forty(J), 1, dump(J));
  }),
);

test('12.2b Grok Bot (shared client), GitHub sign-in off: no first-reply token offer it could not accept (Ruling G15 I3); the usual close instead', dbTest, async () => {
  const J = '12.2b';
  publicTipJar('lee');
  const ctx = ctxFor(await newInstallation({ shared: true }), { shared: true });
  const list = await call(J, 'list', 'list_programs', { agent_can_build: false, repos: ['lee/TipJar'] }, ctx);
  // A hosted agent can't push the proof line, so with sign-in off a "yes" could never launch.
  assert.ok(!('token_offer' in list), list.show_to_builder);
  assert.doesNotMatch(list.show_to_builder!, /Launch \$|launches \$|40%/);
  assert.match(list.show_to_builder!, /Want me to start on .+\?/, list.show_to_builder);
  // An old agent's v2.9 offer "yes" for a token the builder never saw launches nothing. v2.10 item 4:
  // it reaches confirm through its alias, which shows the confirm line first (the v2.9 offer path,
  // which refused without a draft entry, is gone).
  const before = deployed.length;
  const old = aliasCall('launch_token', {
    offer: { program_id: 'arc-microgrants', repo_url: 'https://github.com/lee/TipJar', project_name: 'TipJar' },
    decision: 'go',
    builder_confirmed: true,
    creator_wallet: W2,
  })!;
  const guessed = await call(J, 'yes (never offered)', old.name, old.args, ctx);
  assert.notEqual((guessed.token as { status?: string } | undefined)?.status, 'launched', JSON.stringify(guessed));
  assert.ok(!guessed.kit, 'no kit before the builder saw the token');
  assert.equal(deployed.length, before);
  // The first reply never pitched the token; the confirm line says "40%" once (v2.10 item 5).
  assert.equal(forty(J), 1, dump(J));
});

test('12.4 statements: applied Base, not interested in a16z, testnet only on Arc lower the reply; a mainnet claim raises it back once checked', dbTest, async (t) => {
  const J = '12.4';
  // v2.10 Ruling H5: this journey is about statements, not users, so Blockscout gives no count here
  // (unknown: a live, active product is good odds on any chain). The default fake's 0 transactions
  // would make paylink "low odds: no users yet" on every row.
  const blockscout = checkDefaults.blockscout;
  checkDefaults.blockscout = async () => {
    throw new Error('no count');
  };
  const log = console.error;
  console.error = (...a: unknown[]) => (String(a[0]).startsWith('[verify] txcount') ? undefined : log(...a));
  t.after(() => {
    checkDefaults.blockscout = blockscout;
    console.error = log;
  });
  const ctx = ctxFor(await newInstallation());
  const local_repos = [
    { name: 'paylink', url: 'https://github.com/maya/paylink', chains: [{ chain: 'base', mainnet: true }, { chain: 'arc', mainnet: true }], live_url: 'https://paylink.xyz', contracts: ['0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a'], last_commit_at: daysAgo(1) },
  ];
  const first = await call(J, 'list', 'list_programs', { local_repos }, ctx);
  for (const t of ['Base Builder Grant Program', 'a16z speedrun SR008']) assert.ok(rowOf(first.show_to_builder!, t)?.includes('paylink'), `${t} matched first`);
  assert.match(rowOf(first.show_to_builder!, 'Arc Microgrants') ?? '', /\| Easy \| .+ \| paylink \|$/);

  // Lowering: the builder applied to Base outside EarnKit, isn't interested in a16z, and is only on Arc testnet.
  const told = await call(J, 'tell', 'tell_earnkit', {
    program_status: [{ program_id: 'base-builder-grants', status: 'applied' }, { program_id: 'a16z-speedrun', status: 'not_interested' }],
    repo_facts: [{ repo: 'maya/paylink', testnet_chains: ['arc'] }],
  }, ctx);
  assert.equal(told.show_to_builder, undefined, 'nothing to show the builder');
  const lowered = await call(J, 'list (lowered)', 'list_programs', { local_repos }, ctx);
  const low = lowered.show_to_builder!;
  assert.match(low, /^Your entries: Base Builder Grant Program: applied outside EarnKit\./);
  for (const t of ['Base Builder Grant Program', 'a16z speedrun SR008']) assert.equal(rowOf(low, t), undefined, `${t}: no row, in no table`);
  assert.ok(!(lowered.matches as { program_id: string }[]).some((m) => ['base-builder-grants', 'a16z-speedrun'].includes(m.program_id)));
  assert.match(rowOf(low, 'Arc Microgrants') ?? '', /^\| Arc Microgrants \| .+ \| Medium \| .+ \| paylink, needs a deploy on Arc mainnet \|$/, low);

  // Raising: mainnet on Arc and real users are claims; the Arc contract has code, so Arc is Easy
  // again; the users claim stays a "confirm" until EarnKit can check it.
  await call(J, 'tell (raise)', 'tell_earnkit', { repo_facts: [{ repo: 'maya/paylink', mainnet_chains: ['arc'], has_users: true }] }, ctx);
  const raised = await call(J, 'list (raised)', 'list_programs', { local_repos }, ctx);
  assert.match(rowOf(raised.show_to_builder!, 'Arc Microgrants') ?? '', /\| Easy \| .+ \| paylink \|$/, raised.show_to_builder);
  assert.match(rowOf(raised.show_to_builder!, 'Circle Developer Grants') ?? '', /\| paylink, confirm: users \|$/, raised.show_to_builder);
  assert.equal(rowOf(raised.show_to_builder!, 'a16z speedrun SR008'), undefined, 'not interested is for good');

  // Base's round changes (it opened again after the statement): Base is back.
  const [{ opened_at }] = await sql()<{ opened_at: Date | null }[]>`SELECT opened_at FROM programs WHERE id = 'base-builder-grants'`;
  try {
    await sql()`UPDATE programs SET opened_at = now() + interval '1 second' WHERE id = 'base-builder-grants'`;
    await new Promise((r) => setTimeout(r, 1_100));
    const reopened = await call(J, 'list (Base reopened)', 'list_programs', { local_repos }, ctx);
    assert.ok(rowOf(reopened.show_to_builder!, 'Base Builder Grant Program')?.includes('paylink'), reopened.show_to_builder);
    assert.doesNotMatch(reopened.show_to_builder!, /applied outside EarnKit/);
    assert.equal(rowOf(reopened.show_to_builder!, 'a16z speedrun SR008'), undefined);
  } finally {
    await sql()`UPDATE programs SET opened_at = ${opened_at} WHERE id = 'base-builder-grants'`;
  }
  // v2.10 item 5: no first-reply offer, so no "40%" in these lists at all.
  assert.equal(forty(J), 0, dump(J));
});

test('12.5 placeholders and unverified links: a placeholder is refused in plain words; a link that does not load keeps the entry open', dbTest, async () => {
  const J = '12.5';
  const ctx = ctxFor(await newInstallation());
  const program = 'arc-microgrants';
  // A placeholder reported with a local repo is dropped (never probed, never an error)...
  const local_repos = [{ name: 'ledgerly', url: 'https://github.com/omar/ledgerly', chains: [{ chain: 'arc', mainnet: true }], live_url: 'https://example.com', last_commit_at: daysAgo(2) }];
  const list = await call(J, 'list', 'list_programs', { local_repos }, ctx);
  assert.ok(!probed.some((u) => new URL(u).hostname === 'example.com'), 'a placeholder is never probed');
  assert.ok(!('token_offer' in list), 'no first-reply offer (v2.10 item 5)');
  // ...and so is one the builder tells EarnKit.
  await call(J, 'tell', 'tell_earnkit', { repo_facts: [{ repo: 'omar/ledgerly', live_url: 'https://localhost:3000', has_users: true }] }, ctx);
  // Given as the project's live link, it is refused in plain words.
  const project = { name: 'Ledgerly', repo_url: 'https://github.com/omar/ledgerly', live_url: 'https://example.com', contracts: ['0x6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c'] };
  await assert.rejects(
    call(J, 'placeholder', 'prepare_submission', { program_id: program, project, agent: CC }, ctx),
    (e: unknown) => e instanceof Error && JSON.parse(e.message)[0].message === PLACEHOLDER_LINE && PLACEHOLDER_LINE === 'Use your real site, not a placeholder.',
  );
  // A real link that doesn't load from here: one fix line, the entry stays open (not complete).
  DOWN.add('ledgerly.xyz');
  const real = { ...project, live_url: 'https://ledgerly.xyz' };
  const answers = { ...answersFor(program, { builder_profile: 'https://github.com/omar' }), payout_wallet: W };
  const d = await call(J, 'draft (link down)', 'prepare_submission', { program_id: program, project: real, agent: CC, answers, coach_asked: true }, ctx);
  assert.equal(d.ready, false);
  assert.match(d.show_to_builder!, /\n1\. Live link didn't load from here\. Check it's public\.\n/);
  assert.equal(LIVE_FAILED_LINE, "Live link didn't load from here. Check it's public.");
  assert.match(d.show_to_builder!, /Yes submits your entry and launches \$LEDGER \(Ledgerly\): 40%/, 'the offer is never blocked by a check');
  PUSHED.add('omar/ledgerly');
  const c = await call(J, 'go (link down)', 'confirm_entry', { program_id: program, project: real, answers, builder_confirmed: true, decision: 'go', wallet: W, agent: CC }, ctx);
  assert.equal((c.token as { status: string }).status, 'launched', JSON.stringify(c.token));
  await call(J, 'record (link down)', 'record_submission', { program_id: program, project: real, submission_data: answers, builder_submitted: true, external_submission_url: 'https://dorahacks.io/buidl/4242', payout_wallet: W }, ctx);
  const [row] = await sql()<{ complete_at: Date | null; live_verified_at: Date | null; contract_verified_at: Date | null }[]>`
    SELECT complete_at, live_verified_at, contract_verified_at FROM projects WHERE id = ${c.project_id as number}`;
  assert.deepEqual([row.complete_at, row.live_verified_at], [null, null], 'not complete while the link fails');
  assert.ok(row.contract_verified_at, 'the contract check still ran');
  assert.equal(forty(J), 1, dump(J));
});

test('12.6 (v2.10 item 5) no first-reply offer; the confirm line once with "40%"; skip the token there: no token, the entry recorded', dbTest, async () => {
  const J = '12.6';
  const ctx = ctxFor(await newInstallation());
  const local_repos = [{ name: 'quill', url: 'https://github.com/pia/quill', chains: [{ chain: 'arc', mainnet: true }], live_url: 'https://quill.xyz', contracts: ['0x7171717171717171717171717171717171717171'], last_commit_at: daysAgo(1) }];
  const list = await call(J, 'list', 'list_programs', { local_repos }, ctx);
  assert.ok(!('token_offer' in list));
  assert.doesNotMatch(list.show_to_builder!, /\bskip\b|40%|launches \$/);
  const program = 'arc-microgrants';
  const project = { name: 'Quill', repo_url: 'https://github.com/pia/quill', live_url: 'https://quill.xyz', contracts: ['0x7171717171717171717171717171717171717171'] };
  const answers = { ...answersFor(program, { builder_profile: 'https://github.com/pia' }), payout_wallet: W };
  await call(J, 'coach', 'prepare_submission', { program_id: program, project, agent: CC }, ctx);
  const d = await call(J, 'draft', 'prepare_submission', { program_id: program, project, agent: CC, answers, coach_asked: true }, ctx);
  assert.ok(d.show_to_builder!.endsWith('Ready. Yes submits your entry and launches $QUILL (Quill): 40% of its fees to you, plus the builder bonus. Wallet: 0x1581…b9a3. yes / skip the token'), d.show_to_builder);
  const c = await call(J, 'skip at confirm', 'confirm_entry', { program_id: program, project, answers, builder_confirmed: true, decision: 'skip', agent: CC }, ctx);
  assert.match(c.show_to_builder!, /^No token, no builder bonus\.\n/);
  assert.ok(c.kit);
  const rec = await call(J, 'record', 'record_submission', { program_id: program, project, submission_data: answers, builder_submitted: true, external_submission_url: 'https://dorahacks.io/buidl/5151' }, ctx);
  assert.match(rec.show_to_builder!, /^Entered in Arc Microgrants\.(\n|$)/);
  assert.doesNotMatch(rec.show_to_builder!, /token/i);
  // Ruling G15 M1: Circle's row still needs real users, so Also qualifies never offers it.
  // v2.10.1 B2: a row still waiting on users is low odds and says so.
  assert.match(rowOf(list.show_to_builder!, 'Circle Developer Grants') ?? '', /low odds: no users yet/, list.show_to_builder);
  assert.ok(!(rec.also_qualifies as { id: string }[] | undefined)?.some((r) => r.id === 'circle-developer-grants'), JSON.stringify(rec.also_qualifies));
  assert.ok(!deployed.some((x) => x.symbol === 'QUILL'), 'nothing launched');
  assert.equal(forty(J), 1, dump(J));
  assert.deepEqual(said.filter((x) => x.journey === J && /40%/.test(x.text)).map((x) => x.label), ['draft']);
});

test('12.6b Also qualifies (Ruling G15 M1): never a program whose row needs real users, nor a chain the builder said is testnet only', dbTest, async () => {
  const J = '12.6b';
  const ctx = ctxFor(await newInstallation());
  const repo_url = 'https://github.com/rio/relay';
  const local_repos = [
    { name: 'relay', url: repo_url, chains: [{ chain: 'arc', mainnet: true }, { chain: 'avalanche', mainnet: true }], live_url: 'https://relay.xyz', contracts: ['0x8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a'], last_commit_at: daysAgo(1) },
  ];
  const list = await call(J, 'list', 'list_programs', { local_repos }, ctx);
  assert.match(rowOf(list.show_to_builder!, 'Arc Microgrants') ?? '', /\| Easy \|/, list.show_to_builder);
  // v2.10.1 B2: a row still waiting on users is low odds and says so.
  assert.match(rowOf(list.show_to_builder!, 'Circle Developer Grants') ?? '', /low odds: no users yet/, list.show_to_builder);
  // GitHub's evidence (the repo-facts cache Also qualifies reads) has relay on Arc and Avalanche mainnet
  // (v2.10 item 9: in a deploy config).
  await sql()`
    INSERT INTO github_repo_facts (full_name, pushed_at, chains, commits_since) VALUES ('rio/relay', now(),
      ${sql().json({ arc: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' }, avalanche: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' } })}, '{}')`;
  // Enter Avalanche (no token), then record it.
  const program = 'avalanche-team1-mini-grants';
  const project = { name: 'Relay', repo_url, live_url: 'https://relay.xyz' };
  const answers = { ...answersFor(program, { builder_profile: 'https://github.com/rio' }), payout_wallet: W };
  await call(J, 'draft', 'prepare_submission', { program_id: program, project, agent: CC, answers, coach_asked: true }, ctx);
  await call(J, 'skip at confirm', 'confirm_entry', { program_id: program, project, answers, builder_confirmed: true, decision: 'skip', agent: CC }, ctx);
  const record = (label: string) =>
    call(J, label, 'record_submission', { program_id: program, project, submission_data: answers, builder_submitted: true, external_submission_url: 'https://dorahacks.io/buidl/6161' }, ctx);
  const also = (r: Reply) => ((r.also_qualifies as { id: string }[] | undefined) ?? []).map((x) => x.id);
  const first = await record('record');
  // Arc (Easy for relay) is offered; Circle (its row needs real users) is not.
  assert.ok(also(first).includes('arc-microgrants'), JSON.stringify(first.also_qualifies));
  assert.ok(!also(first).includes('circle-developer-grants'), JSON.stringify(first.also_qualifies));
  // The builder says relay is only on Arc testnet: Arc is no longer offered.
  await call(J, 'tell', 'tell_earnkit', { repo_facts: [{ repo: 'rio/relay', testnet_chains: ['arc'] }] }, ctx);
  const again = await record('record again');
  assert.ok(!also(again).includes('arc-microgrants'), JSON.stringify(again.also_qualifies));
  assert.ok(!also(again).includes('circle-developer-grants'));
  // v2.10 item 5: no first-reply offer; the draft is not ready, so no confirm line either.
  assert.equal(forty(J), 0, dump(J));
});


// ---- Part 2: hosting, the weekly email, the won line, one money figure, /terms ----------------

/** R2, in memory (the bucket under hosting.ts and, through bucketOf, the Worker). */
function memR2() {
  const objects = new Map<string, Uint8Array>();
  const r2: R2 = {
    put: async (key, body) => void objects.set(key, body),
    list: async (prefix) => [...objects.keys()].filter((k) => k.startsWith(prefix)),
    del: async (keys) => keys.forEach((k) => objects.delete(k)),
    copy: async (from, to) => {
      const o = objects.get(from);
      if (!o) throw new Error('no such key');
      objects.set(to, o);
    },
  };
  return { r2, objects };
}
const SITES = memR2();
const R2_ENV = { R2_ACCOUNT_ID: 'v29-acct', R2_ACCESS_KEY_ID: 'v29-key', R2_SECRET_ACCESS_KEY: 'v29-r2-secret', R2_BUCKET: 'earnkit-sites' };

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
const ADMIN = 'v29-journey-admin-secret-0123456789abcdef';
const hostingOn = <T>(fn: () => Promise<T>) => withSignIn(() => withEnv({ ...R2_ENV, ADMIN_VETO_SECRET: ADMIN }, fn));

/** The builder's agent POSTs the zip to the upload URL; the reply is recorded like a tool reply. */
async function upload(journey: string, label: string, url: string, body: Uint8Array | ReadableStream<Uint8Array>) {
  const started = Date.now();
  const res = await hostUploadPost(
    new Request(url, { method: 'POST', headers: { 'content-type': 'application/zip' }, body, duplex: 'half' } as RequestInit),
    { r2: SITES.r2 },
  );
  const reply = (await res.json()) as Reply;
  const ms = Date.now() - started;
  said.push({ journey, label, text: reply.show_to_builder ?? '', ms, reply, agentText: JSON.stringify(reply) });
  return { status: res.status, reply };
}

/** The Worker, as Cloudflare runs it, over the same in-memory bucket (no edge cache). */
async function visit(url: string): Promise<{ status: number; text: string; headers: Headers }> {
  const bucket = {
    get: async (key: string) => {
      const o = SITES.objects.get(key);
      return o ? { body: new Response(o).body!, size: o.length } : null;
    },
  };
  const cache = { match: async () => undefined, put: async () => {} };
  const res = await workerHandle(new Request(url), { BUCKET: bucket, ZONE: 'earnkit.com' }, cache, () => {});
  return { status: res.status, text: await res.text(), headers: res.headers };
}

const site = (body: string) =>
  zipSync({ 'index.html': strToU8(`<!doctype html><html><head><title>TipJar</title></head><body>${body}</body></html>`), 'app.js': strToU8('console.log(1)') });

test('12.3 lazy builder, no live link: sign-in, upload, the limits; the hosted link counts as live at once; a flagged redeploy waits in staging until approved; expiry ends it', dbTest, () =>
  hostingOn(async () => {
    const J = '12.3';
    const id = await newInstallation();
    const ctx = ctxFor(id);
    const repo_url = 'https://github.com/hana/TipJar';
    addRepos('hana', [ghRepo('hana', 'TipJar', { description: 'Tips for creators in USDC on Arc' })]);
    const program = 'arc-microgrants';
    const contracts = ['0x9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a'];
    const project = { name: 'TipJar', repo_url, contracts };
    const list = await call(J, 'list', 'list_programs', { local_repos: [{ name: 'TipJar', url: repo_url, chains: [{ chain: 'arc', mainnet: true }], contracts, last_commit_at: daysAgo(1) }] }, ctx);
    // v2.10 item 6: a contract with code but no live link: low odds, said as such.
    assert.match(rowOf(list.show_to_builder!, 'Arc Microgrants') ?? '', /TipJar, low odds: live link not loading \|$/, list.show_to_builder);

    // "Host it for me": first the one-click sign-in (purpose host), never the upload URL.
    const first = await call(J, 'host (sign in)', 'prepare_submission', { program_id: program, project, agent: CC, host: true }, ctx);
    const host1 = first.host as { sign_in_url?: string; show_to_builder?: string; upload_url?: string };
    assert.ok(host1.sign_in_url && !host1.upload_url, JSON.stringify(host1));
    assert.equal(host1.show_to_builder, hostSignInLine('TipJar', host1.sign_in_url));
    const [nonce] = await sql()<{ purpose: string; repo_key: string }[]>`
      SELECT purpose, repo_key FROM github_verify_nonces WHERE installation_id = ${id} ORDER BY created_at DESC LIMIT 1`;
    assert.deepEqual([nonce.purpose, nonce.repo_key], ['host', 'hana/tipjar']);
    await browserSignIn(host1.sign_in_url, 'hana');

    // Signed in: the one-time upload URL, for the agent only.
    const second = await call(J, 'host (upload url)', 'prepare_submission', { program_id: program, project, agent: CC, host: true }, ctx);
    const host2 = second.host as { upload_url: string; expires_at: string; agent_note: string };
    assert.match(host2.upload_url, /^https:\/\/earnkit\.com\/api\/host\/upload\?t=[\w-]{43}$/);
    assert.equal(host2.agent_note, UPLOAD_NOTE);
    assert.ok(Date.parse(host2.expires_at) - Date.now() <= 15 * 60_000);

    // The limits: a non-website file, then a site over 25 MB, are refused in plain words and spend nothing.
    const exe = await upload(J, 'upload .exe', host2.upload_url, zipSync({ 'index.html': strToU8('<p>x</p>'), 'tool.exe': strToU8('MZ') }));
    assert.deepEqual([exe.status, exe.reply.show_to_builder], [400, HOST_LINES.notWebsite]);
    const endless = new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(new Uint8Array(1024 * 1024)) });
    const big = await upload(J, 'upload 25 MB+', host2.upload_url, endless);
    assert.deepEqual([big.status, big.reply.show_to_builder], [413, HOST_LINES.tooBig]);
    // The zip: live at once.
    const up = await upload(J, 'upload', host2.upload_url, site('<h1>TipJar</h1>'));
    assert.deepEqual([up.status, up.reply.show_to_builder], [200, 'TipJar is live: tipjar-hana.earnkit.com']);
    assert.ok(!said.some((x) => x.text.includes('/api/host/upload')), 'the upload URL is never builder text');
    // The link is single-use.
    const again = await upload(J, 'upload (used link)', host2.upload_url, site('<h1>again</h1>'));
    assert.deepEqual([again.status, again.reply.show_to_builder], [410, HOST_LINES.expired]);
    // The Worker serves it, sandboxed, with the badge.
    const page = await visit('https://tipjar-hana.earnkit.com/');
    assert.equal(page.status, 200);
    assert.match(page.text, /<h1>TipJar<\/h1>.*Built with EarnKit<\/a> by .*@hana<\/a>/s);
    for (const [k, v] of Object.entries(HOST_HEADERS)) assert.equal(page.headers.get(k), v, k);

    // The hosted link counts as live-verified at once (Ruling G19): even while the Worker's cached
    // 404 says otherwise, the entry never probes it and completes.
    DOWN.add('tipjar-hana.earnkit.com');
    const hosted = { ...project, live_url: 'https://tipjar-hana.earnkit.com' };
    const answers = { ...answersFor(program, { builder_profile: 'https://github.com/hana' }), payout_wallet: W };
    const d = await call(J, 'draft (hosted link)', 'prepare_submission', { program_id: program, project: hosted, agent: CC, answers, coach_asked: true }, ctx);
    assert.equal(d.ready, true, d.show_to_builder);
    const c = await call(J, 'skip at confirm', 'confirm_entry', { program_id: program, project: hosted, answers, builder_confirmed: true, decision: 'skip', agent: CC }, ctx);
    await call(J, 'record', 'record_submission', { program_id: program, project: hosted, submission_data: answers, builder_submitted: true, external_submission_url: 'https://dorahacks.io/buidl/7171' }, ctx);
    assert.ok(!probed.some((u) => u.includes('tipjar-hana.earnkit.com')), 'the hosted link is never probed');
    const [row] = await sql()<{ complete_at: Date | null; live_verified_at: Date | null }[]>`
      SELECT complete_at, live_verified_at FROM projects WHERE id = ${c.project_id as number}`;
    assert.ok(row.complete_at && row.live_verified_at, JSON.stringify(row));

    // A redeploy the scan flags: staged, never served, the live site untouched; the owner reviews it.
    const third = await call(J, 'host (redeploy url)', 'prepare_submission', { program_id: program, project: hosted, agent: CC, host: true }, ctx);
    const flagged = await upload(J, 'upload (flagged)', (third.host as { upload_url: string }).upload_url, site('<form>Enter your seed phrase to claim</form>'));
    assert.deepEqual([flagged.status, flagged.reply.show_to_builder, flagged.reply.review], [200, HOST_REVIEW, true]);
    assert.ok([...SITES.objects.keys()].some((k) => k.startsWith('staging/tipjar-hana/')));
    assert.doesNotMatch((await visit('https://tipjar-hana.earnkit.com/')).text, /seed phrase/, 'flagged files are never served');
    assert.deepEqual(await sitesInReview(), ['tipjar-hana']);
    const cron = await runCron({ only: ['v29-none'], deps: { refreshFees: async () => 0, hosting: { r2: SITES.r2, only: ['tipjar-hana'] } } });
    assert.ok((cron.needs_owner as string[]).includes('host-review:tipjar-hana'), JSON.stringify(cron.needs_owner));
    // The owner's approve call (runbook): the staged files go live, staging is emptied.
    const admin = (body: unknown, secret = ADMIN) =>
      hostTakedownPost(new Request('https://earnkit.com/api/host/takedown', { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify(body) }), { r2: SITES.r2 });
    assert.equal((await admin({ slug: 'tipjar-hana', action: 'approve' }, 'wrong')).status, 401);
    const approved = await admin({ slug: 'tipjar-hana', action: 'approve' });
    assert.deepEqual([approved.status, await approved.json()], [200, { slug: 'tipjar-hana', status: 'live' }]);
    assert.match((await visit('https://tipjar-hana.earnkit.com/')).text, /seed phrase/);
    assert.ok(![...SITES.objects.keys()].some((k) => k.startsWith('staging/')));
    assert.deepEqual(await sitesInReview(), []);

    // Expiry: once its programs ended plus 7 days, the cron ends it; the Worker shows the end page.
    const out = await expireSites(new Date('2100-06-01T00:00:00Z'), { r2: SITES.r2, only: ['tipjar-hana'] });
    assert.equal(out.ended, 1);
    const ended = await visit('https://tipjar-hana.earnkit.com/');
    assert.deepEqual([ended.status, ended.text], [410, ENDED_PAGE]);
    assert.ok(![...SITES.objects.keys()].some((k) => k.startsWith('sites/tipjar-hana/')), 'its files are deleted');
    const [check] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM url_checks WHERE key LIKE '%tipjar-hana%'`;
    assert.equal(check.n, 0, 'and its link no longer counts as live');
    DOWN.delete('tipjar-hana.earnkit.com');

    // The gate: a GitHub account under 30 days old gets a plain reason, never an upload URL.
    addRepos('neo', [ghRepo('neo', 'Pager')]);
    GITHUB.accountCreated.set('neo', daysAgo(5));
    const ctxNeo = ctxFor(await newInstallation());
    const neoProject = { name: 'Pager', repo_url: 'https://github.com/neo/Pager' };
    const signIn = await call(J, 'host (neo sign in)', 'prepare_submission', { program_id: program, project: neoProject, agent: CC, host: true }, ctxNeo);
    await browserSignIn((signIn.host as { sign_in_url: string }).sign_in_url, 'neo');
    const gated = await call(J, 'host (neo gated)', 'prepare_submission', { program_id: program, project: neoProject, agent: CC, host: true }, ctxNeo);
    assert.deepEqual(gated.host, { unavailable: HOST_LINES.gate });
    // "40%" once: the first reply's offer.
    assert.equal(forty(J), 1, dump(J));
  }),
);

/** Resend, recorded. */
const mails: Parameters<Mailer>[0][] = [];
const mailer: Mailer = async (m) => void mails.push(m);
/** The Monday 14:05 UTC `weeks` weeks after the one following `from` (the email's send hour). */
function monday(from: Date, weeks = 0): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 14, 5));
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7) + 7 * weeks);
  return d;
}

test('12.8 "Builders using EarnKit won $X": announced results only, the same figure on the landing, the stats and the first reply', dbTest, async () => {
  const J = '12.8';
  // An announcement names alice's TipJar (12.1) as an Arc winner, $500.
  const today = new Date().toISOString().slice(0, 10);
  await syncOutcomeFile(OutcomeFile.parse({
    program_id: 'arc-microgrants', round_label: 'v29 journey round', source_url: 'https://www.arc.network/blog/microgrants', captured_at: today, complete: false,
    results: [{ repo: 'https://github.com/alice/TipJar', result: 'won', prize_usd: 500 }],
  }));
  // A builder's own "I won $10,000" is never counted.
  const [omar] = await sql()<{ id: number; installation_id: number }[]>`SELECT id, installation_id FROM projects WHERE repo_url ILIKE '%omar/ledgerly%' LIMIT 1`;
  await call(J, 'self-report', 'tell_earnkit', { program_status: [{ program_id: 'arc-microgrants', status: 'won', project_id: omar.id, prize_usd: 10_000 }] }, ctxFor(omar.installation_id));
  const [self] = await sql()<{ basis: string; prize_usd: string }[]>`SELECT basis, prize_usd::text FROM entry_outcomes WHERE project_id = ${omar.id} AND basis <> 'announcement'`;
  assert.ok(self && self.basis !== 'announcement' && Number(self.prize_usd) === 10_000, JSON.stringify(self));
  const saved = wonSource.read;
  wonSource.read = () => readWonUsd();
  try {
    const [stats, landing] = await Promise.all([readStats(), readLanding()]);
    assert.equal(stats.builders_won_usd, 500);
    assert.equal(landing.won_line, 'Builders using EarnKit won $500');
    const first = await call(J, 'list (no repo)', 'list_programs', { agent_can_build: true }, ctxFor(await newInstallation()));
    assert.equal(first.show_to_builder!.split('Builders using EarnKit won $500.').length, 2, first.show_to_builder);
    assert.match(first.show_to_builder!, /^\S+ in prizes open right now\. Builders using EarnKit won \$500\./);
  } finally {
    wonSource.read = saved;
  }
});

test('12.9 one money figure: the landing, /api/stats and the first reply say the same top-prize total', dbTest, async () => {
  const J = '12.9';
  const figure = moneyText(openMoneyUsd(await listPrograms()));
  assert.ok(figure, 'there is open money');
  const [stats, landing] = await Promise.all([readStats(), readLanding()]);
  assert.equal(stats.open_money_text, figure);
  assert.equal(landing.open_text, figure);
  const first = await call(J, 'list (no repo)', 'list_programs', { agent_can_build: true }, ctxFor(await newInstallation()));
  assert.ok(first.show_to_builder!.startsWith(`${figure} in prizes open right now.`), first.show_to_builder);
  assert.equal(first.show_to_builder!.split(figure!).length, 2, 'said once');
});

test('12.10 the weekly email: asked once after the first entry, opt-in, the Monday send, the caps, one-click unsubscribe; per login on a shared client', dbTest, () =>
  hostingOn(() =>
    withEnv({ RESEND_API_KEY: 're_v29_journey' }, async () => {
      const J = '12.10';
      const id = await newInstallation();
      const ctx = ctxFor(id);
      const enter = async (program: string, label: string) => {
        const project = { name: 'Relay', repo_url: 'https://github.com/omi/relay', live_url: 'https://relay-omi.xyz' };
        const answers = { ...answersFor(program, { builder_profile: 'https://github.com/omi' }), payout_wallet: W };
        await call(J, `${label} draft`, 'prepare_submission', { program_id: program, project, agent: CC, answers, coach_asked: true }, ctx);
        const c = await call(J, `${label} confirm`, 'confirm_entry', { program_id: program, project, answers, builder_confirmed: true, decision: 'skip', agent: CC }, ctx);
        const r = await call(J, `${label} record`, 'record_submission', { program_id: program, project, submission_data: answers, builder_submitted: true, external_submission_url: `https://dorahacks.io/buidl/${label.length}` }, ctx);
        return { c, r };
      };
      // The first entry: the question closes the kit reply, once; the second entry never asks.
      const one = await enter('arc-microgrants', 'arc');
      assert.ok(one.c.show_to_builder!.endsWith(`\n\n${EMAIL_QUESTION}`), one.c.show_to_builder);
      assert.ok((one.c.agent_note as string).includes(EMAIL_NOTE));
      assert.ok(!one.r.show_to_builder!.includes(EMAIL_QUESTION));
      const two = await enter('avalanche-team1-mini-grants', 'avalanche');
      assert.ok(![two.c, two.r].some((x) => x.show_to_builder!.includes('once a week')));
      // Yes, with the address.
      const yes = await call(J, 'yes', 'tell_earnkit', { weekly_email: { answer: 'yes', email: 'omi@relay-omi.xyz' } }, ctx);
      assert.equal(yes.show_to_builder, EMAIL_ON);

      // Monday 14:05 UTC: one mail (12.8's announced win), with one-click unsubscribe headers.
      const mon = monday(new Date());
      const sent = await sendDigests(mon, { mail: mailer, only: [id] });
      assert.deepEqual([sent.sent, sent.capped], [1, false]);
      const mail = mails.at(-1)!;
      assert.equal(mail.to, 'omi@relay-omi.xyz');
      assert.match(mail.text, /^Won: TipJar in Arc Microgrants, \$500\.$/m);
      assert.match(mail.headers['List-Unsubscribe'], /^<https:\/\/earnkit\.com\/api\/digest\/unsubscribe\?t=[^>]+>$/);
      assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
      assert.match(mail.idempotencyKey, new RegExp(`^digest-${id}-`));
      // Once a week: a second run that Monday sends nothing.
      assert.equal((await sendDigests(new Date(mon.getTime() + 3_600_000), { mail: mailer, only: [id] })).sent, 0);

      // The caps: with the day's 100 already sent, the next Monday's run sends nothing and says so.
      const next = monday(new Date(), 1);
      await sql()`
        INSERT INTO free_tier_usage (name, period, used) VALUES ('resendDay', ${periodKey('day', next)}, 100)
        ON CONFLICT (name, period) DO UPDATE SET used = 100`;
      const capped = await sendDigests(next, { mail: mailer, only: [id] });
      assert.deepEqual([capped.sent, capped.capped], [0, true]);
      await sql()`DELETE FROM free_tier_usage WHERE name = 'resendDay' AND period = ${periodKey('day', next)}`;

      // One-click unsubscribe from the mail's own link: the page asks first; the POST stops it.
      const link = mail.headers['List-Unsubscribe'].slice(1, -1);
      const confirmPage = digestUnsubscribeGet(new Request(link));
      assert.match(await confirmPage.text(), new RegExp(UNSUB_CONFIRM.replace('?', '\\?')));
      const stop = await digestUnsubscribePost(new Request(link, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
      assert.match(await stop.text(), new RegExp(UNSUB_DONE.replace('.', '\\.')));
      const before = mails.length;
      assert.equal((await sendDigests(new Date(next.getTime() + 7 * 86_400_000), { mail: mailer, only: [id] })).sent, 0);
      assert.equal(mails.length, before, 'no mail after the unsubscribe');

      // A shared client (Grok Bot): never asked or subscribed without a sign-in; then once per login.
      const grok = await newInstallation({ shared: true });
      const gctx = ctxFor(grok, { shared: true });
      const codes: Record<string, string> = {};
      for (const login of ['sol', 'tam']) {
        addRepos(login, [ghRepo(login, 'Relay')]);
        const project = { name: 'Relay', repo_url: `https://github.com/${login}/Relay` };
        const s1 = await call(J, `${login} host sign in`, 'prepare_submission', { program_id: 'arc-microgrants', project, agent: GROK, host: true }, gctx);
        const page = await browserSignIn((s1.host as { sign_in_url: string }).sign_in_url, login);
        codes[login] = page.match(/([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2})$/)![1];
      }
      const noCode = await call(J, 'shared yes, no code', 'tell_earnkit', { weekly_email: { answer: 'yes', email: 'sol@relay.xyz' } }, gctx);
      assert.equal(noCode.show_to_builder, EMAIL_SIGN_IN);
      for (const login of ['sol', 'tam']) {
        const project = { name: 'Relay', repo_url: `https://github.com/${login}/Relay`, live_url: `https://${login}-relay.xyz` };
        const answers = { ...answersFor('arc-microgrants', { builder_profile: `https://github.com/${login}` }), payout_wallet: W2 };
        await call(J, `${login} draft`, 'prepare_submission', { program_id: 'arc-microgrants', project, agent: GROK, answers, coach_asked: true }, gctx);
        const c = await call(J, `${login} confirm`, 'confirm_entry', { program_id: 'arc-microgrants', project, answers, builder_confirmed: true, decision: 'skip', agent: GROK, signed_in: codes[login] }, gctx);
        assert.ok(c.show_to_builder!.endsWith(`\n\n${EMAIL_QUESTION}`), `${login}: ${c.show_to_builder}`);
        const y = await call(J, `${login} yes`, 'tell_earnkit', { weekly_email: { answer: 'yes', email: `${login}@relay.xyz` }, signed_in: codes[login] }, gctx);
        assert.equal(y.show_to_builder, EMAIL_ON);
      }
      const shared = await sendDigests(mon, { mail: mailer, only: [grok] });
      assert.equal(shared.sent, 2);
      const theirs = mails.slice(-2);
      assert.deepEqual(theirs.map((m) => m.to).sort(), ['sol@relay.xyz', 'tam@relay.xyz']);
      assert.notEqual(theirs[0].headers['List-Unsubscribe'], theirs[1].headers['List-Unsubscribe'], 'each login its own link');
      assert.notEqual(theirs[0].idempotencyKey, theirs[1].idempotencyKey);
      // Nothing about one builder in the other's mail.
      for (const m of theirs) assert.ok(!m.text.includes(m.to === 'sol@relay.xyz' ? 'tam' : 'sol'), m.text);
      // "40%" once per builder's entry flow (omi's first draft; sol's and tam's), never with the question.
      assert.deepEqual(said.filter((x) => x.journey === J && /40%/.test(x.text)).map((x) => x.label), ['arc draft', 'sol draft', 'tam draft']);
    }),
  ),
);

test('12.11 /terms: the old legal paths 301 to their section; every link EarnKit shows goes to /terms', dbTest, () => {
  const html = renderToStaticMarkup(React.createElement(TermsPage));
  for (const r of LEGAL_REDIRECTS) {
    assert.equal(r.statusCode, 301);
    const [path, anchor] = r.destination.split('#');
    assert.equal(path, '/terms');
    assert.match(html, new RegExp(`id="${anchor}"`), r.source);
  }
  assert.deepEqual(LEGAL_REDIRECTS.map((r) => r.source).sort(), ['/policy', '/risk-disclosure', '/sponsor-terms']);
  const legal = FOOTER_COLUMNS.flatMap((c) => c.links).filter((l) => /terms|policy|risk/i.test(l.href));
  assert.deepEqual(legal.map((l) => l.href), ['/terms']);
  for (const s of said) assert.doesNotMatch(s.agentText, /earnkit\.com\/(policy|risk-disclosure|sponsor-terms)\b/, `${s.journey} ${s.label}`);
});

/** The chain under the cron's claims: every EarnKit token's split names its creator and MINI; fees wait for each. */
function claimsChain(creators: Map<string, string>, available: Map<string, bigint>) {
  const C = BASE_BONUS;
  const sent: Hex[] = [];
  const mined = new Set<Hex>();
  const bonus = account.address.toLowerCase();
  const rpc: BonusRpc = {
    getChainId: async () => 8453,
    nonce: async () => sent.length,
    finalizedNonce: async () => sent.length,
    fees: async () => ({ maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 1n }),
    estimateGas: async () => 50_000n,
    receipt: async (h) => (mined.has(h) ? { status: 'success' as const } : null),
    transaction: async (h) => sent.some((r) => keccak256(r) === h),
    finalReceipt: async () => true,
    broadcast: async (raw) => {
      if (sent.includes(raw)) return 'known';
      sent.push(raw);
      mined.add(keccak256(raw));
      return 'sent';
    },
    waitFor: async (h) => (mined.has(h) ? { status: 'success' as const } : null),
    balanceOf: async () => 0n,
    blockNumber: async () => 10_000n,
    storeLogs: async () => [],
    receiptLogs: async () => ({ blockNumber: 0n, logs: [] }),
    blockTime: async () => new Date(),
    availableFees: async (owner) => available.get(owner.toLowerCase()) ?? 0n,
    canCollect: async () => false,
    rewardRecipients: async () => [bonus],
    rewardInfo: async (locker, coin) =>
      locker.toLowerCase() === C.lockers[0].toLowerCase() && creators.has(coin.toLowerCase())
        ? { recipients: [C.safe, creators.get(coin.toLowerCase())!, MINI_FEE_RECIPIENT.toLowerCase(), bonus], bps: [3000, 4000, 1000, 2000] }
        : { recipients: [], bps: [] },
    ethBalance: async () => 10n ** 18n,
  };
  return { rpc, sent };
}
const account = privateKeyToAccount(`0x${'5'.repeat(64)}`);

test('12.7 automatic claims in a cron run: each launched token\'s creator and MINI are claimed to themselves, logged, never as revenue', dbTest, async () => {
  // The tokens these journeys launched, each with its creator (the wallet the builder gave).
  const coins = await sql()<{ coin_address: string }[]>`SELECT coin_address FROM projects WHERE coin_address IS NOT NULL`;
  assert.ok(coins.length >= 3, `${coins.length} launched tokens`);
  const creators = new Map(deployed.map((d) => [d.address.toLowerCase(), d.wallet.toLowerCase()]));
  const fees = 10n ** 15n; // far above 10x gas (50,000 gas at 0.001 gwei)
  const mini = MINI_FEE_RECIPIENT.toLowerCase();
  const available = new Map([...new Set(creators.values())].map((w) => [w, fees] as [string, bigint]));
  available.set(mini, fees);
  const chain = claimsChain(creators, available);
  const stats = async () => JSON.stringify(await readStats(), (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  const statsBefore = await stats();
  const out = await runCron({ only: ['v29-none'], deps: { refreshFees: async () => 0, bonus: { account, rpc: chain.rpc, chain: BASE_BONUS, startBlock: 9_000n, log: () => {} } } });
  const bonus = out.bonus as { claim_others?: { owner: string; role: string; result: string }[]; gas?: { low: boolean } };
  assert.ok(Array.isArray(bonus.claim_others), JSON.stringify(out.bonus, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  const claimed = bonus.claim_others!.filter((c) => c.result.startsWith('claim success'));
  // MINI once, each creator once (two tokens of one wallet: one claim).
  assert.deepEqual(
    claimed.map((c) => [c.role, c.owner]).sort(),
    [['mini', mini], ...[...new Set(creators.values())].map((w) => ['creator', w])].sort(),
  );
  // claim(owner, WETH) on the FeeLocker: the fees go to their owner, never the payout wallet.
  const owners = chain.sent.map((raw) => {
    const tx = parseTransaction(raw);
    assert.equal(tx.to?.toLowerCase(), BASE_BONUS.feeLocker);
    const call = decodeFunctionData({ abi: FEE_LOCKER_ABI, data: tx.data! });
    assert.equal(call.functionName, 'claim');
    return String(call.args![0]).toLowerCase();
  });
  assert.deepEqual(owners.sort(), claimed.map((c) => c.owner).sort());
  // Logged in fee_claims (an ops log): no public stat moves.
  const logged = await sql()<{ owner: string; role: string }[]>`SELECT owner, role FROM fee_claims ORDER BY role, owner`;
  assert.deepEqual(logged.map((r) => [r.role, r.owner]).sort(), claimed.map((c) => [c.role, c.owner]).sort());
  assert.equal(await stats(), statsBefore, 'claims are never revenue');
  assert.equal(bonus.gas?.low, false);
  assert.ok(!(out.needs_owner as string[]).includes('bonus-ledger'), JSON.stringify(out.needs_owner));
});

test('every journey reply: under 50 s; no emoji, em dash, "coin", "vault", "Clanker" or tool name; "skip" only as "skip the token"; no WETH, gas or terms link; nothing else on the network', dbTest, () => {
  assert.ok(said.length > 30, `${said.length} replies`);
  const coinWords = (text: string) =>
    text
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\b[\w-]+(?:\.[\w-]+)+\/\S*/g, ' ')
      .match(/\bcoins?\b/gi) ?? [];
  // v2.10 item 4: the old names (and sponsor_campaign) anywhere; the new ones in a call shape.
  const toolName = new RegExp(
    `\\b(${[...OLD_TOOL_NAMES, 'sponsor_campaign'].join('|')})\\b|\\bcall(s|ing)? (find|prepare|confirm|tell)\\b|\\b(find|prepare|confirm|tell)( with\\b|\\()|\\bthe (find|prepare|confirm|tell) tool\\b`,
  );
  // v2.10 item 5: the confirm line is the only place "skip" is said, as "skip the token".
  const offerSkip = /\/ skip the token$/;
  for (const s of said) {
    const where = `${s.journey} ${s.label}`;
    assert.ok(s.ms < MAX_REPLY_MS, where);
    assert.doesNotMatch(s.text, /\p{Extended_Pictographic}/u, where);
    assert.doesNotMatch(s.agentText, /—/, where);
    assert.doesNotMatch(s.agentText, /clanker/i, where);
    // Ruling H10 (I2): the ban is EarnKit's wording; a program's quoted focus areas may say vaults.
    assert.doesNotMatch(withoutQuotedFacts(s.text), /\bvaults?\b/i, where);
    assert.deepEqual(coinWords(s.text), [], where);
    assert.doesNotMatch(s.text, toolName, `${where}: ${s.text}`);
    assert.doesNotMatch(s.reply.show_to_builder ?? '', TECHNICAL_TERMS, where);
    for (const line of s.text.split('\n').filter((l) => /\bskip\b/i.test(l))) assert.match(line, offerSkip, `${where}: ${line}`);
    assert.doesNotMatch(s.text, /\bWETH\b|\bgas\b|token-creator-agreement|risk-disclosure/, `${where}: ${s.text}`);
    assert.ok((s.text.match(/Builder bonus:/g)?.length ?? 0) <= 1, where);
    // Ruling G15 (I3): no journey reaches "Open this in Claude Code or Cursor" any more.
    assert.ok(!s.text.includes(CANT_PUSH), where);
  }
  // Nothing tried the network but the alerts' soft WETH price read (cached, fails soft).
  assert.deepEqual(blocked.filter((u) => !u.startsWith('https://coins.llama.fi/')), []);
});
