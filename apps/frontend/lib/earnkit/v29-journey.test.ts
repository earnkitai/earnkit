import './fixtures/no-network-checks';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { keccak256, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sql } from './db';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { handlers, tools } from './tools';
import { tokenLineFor } from './token-gate';
import { deployToken } from './tokens';
import { type TokenFlowDeps } from './token-launch';
import { checkDefaults } from './verify';
import { verifyCallback, verifyConfirm, verifyStart } from './github-verify';
import { BASE_BONUS, type BonusRpc } from './bonus-ledger';
import { MINI_FEE_RECIPIENT } from './policy';
import type { FetchResult } from './ownership';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { strToU8, zipSync } from 'fflate';
import { hostUploadPost } from './hosting';
import type { R2 } from './r2';
import { handle as workerHandle } from '../../../../infra/host-worker/src/route';
import {
  type Mailer,
} from './digest';
import { readStats } from './stats';
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

const W2 = '0x2222222222222222222222222222222222222abc';
/** A public GitHub TipJar on Arc mainnet (homepage, an Arc config naming its contract), as Grok Bot's builders have it. */
function publicTipJar(owner: string) {
  if (GITHUB.repos.has(`${owner}/tipjar`)) return;
  addRepos(owner, [ghRepo(owner, 'TipJar', { homepage: `https://tipjar-${owner}.xyz`, description: 'Tips for creators in USDC' })]);
  const contract = `0x${Buffer.from(owner).toString('hex').padEnd(40, '4').slice(0, 40)}`;
  GITHUB.configs.set(`${owner}/tipjar`, `networks: { arc: { url: 'https://rpc.mainnet.arc.io', chainId: 5042 } } // TipJar at ${contract}`);
}

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

/** Resend, recorded. */
const mails: Parameters<Mailer>[0][] = [];
const mailer: Mailer = async (m) => void mails.push(m);
/** The Monday 14:05 UTC `weeks` weeks after the one following `from` (the email's send hour). */
/**
 * The first Monday 14:05 UTC after `from` (plus `weeks`). v2.11 final fix wave: on a Monday before
 * 14:05 that is today, not a week on, so a win announced now is inside the digest's 7 days whatever
 * the weekday the suite runs on (the old rule failed 12.10 every Monday).
 */
function monday(from: Date, weeks = 0): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 14, 5));
  while (d <= from || d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 7 * weeks);
  return d;
}

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
