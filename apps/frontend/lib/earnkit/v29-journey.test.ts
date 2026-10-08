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
import { tools } from './tools';
import { tokenLineFor } from './token-gate';
import { deployToken } from './tokens';
import { TECHNICAL_TERMS, type TokenFlowDeps } from './token-launch';
import { CANT_PUSH } from './confirm';
import { checkDefaults } from './verify';
import { LIVE_FAILED_LINE, PLACEHOLDER_LINE } from './placeholder';
import { verifyCallback, verifyConfirm, verifyStart } from './github-verify';
import { BASE_BONUS, type BonusRpc } from './bonus-ledger';
import { runCron } from './cron';
import { MINI_FEE_RECIPIENT } from './policy';
import type { FetchResult } from './ownership';

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
 * Asserted across every reply: "40%" exactly once per entry flow; "skip" only in token offers; no
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
    return p.toLowerCase().endsWith('/readme.md') ? new Response(README) : notFound();
  }
  // The OAuth token's own reads (github-verify.ts githubOAuth).
  if (auth?.startsWith('Bearer gho_')) {
    const login = GITHUB.oauthCodes.get(auth.slice('Bearer gho_'.length))!;
    if (p === '/user') return json({ login, created_at: '2019-01-01T00:00:00Z', public_repos: 4 });
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
      return json({ tree: [{ path: 'README.md', type: 'blob', size: README.length }, { path: 'src/index.ts', type: 'blob', size: 900 }] });
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
    roundPoolsWei: async () => new Map<string, bigint | null>(),
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
async function call(journey: string, label: string, tool: keyof typeof tools, input: unknown, ctx: Ctx): Promise<Reply> {
  const started = Date.now();
  const reply = (await (tools[tool] as (i: unknown, c: unknown) => Promise<unknown>)(input, ctx)) as Reply;
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

test('12.1 Claude Code, a real product on Arc: owned repos only, Arc Easy, the token offer closes the first reply; one launch, "40%" once', dbTest, async () => {
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
  for (const noise of ['wagmi', 'todo-app', 'old-experiment', 'starter-agent']) assert.ok(!text.includes(noise), `${noise}: ${text}`);
  assert.ok(!probed.some((u) => u.includes('wagmi-fork')), 'a dropped fork costs no check');
  assert.deepEqual([...new Set((list.matches as { repo: string }[]).map((m) => m.repo))], ['TipJar']);
  // The Arc row: Easy (verified live link, a contract with code on Arc mainnet, an owned product).
  assert.match(rowOf(text, 'Arc Microgrants') ?? '', /^\| Arc Microgrants \| 500 USDC × 20 grants \| Easy \| .+ \| TipJar \|$/, text);
  // The reply closes on the token offer (no wallet remembered: asked in the same line).
  assert.ok(
    text.endsWith('\n\nTipJar fits Arc Microgrants: $500. Launch $TIP (TipJar) on Base now? You earn 40% of its trading fees, plus a shot at the builder bonus. Say yes with your wallet address, or skip.'),
    text,
  );
  const offer = list.token_offer as { program_id: string; repo_url: string; project_name: string; proposed: { symbol: string; name: string } };
  assert.deepEqual([offer.program_id, offer.repo_url, offer.proposed.symbol], ['arc-microgrants', 'https://github.com/alice/TipJar', 'TIP']);

  // The yes, with the wallet: one draft entry, one launch, to that wallet.
  const before = deployed.length;
  const yes = { offer: { program_id: offer.program_id, repo_url: offer.repo_url, project_name: offer.project_name }, decision: 'go', builder_confirmed: true, creator_wallet: W, agent: CC };
  const launched = await call(J, 'launch go', 'launch_token', yes, ctx);
  assert.equal(launched.status, 'launched', JSON.stringify(launched));
  assert.deepEqual(deployed.slice(before).map((d) => [d.symbol, d.wallet]), [['TIP', W]]);
  const again = await call(J, 'launch go (retry)', 'launch_token', yes, ctx);
  assert.equal(again.project_id, launched.project_id, 'a retry reuses the entry');
  assert.equal(deployed.length, before + 1, 'and never launches twice');

  // The coach, the draft, the confirmation and the record: no second "40%", no second launch.
  const program = 'arc-microgrants';
  const project = { name: 'TipJar', repo_url: 'https://github.com/alice/TipJar', live_url: 'https://tipjar.xyz', contracts: [ARC_CONTRACT] };
  await call(J, 'coach', 'prepare_submission', { program_id: program, project, agent: CC }, ctx);
  const answers = { ...answersFor(program), payout_wallet: W };
  const d = await call(J, 'draft', 'prepare_submission', { program_id: program, project, agent: CC, answers, coach_asked: true }, ctx);
  assert.equal(d.ready, true, d.show_to_builder);
  assert.ok(d.show_to_builder!.endsWith('Ready to submit?'), d.show_to_builder);
  const c = await call(J, 'go', 'confirm_entry', { program_id: program, project, answers, builder_confirmed: true, decision: 'go', wallet: W, agent: CC }, ctx);
  assert.ok(c.kit, 'the kit');
  assert.equal(c.project_id, launched.project_id, 'the same entry');
  assert.match(c.show_to_builder!, /^Your token is live: tokens\.fun\/coin\/0x/);
  const rec = await call(J, 'record', 'record_submission', { program_id: program, project, submission_data: answers, builder_submitted: true, external_submission_url: 'https://dorahacks.io/buidl/31337', payout_wallet: W }, ctx);
  assert.match(rec.show_to_builder!, /^Entered in Arc Microgrants\. Your token: tokens\.fun\/coin\/0x/);
  assert.equal(deployed.length, before + 1);
  // The entry is complete: the live link loaded and the Arc contract has code (T1).
  const [row] = await sql()<{ complete_at: Date | null; live_verified_at: Date | null; contract_verified_at: Date | null; confirm_choice: string }[]>`
    SELECT complete_at, live_verified_at, contract_verified_at, confirm_choice FROM projects WHERE id = ${launched.project_id as number}`;
  assert.ok(row.complete_at && row.live_verified_at && row.contract_verified_at, JSON.stringify(row));
  assert.equal(row.confirm_choice, 'go');
  // "40%" once in the whole flow: the first reply's offer.
  assert.equal(forty(J), 1, dump(J));
  assert.deepEqual(said.filter((s) => s.journey === J && /40%/.test(s.text)).map((s) => s.label), ['list']);
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
  assert.ok(!list.token_offer);
  assert.deepEqual(list.matches, []);
  assert.equal(forty(J), 0, dump(J));
  assert.ok(!probed.some((u) => /viemfork|kits\.xyz/.test(u)), 'noise is never probed');
  const [{ fit_repos }] = await sql()<{ fit_repos: unknown[] }[]>`SELECT fit_repos FROM installations WHERE id = ${ctx.installationId}`;
  assert.deepEqual(fit_repos, [], 'and never alerted on');
});
