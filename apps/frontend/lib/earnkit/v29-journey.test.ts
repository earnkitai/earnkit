import './fixtures/no-network-checks';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { sql } from './db';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { handlers, tools } from './tools';
import { deployToken } from './tokens';
import { type TokenFlowDeps } from './token-launch';
import { checkDefaults } from './verify';
import type { FetchResult } from './ownership';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
    // v3 Stage 2: an upcoming file stays upcoming (it has no form yet).
    if (!raw.campaign && raw.status !== 'upcoming') Object.assign(raw, { status: 'active', ends_at: raw.ends_at ? FAR : raw.ends_at });
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

const README = `# TipJar\n\n${'Fans tip creators in USDC on Arc; payouts settle in seconds. '.repeat(40)}`;

type GhRepo = Record<string, unknown> & { name: string; full_name: string; html_url: string };

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
  // v2.14 spec 2: no proof line any more (the App proves a repo); a pickup reads none.
  void url;
  return { status: 'missing' };
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
    gate: { repo: goodRepo, appProven: async (_i: number, k: string) => !k.includes('nopush'), screen: async () => {} },
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

// ---- The journeys ------------------------------------------------------------------------------

// ---- Part 2: hosting, the weekly email, the won line, one money figure, /terms ----------------

/** The Monday 14:05 UTC `weeks` weeks after the one following `from` (the email's send hour). */

test('12.9 one money figure: the landing, /api/stats and the first reply say the same top-prize total', dbTest, async () => {
  const J = '12.9';
  const figure = moneyText(openMoneyUsd(await listPrograms()));
  assert.ok(figure, 'there is open money');
  const [stats, landing] = await Promise.all([readStats(), readLanding()]);
  // v3 Stage 2: the landing and /api/stats read the same figure as "<figure> in grants and prizes open".
  assert.equal(stats.open_money_text, `${figure} in grants and prizes open`);
  assert.equal(landing.open_text, `${figure} in grants and prizes open`);
  const first = await call(J, 'list (no repo)', 'list_programs', { agent_can_build: true }, ctxFor(await newInstallation()));
  // v3 Stage 2: with investments out of the total, the rounding no longer hides that the first reply sums only the
  // programs an agent can complete (v2.12 spec 9: Colosseum is left out of find), so its figure is over those.
  const agentFigure = moneyText(openMoneyUsd((await listPrograms()).filter((p) => p.agent_completable !== false)));
  assert.ok(first.show_to_builder!.startsWith(`${agentFigure} in prizes open right now.`), first.show_to_builder);
  assert.equal(first.show_to_builder!.split(agentFigure!).length, 2, 'said once');
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
