import './fixtures/no-network-checks';
import { withoutQuotedFacts } from './fixtures/quoted-facts';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { privateKeyToAccount } from 'viem/accounts';
import { sql } from './db';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { tools } from './tools';
import { OLD_TOOL_NAMES } from './aliases';
import { tokenLineFor } from './token-gate';
import { deployToken } from './tokens';
import { launchLogo } from './token-logo';
import { TECHNICAL_TERMS, type TokenFlowDeps } from './token-launch';
import { checkDefaults } from './verify';
import { verifyCallback, verifyConfirm, verifyStart } from './github-verify';
import { appSetup } from './github-app';
import { deployedLine, type DeployChain, type DeployDeps } from './deploy';
import { getProjectPage } from './leaderboard';
import { bonusBoard } from './bonus-board';
import { POST as mcpPost } from '../../app/mcp/route';
import { saveInstallation } from './installations';

/**
 * v2.10 Task 11: the owner's v2.9 test run, replayed as regression journeys through the 4 tools
 * (find, prepare, confirm, tell) and the MCP route for one old-name call. Every real program file;
 * a throwaway database of its own (as v29-journey.test.ts: schema.sql, dropped after).
 *
 * Mocks only the outside world: GitHub (REST, raw files, the OAuth endpoints and the read-only App's
 * installation API, with a key generated here), the link probe, RPC getCode and Blockscout (verify.ts
 * checkDefaults), the live site's page and icon (the logo), tokens.fun's deploy API behind the real
 * deployToken, and the deployer's chain (DeployChain). DefiLlama's price is the deploy's
 * usdPerNative; the alerts' soft WETH price read is the only other request, and it fails soft.
 * Every other fetch gets a 503 and is noted; the last test asserts nothing else tried the network.
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
const journeyDb = `earnkit_v210_journey_${process.pid}`;
const savedEnv: Record<string, string | undefined> = {};
const ENV: Record<string, string | undefined> = {
  TOKENSFUN_DEPLOY_API_KEY: 'v210-journey-key',
  EARNKIT_AUTH_SECRET: process.env.EARNKIT_AUTH_SECRET || 'v210-journey-secret',
  // Sign-in, the App and deploys are switched on per journey (withEnv); off by default, as in
  // production until the owner sets them.
  GITHUB_OAUTH_CLIENT_ID: undefined,
  GITHUB_OAUTH_CLIENT_SECRET: undefined,
  GITHUB_APP_ID: undefined,
  GITHUB_APP_SLUG: undefined,
  GITHUB_APP_PRIVATE_KEY: undefined,
  DEPLOYER_PRIVATE_KEY: undefined,
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
  // so the journeys never depend on real dates (a journey about the deadline line moves one).
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

// A test RSA key for the fake App, made here (never a real App's key).
const { privateKey: APP_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const SIGN_IN = { GITHUB_OAUTH_CLIENT_ID: 'v210-client', GITHUB_OAUTH_CLIENT_SECRET: 'v210-secret' };
const APP = { ...SIGN_IN, GITHUB_APP_ID: '424242', GITHUB_APP_SLUG: 'earnkit-read', GITHUB_APP_PRIVATE_KEY: APP_KEY };
/** The deployer: a key made for this test only (never the payout, operator or guardian key). */
const DEPLOYER_KEY = '7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';
const DEPLOYER = privateKeyToAccount(`0x${DEPLOYER_KEY}`).address;
const DEPLOYS = { DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY };

// ---- The outside world -------------------------------------------------------------------------

const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const README = `# TipJar\n\n${'Fans tip creators in USDC on Arc; payouts settle in seconds. '.repeat(40)}`;
/** Arc mainnet in a hardhat config: a deploy config (v2.10 item 9 basis), not a bare mention. */
const ARC_CONFIG = `export default { networks: { arc: { url: 'https://rpc.arc.network', chainId: 5042 } } };`;

type GhRepo = Record<string, unknown> & { name: string; full_name: string; html_url: string; private: boolean };
const ghRepo = (owner: string, name: string, extra: Record<string, unknown> = {}): GhRepo => ({
  name,
  full_name: `${owner}/${name}`,
  html_url: `https://github.com/${owner}/${name}`,
  homepage: null,
  default_branch: 'main',
  created_at: daysAgo(120),
  pushed_at: daysAgo(1),
  fork: false,
  archived: false,
  is_template: false,
  private: false,
  visibility: 'public',
  owner: { login: owner },
  description: null,
  topics: [],
  ...extra,
});

/** GitHub as each journey's builder has it. A private repo answers only through the App's token. */
const GITHUB = {
  users: new Map<string, GhRepo[]>(),
  repos: new Map<string, GhRepo>(),
  /** OAuth: the login each one-time code signs in as (GitHub's authorize step, done in the browser). */
  oauthCodes: new Map<string, string>(),
  /** The App's installations: id to account and the repos the builder picked. */
  installs: new Map<number, { account: string; repos: string[] }>(),
  /** Repos with a hardhat config naming Arc mainnet. */
  arcConfig: new Set<string>(),
};
function addRepos(owner: string, repos: GhRepo[]) {
  GITHUB.users.set(owner, [...(GITHUB.users.get(owner) ?? []), ...repos.filter((r) => !r.private)]);
  for (const r of repos) GITHUB.repos.set(r.full_name.toLowerCase(), r);
}

/** Every installation's proof line, in the repos whose owner pushed it (`PUSHED`). */
const OWNERS = new Set<number>();
const PUSHED = new Set<string>();
const proofFile = (key: string) =>
  [...OWNERS].map((id) => tokenLineFor(id, `https://github.com/${GITHUB.repos.get(key)!.full_name}`)).join('\n') + '\n';

/** The link probe and getCode: every link loads and every address has code. Blockscout: no count off Base. */
const probed: string[] = [];
checkDefaults.probe = async (url: string) => void probed.push(url);
checkDefaults.getCode = async () => '0x6080';
checkDefaults.blockscout = async () => ({ transactions_count: '0' });
// The real url_checks table (this journey's own database), not the suites' in-memory cache.
delete checkDefaults.cache;

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => json({ message: 'Not Found' }, 404);
/** App installation tokens minted (one per read; never stored by EarnKit). */
const minted: string[] = [];

function github(u: URL, init?: RequestInit): Response {
  const auth = new Headers(init?.headers).get('authorization');
  const method = init?.method ?? 'GET';
  const p = u.pathname;
  if (u.host === 'github.com' && p === '/login/oauth/access_token') {
    const { code } = JSON.parse(String(init?.body ?? '{}')) as { code?: string };
    return code && GITHUB.oauthCodes.has(code) ? json({ access_token: `gho_${code}` }) : json({ error: 'bad_verification_code' });
  }
  // The App's own API (a JWT signed with the generated key).
  let m = p.match(/^\/app\/installations\/(\d+)(\/access_tokens)?$/);
  if (m) {
    const inst = GITHUB.installs.get(Number(m[1]));
    if (!inst || !auth?.startsWith('Bearer ey')) return notFound();
    if (!m[2]) return json({ id: Number(m[1]), account: { login: inst.account } });
    const { repositories } = JSON.parse(String(init?.body ?? '{}')) as { repositories?: string[] };
    if (method !== 'POST' || !repositories?.every((n) => inst.repos.some((r) => r.split('/')[1].toLowerCase() === n.toLowerCase()))) return json({ message: 'no' }, 422);
    const token = `ghs_${m[1]}_${minted.length}`;
    minted.push(token);
    return json({ token, expires_at: new Date(NOW + 3_600_000).toISOString() }, 201);
  }
  const appInstall = auth?.startsWith('Bearer ghs_') ? GITHUB.installs.get(Number(auth.split('_')[1])) : undefined;
  if (p === '/installation/repositories' && appInstall)
    return json({ total_count: appInstall.repos.length, repositories: appInstall.repos.map((full_name) => ({ full_name })) });
  if (u.host === 'raw.githubusercontent.com') {
    const [, owner, repo] = p.split('/');
    const r = GITHUB.repos.get(`${owner}/${repo}`.toLowerCase());
    if (!r || r.private) return notFound();
    return rawOf(r, p.split('/').slice(4).join('/'));
  }
  // The OAuth token's own reads (github-verify.ts githubOAuth).
  if (auth?.startsWith('Bearer gho_')) {
    const login = GITHUB.oauthCodes.get(auth.slice('Bearer gho_'.length))!;
    if (p === '/user') return json({ login, created_at: '2019-01-01T00:00:00Z', public_repos: 4 });
    const mm = p.match(/^\/repos\/([^/]+)\/([^/]+)$/);
    const r = mm && GITHUB.repos.get(`${decodeURIComponent(mm[1])}/${decodeURIComponent(mm[2])}`.toLowerCase());
    if (!r) return notFound();
    const owner = (r.owner as { login: string }).login.toLowerCase();
    return json({ ...r, permissions: { push: owner === login.toLowerCase(), admin: owner === login.toLowerCase() } });
  }
  m = p.match(/^\/users\/([^/]+)\/repos$/);
  if (m) return json(GITHUB.users.get(decodeURIComponent(m[1]).toLowerCase()) ?? []);
  if (p === '/search/commits') return json({ items: [] });
  if (p === '/graphql') return json({ data: { repository: { usesCustomOpenGraphImage: false } } });
  m = p.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (m) {
    const key = `${m[1]}/${m[2]}`.toLowerCase();
    const r = GITHUB.repos.get(key);
    // A private repo: 404 unless the App's token for an installation that lists it.
    if (!r || (r.private && !appInstall?.repos.some((x) => x.toLowerCase() === key))) return notFound();
    const rest = m[3] ?? '';
    if (rest === '') return json(r);
    if (rest.startsWith('/git/trees/'))
      return json({
        tree: [
          { path: 'README.md', type: 'blob', size: README.length },
          { path: 'src/index.ts', type: 'blob', size: 900 },
          ...(PUSHED.has(key) ? [{ path: 'earnkit.txt', type: 'blob', size: 80 }] : []),
          ...(GITHUB.arcConfig.has(key) ? [{ path: 'hardhat.config.ts', type: 'blob', size: ARC_CONFIG.length }] : []),
        ],
      });
    if (rest.startsWith('/contents/')) return rawOf(r, decodeURIComponent(rest.slice('/contents/'.length)));
    if (rest === '/commits') {
      // 12 commits in the last 90 days, by an author GitHub can't link (a local email): item 8.
      const n = u.searchParams.get('per_page') === '1' ? 1 : 12;
      return json(Array.from({ length: n }, (_, i) => ({ sha: `c${i}`, author: null, commit: { author: { date: daysAgo(i + 1) } } })));
    }
    if (rest === '/branches') return json([{ name: 'main' }]);
  }
  return notFound();
}
function rawOf(r: GhRepo, path: string): Response {
  const key = r.full_name.toLowerCase();
  if (/^readme\.md$/i.test(path)) return new Response(README);
  if (path === 'earnkit.txt' && PUSHED.has(key)) return new Response(proofFile(key));
  if (path === 'hardhat.config.ts' && GITHUB.arcConfig.has(key)) return new Response(ARC_CONFIG);
  return notFound();
}

/** The live sites: each page names an apple-touch-icon; the icon is a PNG. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const iconsRead: string[] = [];
const logoDeps = {
  page: async (url: string) => `<html><head><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"></head><body>${url}</body></html>`,
  image: async (url: string) => (iconsRead.push(url), PNG),
  preview: async () => null,
};

/** No network: GitHub is the mock above; every other host gets a 503 and is noted. */
const blocked: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const u = new URL(url);
  if (['api.github.com', 'github.com', 'raw.githubusercontent.com'].includes(u.host)) return github(u, init);
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return realFetch(input, init);
  // tokens.fun's check-ticker (the MCP route's calls use the real one).
  if (u.host === 'tokens.fun' && u.pathname === '/api/check-ticker') return json({ available: !TAKEN.has(u.searchParams.get('symbol') ?? '') });
  blocked.push(url);
  return new Response('v210-journey: no network', { status: 503 });
}) as typeof fetch;

/** tokens.fun's check-ticker: these are taken. tokens.fun's deploy API, behind the real deployToken. */
const TAKEN = new Set<string>();
type Sent = { symbol: string; address: string; wallet: string; website?: string; imageUrl: string; description: string };
const deployed: Sent[] = [];
const tokensFun = (async (_url: string, init: { body: string }) => {
  const body = JSON.parse(init.body) as { symbol: string; creatorWallet: string; website?: string; imageUrl: string; description: string };
  const address = '0x' + String(deployed.length + 1).padStart(40, 'b');
  deployed.push({ symbol: body.symbol, address, wallet: body.creatorWallet, website: body.website, imageUrl: body.imageUrl, description: body.description });
  return json({ success: true, tokenAddress: address, txHash: '0x' + 'cd'.repeat(32), urls: { tokensfun: `https://tokens.fun/coin/${address}` } });
}) as unknown as typeof fetch;

/** The deployer's chain (Arc): one creation, then transferOwnership(builder) since owner() starts as the deployer. */
const ARC_DEPLOYED = `0x12ab${'0'.repeat(32)}9f3e` as const;
const chainLog: string[] = [];
function fakeArc(): DeployChain {
  let owner: string = DEPLOYER;
  return {
    estimate: async () => ((chainLog.push('estimate'), { gas: 120_000n, maxFeePerGas: 20_000_000_000n })),
    simulate: async () => `0x${'60'.repeat(60)}`,
    nonce: async () => 1,
    balance: async () => 5n * 10n ** 18n,
    send: async () => ((chainLog.push('send'), `0x${'ab'.repeat(32)}`)),
    receipt: async () => ({ status: 'success', contractAddress: ARC_DEPLOYED, gasUsed: 90_000n, effectiveGasPrice: 20_000_000_000n }),
    code: async () => `0x${'60'.repeat(60)}`,
    read: async (a) => (a.fn === 'owner' ? owner : null),
    write: async (a) => {
      chainLog.push(`${a.fn}(${String(a.args[0])})`);
      owner = String(a.args[0]);
      return `0x${'ef'.repeat(32)}`;
    },
  };
}
const deployDeps: DeployDeps = { chain: (c) => (c === 'arc' ? fakeArc() : null), usdPerNative: async () => 1 };
const OWNABLE_ABI = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'owner', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'transferOwnership', inputs: [{ name: 'newOwner', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
];
const TIPJAR_BYTECODE = `0x${'60'.repeat(80)}`;

async function newInstallation(o: { shared?: boolean } = {}) {
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, shared_client)
    VALUES (${`v210-${process.pid}-${Date.now()}-${Math.random()}`}, ${o.shared ?? false}) RETURNING id`;
  OWNERS.add(id);
  return id;
}

function ctxFor(id: number, o: { shared?: boolean } = {}) {
  const tokenDeps: TokenFlowDeps = {
    available: () => true,
    limit: async () => {},
    check: async (symbol) => !TAKEN.has(symbol),
    // The real gate (GitHub mocked); only the sanctions screen (an RPC read) is stubbed.
    gate: { screen: async () => {} },
    deploy: (a) => deployToken(a, { fetch: tokensFun, sleep: async () => {} }),
    logo: (a) => launchLogo(a, logoDeps),
  };
  return {
    installationId: id,
    ownInstallationId: id,
    ...(o.shared && { sharedClient: true }),
    tokenDeps,
    deployDeps,
    // The program's entry page links the builder's repo (a page without it disproves the submission).
    entryDeps: { fetchProof: async (u: string) => `<html>${u} ${[...GITHUB.repos.values()].map((r) => `<a href="${r.html_url}">code</a>`).join(' ')}</html>` },
  };
}
type Ctx = ReturnType<typeof ctxFor>;

const ip = { 'x-forwarded-for': '203.0.113.9' };
/**
 * The builder opens a sign-in (or App) link in a browser, confirms, and GitHub sends them back: the
 * real routes, GitHub's endpoints mocked. A sign-in returns the page's last line (on a shared client,
 * the code); an App link returns GitHub's install page and the cookie the setup URL needs.
 */
async function browserSignIn(link: string, login: string): Promise<{ last: string; install?: URL; cookie: string }> {
  const page = await verifyStart(new Request(link, { headers: ip }));
  assert.equal(page.status, 200, await page.clone().text());
  const html = await page.text();
  const cookie = page.headers.get('set-cookie')!.split(';')[0];
  const form = new URLSearchParams({ n: html.match(/name="n" value="([^"]+)"/)![1], csrf: html.match(/name="csrf" value="([^"]+)"/)![1] });
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
  const code = `c${Math.random().toString(36).slice(2)}`;
  GITHUB.oauthCodes.set(code, login);
  const back = new URL(authorize.searchParams.get('redirect_uri')!);
  back.searchParams.set('code', code);
  back.searchParams.set('state', authorize.searchParams.get('state')!);
  const done = await verifyCallback(new Request(back, { headers: { ...ip, cookie } }));
  if (done.status === 303) return { last: '', install: new URL(done.headers.get('location')!), cookie };
  const text = (await done.text()).replace(/<[^>]+>/g, '\n').trim();
  assert.equal(done.status, 200, text);
  return { last: text.split('\n').filter(Boolean).pop()!, cookie };
}

/** The expected log lines (a failed probe, the alerts' soft WETH price read, the alias log) are kept out of the output. */
const logError = console.error;
console.error = (...a: unknown[]) => {
  if (typeof a[0] === 'string' && /^\[(verify|fees)\]|^\[cron\] fees$/.test(a[0])) return;
  logError(...a);
};

// ---- The recorder ------------------------------------------------------------------------------

type Reply = Record<string, unknown> & { show_to_builder?: string };
type Said = { journey: string; label: string; text: string; ms: number; reply: Reply; agentText: string; first: boolean };
const said: Said[] = [];
const MAX_REPLY_MS = 50_000;

/** Every string a builder sees in a reply: show_to_builder, the kit (unless already in it), and a launch's builder words. */
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

/** One call to one of the 4 tools, as the agent makes it; timed, and its builder-facing text kept. */
async function call(journey: string, label: string, tool: 'find' | 'prepare' | 'confirm' | 'tell', input: unknown, ctx: Ctx, o: { first?: boolean } = {}): Promise<Reply> {
  const started = Date.now();
  const reply = (await (tools[tool] as (i: unknown, c: unknown) => Promise<unknown>)(input, ctx)) as Reply;
  const ms = Date.now() - started;
  const text = builderText(reply);
  said.push({ journey, label, text, ms, reply, agentText: JSON.stringify(reply), first: o.first ?? false });
  if (process.env.V210_DUMP) console.log(`---- ${journey} ${label} (${ms} ms)\n${text}\n${JSON.stringify(reply).slice(0, 2000)}`);
  assert.ok(ms < MAX_REPLY_MS, `${journey} ${label}: replied in ${ms} ms`);
  return reply;
}
const forty = (journey: string) => said.filter((s) => s.journey === journey).reduce((n, s) => n + (s.text.match(/40%/g)?.length ?? 0), 0);
const fortyAt = (journey: string) => said.filter((s) => s.journey === journey && /40%/.test(s.text)).map((s) => s.label);
const dump = (journey: string) => said.filter((s) => s.journey === journey).map((s) => `[${s.label}]\n${s.text}`).join('\n\n');

const CC = { browser: true, can_push: true };
const GROK = { browser: false, can_push: false };
const W = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
const W2 = '0x2222222222222222222222222222222222222abc';

/** The form answers the agent drafts for Arc Microgrants, in plain words (item 11). */
function answersFor(programId: string, over: Record<string, string> = {}) {
  const DRAFT: Record<string, string> = {
    description: 'TipJar lets fans tip creators in USDC on Arc, and creators get paid in seconds.',
    builder_profile: 'https://github.com/jenil',
    full_name: 'Jenil Doe',
    email: 'jenil@tipjar.xyz',
    x_handle: '@jenil',
    telegram: '@jenil',
    project_name: 'TipJar',
    project_name_description: 'TipJar: tips for creators in USDC.',
    one_sentence_description: 'Tips for creators in USDC.',
    summary: 'TipJar lets fans tip creators in USDC on Arc.',
    x_profile: '@jenil',
  };
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

/** A curated program's file with a new deadline (the real upsert, so every derived label moves too). */
async function setDeadline(programId: string, endsAt: string) {
  const raw = JSON.parse(readFileSync(join(PROGRAMS_DIR, `${programId}.json`), 'utf8'));
  // The summary's own "closes <day>" is what replies say (entry-text.ts closeDayOf), so it moves too.
  const summary = endsAt === FAR ? raw.summary : String(raw.summary).replace(/closes [A-Z][a-z]{2} \d{1,2}/, `closes ${shortDay(endsAt)}`);
  await upsertProgram(ProgramFile.parse({ ...raw, summary, status: 'active', ends_at: endsAt }));
}
const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
const PROJECT_LINKS = { name: 'TipJar', description: 'Fans tip creators in USDC on Arc.', repo_url: 'https://github.com/jenil/arc-usdc-tipjar', live_url: 'https://tipjar.xyz' };

test('11.0 the owner\'s run: private tokens.fun and EarnKit repos and a public tipjar; one lead line, the guide on the pick, an Arc deploy, one yes with "40%" once, a plain description, the site icon, the deadline line', dbTest, () =>
  withEnv({ ...SIGN_IN, ...DEPLOYS }, async () => {
    const J = '11.0';
    const id = await newInstallation();
    const ctx = ctxFor(id);
    // The owner's GitHub: tokens.fun and EarnKit are private (404 to anyone else); the tipjar is
    // public, with a live site, an Arc hardhat network, 12 recent commits and the proof line.
    addRepos('jenil', [
      ghRepo('jenil', 'tokens.fun', { private: true, visibility: 'private', homepage: 'https://tokens.fun' }),
      ghRepo('jenil', 'earnkit', { private: true, visibility: 'private', homepage: 'https://earnkit.com' }),
      ghRepo('jenil', 'arc-usdc-tipjar', { homepage: 'https://tipjar.xyz', description: 'Tips for creators in USDC on Arc' }),
    ]);
    GITHUB.arcConfig.add('jenil/arc-usdc-tipjar');
    PUSHED.add('jenil/arc-usdc-tipjar');
    // Arc closes in a little over 2 days (inside the deadline line's 3).
    const arcEnds = new Date(NOW + 2.25 * 86_400_000).toISOString();
    await setDeadline('arc-microgrants', arcEnds);
    try {
      const repos = ['jenil/tokens.fun', 'jenil/earnkit', 'jenil/arc-usdc-tipjar'];
      const local_repos = [
        { name: 'tokens.fun', url: 'https://github.com/jenil/tokens.fun', chains: [{ chain: 'base', mainnet: true }], live_url: 'https://tokens.fun', last_commit_at: daysAgo(1) },
        { name: 'earnkit', url: 'https://github.com/jenil/earnkit', chains: [{ chain: 'base', mainnet: true }], live_url: 'https://earnkit.com', last_commit_at: daysAgo(1) },
        { name: 'arc-usdc-tipjar', url: 'https://github.com/jenil/arc-usdc-tipjar', chains: [{ chain: 'arc', mainnet: true }], live_url: 'https://tipjar.xyz', last_commit_at: daysAgo(1) },
      ];

      // "What can I earn?": the private repos are matched from the local copy (one line each), then
      // one lead line with its question. No table, no bonus line, no token, no deadline (no entry yet).
      const first = await call(J, 'what can I earn', 'find', { github_user: 'jenil', repos, local_repos }, ctx, { first: true });
      const lines = first.show_to_builder!.split('\n');
      assert.deepEqual(lines, [
        'tokens.fun is private, so I matched it from your local copy.',
        'earnkit is private, so I matched it from your local copy.',
        `Your arc-usdc-tipjar can win 500 USDC on Arc by ${shortDay(arcEnds)}. Want me to finish it?`,
      ]);
      assert.deepEqual(first.lead, { program_id: 'arc-microgrants', repo: 'arc-usdc-tipjar' });
      assert.ok(!('token_offer' in first));
      // "Show more": the v2.9 tables, the Arc row Easy with the tipjar.
      const more = await call(J, 'show more', 'find', { github_user: 'jenil', repos, local_repos, more: true }, ctx);
      assert.match(more.show_to_builder!, /\n\| Arc Microgrants \| 500 USDC × 20 grants \| Easy \| .+ \| arc-usdc-tipjar \|\n/, more.show_to_builder);

      // Picking Arc: the guide first, then the coach's one question.
      const program = 'arc-microgrants';
      const pick = await call(J, 'pick Arc', 'prepare', { program_id: program, project: PROJECT_LINKS, agent: CC }, ctx);
      assert.match(pick.show_to_builder!, /^Arc Microgrants · 500 USDC × 20 grants · ends .+\nDifficulty: Easy\n\nWhat won before\n[\s\S]+\nYour best bet\n- .+\n\nArc Microgrants: 1 quick question/, pick.show_to_builder);

      // EarnKit deploys the tipjar on Arc (the deployer's fake chain): creation, then
      // transferOwnership(builder). The address is in this draft's contract check (no "No contract
      // found" fix next to the deployed line) and in `deploy` for the agent, never in an answer.
      const answers = { ...answersFor(program), payout_wallet: W };
      const dep = await call(J, 'deploy on Arc', 'prepare', { program_id: program, project: PROJECT_LINKS, agent: CC, answers, coach_asked: true, deploy: { chain: 'arc', bytecode: TIPJAR_BYTECODE, abi: OWNABLE_ABI, owner_wallet: W } }, ctx);
      assert.deepEqual(dep.deploy, { address: ARC_DEPLOYED, chain: 'arc', owner_ok: true });
      assert.deepEqual(chainLog.filter((x) => x !== 'estimate'), ['send', `transferOwnership(${W})`]);
      assert.equal(deployedLine('TipJar', 'arc', ARC_DEPLOYED, true), "TipJar is deployed on Arc: 0x12ab…9f3e. You're the owner.");
      assert.ok(dep.show_to_builder!.endsWith("\n\nTipJar is deployed on Arc: 0x12ab…9f3e. You're the owner."), dep.show_to_builder);
      assert.doesNotMatch(dep.show_to_builder!, /No contract found/);
      assert.equal(dep.ready, true, dep.show_to_builder);
      // The one confirm line: the token pitch with "40%", once.
      assert.match(dep.show_to_builder!, /\n\nReady\. Yes submits your entry and launches \$TIPJAR \(TipJar\): 40% of its fees to you, plus the builder bonus\. Wallet: 0x1581…b9a3\. yes \/ skip the token\n\n/);
      const project = { ...PROJECT_LINKS, contracts: [ARC_DEPLOYED] };
      const draft = await call(J, 'draft again', 'prepare', { program_id: program, project, agent: CC, answers, coach_asked: true }, ctx);
      assert.doesNotMatch(draft.show_to_builder!, /What won before|40%/, 'no guide and no second pitch');
      assert.ok(draft.show_to_builder!.endsWith('Ready. Yes submits your entry and launches $TIPJAR (TipJar). Wallet: 0x1581…b9a3. yes / skip the token'), draft.show_to_builder);

      // A description with an address and a stats list: confirm refuses yes, for the agent only.
      const dirty = { ...answers, description: `TipJar at ${ARC_DEPLOYED}: TVL: 10, tips: 900, users: 120, creators: 40.` };
      const refused = await call(J, 'yes (address in the description)', 'confirm', { program_id: program, project, answers: dirty, yes: true, wallet: W, agent: CC }, ctx);
      assert.equal(refused.show_to_builder, undefined);
      assert.deepEqual((refused.agent_fixes as { rule: string }[]).map((f) => f.rule), ['not_plain']);
      assert.equal(deployed.length, 0, 'nothing launched');

      // Yes: the entry and the launch. tokens.fun gets the live link, the site's apple-touch-icon
      // (stored, served from EarnKit) and the plain description.
      const c = await call(J, 'yes', 'confirm', { program_id: program, project, answers, yes: true, wallet: W, agent: CC }, ctx);
      assert.match(c.show_to_builder!, /^Your token \$TIPJAR is live: tokens\.fun\/coin\/0x/, c.show_to_builder);
      assert.ok(c.kit);
      assert.equal(deployed.length, 1);
      const sent = deployed[0];
      assert.deepEqual([sent.symbol, sent.wallet, sent.website], ['TIPJAR', W, 'https://tipjar.xyz/']);
      assert.equal(sent.description, 'Fans tip creators in USDC on Arc.');
      assert.doesNotMatch(sent.description, /0x[0-9a-f]{40}/i);
      assert.match(sent.imageUrl, new RegExp(`/api/projects/${c.project_id}/image$`));
      assert.deepEqual(iconsRead, ['https://tipjar.xyz/apple-touch-icon.png']);
      const verifiedAt = async () => (await sql()<{ v: Date | null }[]>`SELECT contract_verified_at AS v FROM projects WHERE id = ${c.project_id as number}`)[0].v;
      assert.ok(await verifiedAt(), 'the deployed contract counts as deployed at confirm');
      const [img] = await sql()<{ token_image: Buffer | null }[]>`SELECT token_image FROM projects WHERE id = ${c.project_id as number}`;
      assert.ok(img.token_image && Buffer.compare(img.token_image, PNG) === 0, 'the icon is stored');

      // Later: entries, then the deadline line (once that day), then the lead.
      const later = await call(J, 'later', 'find', { github_user: 'jenil', repos: ['jenil/arc-usdc-tipjar'], local_repos }, ctx);
      assert.match(later.show_to_builder!, /^Your entries: Arc Microgrants \(TipJar, not submitted yet\)\.\nArc Microgrants closes in 2 days; your entry isn't submitted\.\n/, later.show_to_builder);
      const again = await call(J, 'later again', 'find', { github_user: 'jenil', repos: ['jenil/arc-usdc-tipjar'], local_repos }, ctx);
      assert.doesNotMatch(again.show_to_builder!, /closes in/, 'once per entry per day');
      const sub = await call(J, 'I submitted', 'tell', { submitted: { program_id: program, external_submission_url: 'https://dorahacks.io/buidl/1001' } }, ctx);
      assert.match(sub.show_to_builder!, /^Entered in Arc Microgrants\./);
      const [row] = await sql()<{ submission_confirmed_at: Date | null; contract_verified_at: Date | null }[]>`
        SELECT submission_confirmed_at, contract_verified_at FROM projects WHERE id = ${c.project_id as number}`;
      assert.ok(row.submission_confirmed_at, 'submitted');
      assert.ok(row.contract_verified_at, 'the deployed contract counts as deployed');
      assert.equal(forty(J), 1, dump(J));
      assert.deepEqual(fortyAt(J), ['deploy on Arc']);
    } finally {
      await setDeadline('arc-microgrants', FAR);
    }
  }),
);

const ALICE_TIPJAR = { name: 'TipJar', description: 'Fans tip creators in USDC on Arc.', repo_url: 'https://github.com/alice/tipjar', live_url: 'https://tipjar-alice.xyz' };

test('11.1 Claude Code, a private repo and the App: the private line and one lead line; the App link, its sign-in and install; scored through the App; the guide, an Arc deploy, one yes, a launch that never shows the repo', dbTest, () =>
  withEnv({ ...APP, ...DEPLOYS }, async () => {
    const J = '11.1';
    const id = await newInstallation();
    const ctx = ctxFor(id);
    addRepos('alice', [ghRepo('alice', 'tipjar', { private: true, visibility: 'private', homepage: 'https://tipjar-alice.xyz', description: 'Tips for creators in USDC on Arc' })]);
    GITHUB.arcConfig.add('alice/tipjar');
    PUSHED.add('alice/tipjar');
    const local_repos = [{ name: 'tipjar', url: 'https://github.com/alice/tipjar', chains: [{ chain: 'arc', mainnet: true }], live_url: 'https://tipjar-alice.xyz', last_commit_at: daysAgo(1) }];

    // Claude Code's first call names the repo only: GitHub says 404 and nobody described it, so the
    // can't-see line carries the App link (item 7b on), then one lead line.
    const first = await call(J, 'what can I earn', 'find', { repos: ['alice/tipjar'] }, ctx, { first: true });
    const [cantSee, ...lead] = first.show_to_builder!.split('\n');
    const link = cantSee.match(/^I can't see tipjar \(private\?\)\. Describe it, or allow read access: (https:\/\/earnkit\.com\/github\/verify\?n=[\w-]+)$/)?.[1];
    assert.ok(link, first.show_to_builder);
    assert.equal(lead.length, 1, first.show_to_builder);
    // The agent describes it from the local copy: the private line, then one lead line; "show more"
    // shows the tables.
    const local = await call(J, 'find (local view)', 'find', { repos: ['alice/tipjar'], local_repos }, ctx);
    const [priv, ...leadLines] = local.show_to_builder!.split('\n');
    // Final fix I2 (ledger c1): the App is on and tipjar has no App proof yet, so the private line
    // offers the App link once, on the same line (no extra question).
    assert.match(priv, /^tipjar is private, so I matched it from your local copy\. For a fuller match, allow read access: https:\/\/earnkit\.com\/github\/verify\?n=[\w-]+$/, local.show_to_builder);
    assert.equal(leadLines.length, 1);
    assert.match(leadLines[0], /^Your tipjar can win 500 USDC on Arc by [A-Z][a-z]{2} \d{1,2}\. Want me to finish it\?$/);
    const more = await call(J, 'show more', 'find', { repos: ['alice/tipjar'], local_repos, more: true }, ctx);
    assert.match(more.show_to_builder!, /\| Program \| Prize \| Difficulty \| Ends/, more.show_to_builder);

    // The builder opens it: the sign-in hop, then GitHub's install page for the App (state = the nonce).
    const hop = await browserSignIn(link!, 'alice');
    assert.ok(hop.install, 'the App link goes on to the install page');
    assert.equal(hop.install!.origin + hop.install!.pathname, 'https://github.com/apps/earnkit-read/installations/new');
    const state = hop.install!.searchParams.get('state')!;
    // On GitHub: the builder installs the App on alice's account, picking tipjar; GitHub redirects to the setup URL.
    GITHUB.installs.set(77, { account: 'alice', repos: ['alice/tipjar'] });
    const setup = await appSetup(new Request(`https://earnkit.com/github/verify/app?installation_id=77&setup_action=install&state=${encodeURIComponent(state)}`, { headers: { ...ip, cookie: hop.cookie } }));
    assert.equal(setup.status, 200, await setup.clone().text());
    const rows = await sql()<{ via: string; login: string; repo_key: string }[]>`SELECT via, login, repo_key FROM github_verifications WHERE installation_id = ${id}`;
    assert.deepEqual(rows.map((r) => ({ ...r })), [{ via: 'app', login: 'alice', repo_key: 'alice/tipjar' }]);

    // find again: scored through the App's token (traction from the live link and 12 commits), good
    // odds, and the lead names it.
    const tokensBefore = minted.length;
    const scored = await call(J, 'find (through the App)', 'find', { repos: ['alice/tipjar'] }, ctx);
    assert.ok(minted.length > tokensBefore, 'read through an App token');
    assert.match(scored.show_to_builder!, /^Your tipjar can win 500 USDC on Arc by [A-Z][a-z]{2} \d{1,2}\. Want me to finish it\?$/m, scored.show_to_builder);
    assert.deepEqual(scored.lead, { program_id: 'arc-microgrants', repo: 'tipjar' });

    // Arc: the guide first, then the questions.
    const program = 'arc-microgrants';
    const pick = await call(J, 'pick Arc', 'prepare', { program_id: program, project: ALICE_TIPJAR, agent: CC }, ctx);
    assert.match(pick.show_to_builder!, /^Arc Microgrants · [\s\S]+\n\nWhat won before\n[\s\S]+\n\nArc Microgrants: 1 quick question/);
    // The deploy: ownership through the App proof; the builder line; the address only in `deploy`.
    const answers = { ...answersFor(program, { builder_profile: 'https://github.com/alice' }), payout_wallet: W };
    const dep = await call(J, 'deploy on Arc', 'prepare', { program_id: program, project: ALICE_TIPJAR, agent: CC, answers, coach_asked: true, deploy: { chain: 'arc', bytecode: TIPJAR_BYTECODE, abi: OWNABLE_ABI, owner_wallet: W } }, ctx);
    assert.ok(dep.show_to_builder!.endsWith("\n\nTipJar is deployed on Arc: 0x12ab…9f3e. You're the owner."), dep.show_to_builder);
    assert.doesNotMatch(dep.show_to_builder!, /What won before/);
    const project = { ...ALICE_TIPJAR, contracts: [(dep.deploy as { address: string }).address] };
    const draft = await call(J, 'draft again', 'prepare', { program_id: program, project, agent: CC, answers, coach_asked: true }, ctx);
    assert.doesNotMatch(draft.show_to_builder!, /What won before/);
    assert.match(draft.show_to_builder!, /Ready\. Yes submits your entry and launches \$TIPJAR \(TipJar\)/);

    // Yes: the entry and the launch through the App (the proof line read with its token).
    const c = await call(J, 'yes', 'confirm', { program_id: program, project, answers, yes: true, wallet: W, agent: CC }, ctx);
    assert.equal((c.token as { status: string }).status, 'launched', JSON.stringify(c));
    const sent = deployed.at(-1)!;
    assert.deepEqual([sent.symbol, sent.wallet, sent.website], ['TIPJAR', W, 'https://tipjar-alice.xyz/']);
    assert.equal(sent.description, 'Fans tip creators in USDC on Arc.');
    assert.match(sent.imageUrl, new RegExp(`/api/projects/${c.project_id}/image$`));
    assert.ok(!JSON.stringify(sent).includes('github.com/alice'), 'tokens.fun never gets the private repo');
    // tell: submitted.
    const sub = await call(J, 'I submitted', 'tell', { submitted: { program_id: program, external_submission_url: 'https://dorahacks.io/buidl/2002' } }, ctx);
    const [row] = await sql()<{ submission_confirmed_at: Date | null; repo_private: boolean }[]>`SELECT submission_confirmed_at, repo_private FROM projects WHERE id = ${c.project_id as number}`;
    assert.ok(row.submission_confirmed_at, 'submitted');
    assert.equal(row.repo_private, true);
    // The public pages show the project, never the private repo.
    // /p/<id> is a campaign entry's page; this entry's is a 404, so it shows nothing.
    assert.equal(await getProjectPage(c.project_id as number), null);
    const roundKey = (sub.bonus_round as { key: string } | undefined)?.key;
    assert.ok(roundKey, JSON.stringify(sub));
    const board = await bonusBoard(roundKey!);
    assert.ok(board && JSON.stringify(board).includes('TipJar'), JSON.stringify(board));
    assert.doesNotMatch(JSON.stringify(board), /alice\/tipjar/i);
    assert.equal(forty(J), 1, dump(J));
  }),
);

test('11.2 Grok Bot to a launched token (shared client, sign-in on): no remembered data and no deadline line without the code; yes gives the sign-in line; the code launches to the signed-in wallet; a second builder sees none of it', dbTest, () =>
  withEnv(SIGN_IN, async () => {
    const J = '11.2';
    addRepos('kim', [ghRepo('kim', 'TipJar', { homepage: 'https://tipjar-kim.xyz', description: 'Tips for creators in USDC' })]);
    GITHUB.arcConfig.add('kim/tipjar');
    const inst = await newInstallation({ shared: true });
    const ctx = ctxFor(inst, { shared: true });
    const arcEnds = new Date(NOW + 2.25 * 86_400_000).toISOString();
    await setDeadline('arc-microgrants', arcEnds);
    try {
      const first = await call(J, 'what can I earn', 'find', { agent_can_build: false, repos: ['kim/TipJar'] }, ctx, { first: true });
      assert.deepEqual(first.show_to_builder!.split('\n'), [`Your TipJar can win 500 USDC on Arc by ${shortDay(arcEnds)}. Want me to finish it?`]);
      const program = 'arc-microgrants';
      const project = { name: 'TipJar', description: 'Fans tip creators in USDC on Arc.', repo_url: 'https://github.com/kim/TipJar', live_url: 'https://tipjar-kim.xyz' };
      const answers = { ...answersFor(program, { builder_profile: 'https://github.com/kim' }), payout_wallet: W2 };
      const pick = await call(J, 'pick Arc', 'prepare', { program_id: program, project, agent: GROK }, ctx);
      assert.match(pick.show_to_builder!, /^Arc Microgrants · /);
      const d = await call(J, 'draft', 'prepare', { program_id: program, project, agent: GROK, answers, coach_asked: true }, ctx);
      // No remembered wallet on a shared client (G13): only the one given in this flow.
      assert.ok(d.show_to_builder!.endsWith('Ready. Yes submits your entry and launches $TIPJAR (TipJar): 40% of its fees to you, plus the builder bonus. Wallet: 0x2222…2abc. yes / skip the token'), d.show_to_builder);
      // Yes: Grok Bot can't push, so the sign-in line (G10); nothing launched.
      const before = deployed.length;
      const yes = { program_id: program, project, answers, yes: true, wallet: W2, agent: GROK };
      const asked = await call(J, 'yes', 'confirm', yes, ctx);
      assert.match(asked.show_to_builder!, /^One click to prove TipJar is yours, then \$TIPJAR launches: https:\/\/earnkit\.com\/github\/verify\?n=[\w-]{43}$/, asked.show_to_builder);
      assert.equal(deployed.length, before);
      const signIn = await browserSignIn((asked.token as { sign_in: string }).sign_in, 'kim');
      const code = signIn.last.match(/^Done\. Paste this code to your agent: ([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2})$/)?.[1];
      assert.ok(code, signIn.last);
      // With the code: $TIPJAR launches to the wallet the sign-in named (G11).
      const c = await call(J, 'yes, signed in', 'confirm', { ...yes, signed_in: code }, ctx);
      assert.equal((c.token as { status: string }).status, 'launched', JSON.stringify(c));
      assert.deepEqual(deployed.slice(before).map((x) => [x.symbol, x.wallet]), [['TIPJAR', W2]]);
      // The signed-in builder's next reply has the deadline line; with no code, nothing of theirs.
      const mine = await call(J, 'find, signed in', 'find', { agent_can_build: false, repos: ['kim/TipJar'], signed_in: code }, ctx);
      assert.match(mine.show_to_builder!, /^Arc Microgrants closes in 2 days; your entry isn't submitted\.$/m, mine.show_to_builder);
      // A second builder on the same installation (no code): no entries, no deadline, no wallet.
      const other = await call(J, 'another builder', 'find', { agent_can_build: false }, ctx);
      assert.doesNotMatch(other.show_to_builder!, /Your entries|closes in|TipJar|0x2222/, other.show_to_builder);
      const told = await call(J, 'another builder: I submitted', 'tell', { submitted: { program_id: program, project_id: c.project_id as number } }, ctx);
      assert.equal(told.show_to_builder, 'Noted for now.');
      const [row] = await sql()<{ submission_confirmed_at: Date | null }[]>`SELECT submission_confirmed_at FROM projects WHERE id = ${c.project_id as number}`;
      assert.equal(row.submission_confirmed_at, null, 'nothing written for another builder');
      // kim, with the code: submitted.
      await call(J, 'I submitted (signed in)', 'tell', { submitted: { program_id: program, project_id: c.project_id as number }, signed_in: code }, ctx);
      const [done] = await sql()<{ submission_confirmed_at: Date | null }[]>`SELECT submission_confirmed_at FROM projects WHERE id = ${c.project_id as number}`;
      assert.ok(done.submission_confirmed_at);
      assert.equal(forty(J), 1, dump(J));
      assert.deepEqual(fortyAt(J), ['draft']);
    } finally {
      await setDeadline('arc-microgrants', FAR);
    }
  }),
);

test('11.3 an old agent: confirm_entry with decision "go" through the MCP route reaches confirm, logs the alias once, and tools/list still has the 4 tools', dbTest, async () => {
  const token = `v210-route-${process.pid}-${Date.now()}`;
  await saveInstallation(token);
  const post = (id: number, method: string, params: object) =>
    mcpPost(
      new Request('https://earnkit.com/mcp', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      }),
    );
  const project = { name: 'Relay', repo_url: 'https://github.com/rio/relay', live_url: 'https://relay.xyz' };
  const answers = answersFor('arc-microgrants', { builder_profile: 'https://github.com/rio' });
  const logs: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
  let reply: Reply;
  let names: string[];
  try {
    const res = await post(1, 'tools/call', { name: 'confirm_entry', arguments: { program_id: 'arc-microgrants', project, answers, decision: 'go', builder_confirmed: true, wallet: W } });
    const body = (await res.json()) as { result?: { content: { text: string }[]; isError?: boolean } };
    assert.ok(body.result && !body.result.isError, JSON.stringify(body));
    reply = JSON.parse(body.result.content[0].text) as Reply;
    const listed = (await (await post(2, 'tools/list', {})).json()) as { result: { tools: { name: string }[] } };
    names = listed.result.tools.map((t) => t.name).sort();
  } finally {
    console.log = log;
  }
  said.push({ journey: '11.3', label: 'old confirm_entry', text: builderText(reply), ms: 0, reply, agentText: JSON.stringify(reply), first: false });
  // The builder never saw this token, so confirm shows its one line and launches nothing.
  assert.match(reply.show_to_builder!, /Yes submits your entry and launches \$RELAY \(Relay\): 40% of its fees to you, plus the builder bonus\. Wallet: 0x1581…b9a3\. yes \/ skip the token$/, reply.show_to_builder);
  assert.ok(!reply.kit);
  assert.deepEqual(logs.filter((l) => l.startsWith('[mcp] alias')), ['[mcp] alias confirm_entry -> confirm']);
  assert.deepEqual(names, ['confirm', 'find', 'prepare', 'tell']);
});

test('11.4 every journey reply: under 50 s; at most one bonus line; the first reply is one lead line (after private-repo lines only); "40%" only on the confirm line; no WETH, gas, terms link, emoji, em dash, "coin", "vault", "Clanker" or tool name; "skip" only as "skip the token"; no address in any description field; nothing else on the network', dbTest, async () => {
  assert.ok(said.length > 25, `${said.length} replies`);
  const coinWords = (text: string) =>
    text
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\b[\w-]+(?:\.[\w-]+)+\/\S*/g, ' ')
      .match(/\bcoins?\b/gi) ?? [];
  // The old names (and sponsor_campaign) anywhere; the new ones in a call shape.
  const toolName = new RegExp(
    `\\b(${[...OLD_TOOL_NAMES, 'sponsor_campaign'].join('|')})\\b|\\bcall(s|ing)? (find|prepare|confirm|tell)\\b|\\b(find|prepare|confirm|tell)( with\\b|\\()|\\bthe (find|prepare|confirm|tell) tool\\b`,
  );
  const confirmLine = /^(Ready\. )?Yes submits your entry and launches \$[A-Z0-9]+ \(.+\)(: 40% of its fees to you(, plus the builder bonus)?)?\.( Wallet: 0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}\.| Say yes with your wallet address\.)? yes \/ skip the token$/;
  const otherFirstLine = /^(.+ is private, so I matched it from your local copy\.|I can't see .+ \(private\?\)\. Describe it.*)$/;
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
    assert.doesNotMatch(s.text, /\bWETH\b|\bgas\b|token-creator-agreement|risk-disclosure|\/terms\b/, `${where}: ${s.text}`);
    assert.ok((s.text.match(/Builder bonus:/g)?.length ?? 0) <= 1, where);
    const lines = s.text.split('\n');
    for (const line of lines.filter((l) => /\bskip\b/i.test(l))) assert.match(line, /\/ skip the token$/, `${where}: ${line}`);
    for (const line of lines.filter((l) => /40%/.test(l))) assert.match(line, confirmLine, `${where}: ${line}`);
    if (s.first) {
      const shown = s.reply.show_to_builder!.split('\n');
      assert.match(shown.at(-1)!, /^(Your .+ can win .+\. Want me to finish it\?|No repo fits yet\. .+ is open; want the 3 easiest\?)$/, `${where}: ${s.reply.show_to_builder}`);
      for (const line of shown.slice(0, -1)) assert.match(line, otherFirstLine, `${where}: ${line}`);
      assert.ok(!('token_offer' in s.reply), where);
    }
  }
  // Every journey said "40%" exactly once (11.3's old agent saw only its confirm line).
  for (const j of ['11.0', '11.1', '11.2', '11.3']) assert.equal(forty(j), 1, `${j}\n${dump(j)}`);
  // No address in any description field: the entries' stored description answers and tokens.fun's.
  const entries = await sql()<{ description: string | null; answers: Record<string, unknown> | null }[]>`
    SELECT description, application -> 'answers' AS answers FROM projects`;
  assert.ok(entries.length >= 3);
  for (const e of entries) {
    assert.doesNotMatch(e.description ?? '', /0x[0-9a-fA-F]{40}/);
    for (const k of ['description', 'one_sentence_description', 'summary', 'project_name_description'])
      assert.doesNotMatch(String(e.answers?.[k] ?? ''), /0x[0-9a-fA-F]{40}/, k);
  }
  for (const d of deployed) assert.doesNotMatch(d.description, /0x[0-9a-fA-F]{16,}/, d.symbol);
  // Nothing tried the network but the alerts' soft WETH price read (DefiLlama, cached, fails soft).
  assert.deepEqual(blocked.filter((u) => !u.startsWith('https://coins.llama.fi/')), []);
});
