/**
 * v2.9 Part 2 final review I3: preloaded (`--import`) by `pnpm test` and the local e2e scripts, so
 * no test reaches a real outside service whatever the shell exports.
 * - The keys that turn on a real vendor are cleared: tokens.fun launches, Resend mail, R2 writes and
 *   GitHub sign-in, the read-only GitHub App and the contract deployer. A test that needs one on sets its own (fake) value.
 * - `fetch` reaches only this machine (localhost, 127.0.0.1, ::1) and the anvil in BONUS_ANVIL_URL;
 *   anything else throws, so a test that needs another host injects its own fetch or fake.
 * - v2.10 final fix I3: `https.request`, `https.get`, `http.request`, `http.get` (safe-fetch's
 *   transport) and the dns lookups and c-ares queries (safe-fetch's resolver) refuse the same outside hosts, so no
 *   safeFetch caller (the submission-proof page, the logo reads, the link probe) leaves the machine.
 * The opt-in network tests (`LINK_CHECK=1`, footer-links.test.ts; `EARNKIT_MODEL_TEST=1`, originality.test.ts) keep the real network.
 */
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { perFileDatabase } from './test-db';
const CLEARED = [
  'TOKENSFUN_DEPLOY_API_KEY',
  // Alchemy's Base reads (alchemy.ts; a test passes its own call).
  'ALCHEMY_API_KEY',
  'RESEND_API_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'GITHUB_OAUTH_CLIENT_ID',
  'GITHUB_OAUTH_CLIENT_SECRET',
  // v2.10 item 7b: the read-only GitHub App (a test that needs it on sets a generated key).
  'GITHUB_APP_ID',
  'GITHUB_APP_SLUG',
  'GITHUB_APP_PRIVATE_KEY',
  // v2.10 item 13: EarnKit's contract deployer (a test that needs it on sets an anvil dev key).
  'DEPLOYER_PRIVATE_KEY',
  // Weekly updates: the Haiku summary (a test passes its own fake create).
  'ANTHROPIC_API_KEY',
  // v2.10.3: the deploy chains (unset is both; a test that narrows them sets its own).
  'DEPLOY_CHAINS',
  // v2.11 Task 2: the builder event log (a test that needs it on sets it).
  'EARNKIT_EVENT_LOG',
  // v2.12: the four archive flags (a test that needs one on sets it).
  'EARNKIT_SPONSOR_CAMPAIGNS',
  'EARNKIT_STARTER_REGISTRY',
  'EARNKIT_PROGRAM_LEADERBOARDS',
  'EARNKIT_TOOL_ALIASES',
  // v2.12.1: Sign in with X and the Base agent codes (new vendor switches; a test that needs one sets a fake).
  'X_CLIENT_ID',
  'X_CLIENT_SECRET',
  'EARNKIT_BASE_AGENT_CODES',
  // v2.13 final fix: the Raising pill and asks (a test that needs it on sets it).
  'EARNKIT_RAISING',
];
for (const name of CLEARED) delete process.env[name];
// Scoring and clarity R3: Originality's local model is never loaded (or downloaded) in a test; a test passes a fake
// embedder. The one opt-in model test (EARNKIT_MODEL_TEST=1, originality.test.ts) keeps it.
if (process.env.EARNKIT_MODEL_TEST === '1') delete process.env.EARNKIT_EMBED_OFF;
else process.env.EARNKIT_EMBED_OFF = '1';
// v2.14 T2: one database per test file (fixtures/test-db.ts); a no-op outside a test-runner child.
perFileDatabase();

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
for (const url of [process.env.BONUS_ANVIL_URL]) {
  try {
    if (url) LOCAL.add(new URL(url).hostname);
  } catch {
    // Not a URL: nothing to allow.
  }
}

/** The host a fetch call is for. */
function hostOf(input: RequestInfo | URL): string {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  return url.hostname;
}

/** The host an http(s).request / get call is for (a URL, a URL string, or options). */
function requestHost(args: unknown[]): string {
  const [a] = args;
  if (typeof a === 'string') return new URL(a).hostname;
  if (a instanceof URL) return a.hostname;
  const o = (a ?? {}) as { hostname?: string | null; host?: string | null };
  return (o.hostname ?? o.host ?? 'localhost').replace(/:\d+$/, '');
}

/** localhost, 127.0.0.1, ::1 (bare or bracketed) and the allowed anvil host. */
const isLocal = (host: string) => LOCAL.has(host) || LOCAL.has(`[${host}]`) || host === '::1';

const require = createRequire(import.meta.url);
// TEST_GUARD_LOG=<file>: every refused host is appended there too (a catch can swallow the throw),
// so a whole run can be checked for outside connection attempts.
const logFile = process.env.TEST_GUARD_LOG;
const refuse = (what: string, host: string) => {
  if (logFile) (require('node:fs') as typeof import('node:fs')).appendFileSync(logFile, `${what} ${host}\n`);
  return new Error(`test guard: no network in tests (${what} ${host}); inject a fake`);
};

// The opt-in model test (EARNKIT_MODEL_TEST=1) downloads the model from Hugging Face once, so it keeps the network too.
if (process.env.LINK_CHECK !== '1' && process.env.EARNKIT_MODEL_TEST !== '1') {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const host = hostOf(input);
    if (!LOCAL.has(host)) return Promise.reject(refuse('fetch to', host));
    return real(input, init);
  }) as typeof fetch;

  for (const name of ['http', 'https'] as const) {
    const mod = require(`node:${name}`) as Record<'request' | 'get', (...args: unknown[]) => unknown>;
    for (const fn of ['request', 'get'] as const) {
      const real = mod[fn];
      mod[fn] = (...args: unknown[]) => {
        const host = requestHost(args);
        if (!isLocal(host)) throw refuse(`${name}.${fn} to`, host);
        return real(...args);
      };
    }
  }
  const dns = require('node:dns') as {
    lookup: (host: string, ...rest: unknown[]) => unknown;
    promises: { lookup: (host: string, ...rest: unknown[]) => Promise<unknown> };
  };
  const realLookup = dns.lookup;
  dns.lookup = (host: string, ...rest: unknown[]) => {
    if (!isLocal(host)) {
      const cb = rest.at(-1);
      if (typeof cb === 'function') return void process.nextTick(cb, refuse('dns lookup of', host));
      throw refuse('dns lookup of', host);
    }
    return realLookup(host, ...rest);
  };
  const realPromiseLookup = dns.promises.lookup;
  dns.promises.lookup = (host: string, ...rest: unknown[]) =>
    isLocal(host) ? realPromiseLookup(host, ...rest) : Promise.reject(refuse('dns lookup of', host));
  // safe-fetch resolves through c-ares (`dns.promises.Resolver`), not lookup: its queries too.
  const dnsPromises = require('node:dns/promises') as { Resolver: { prototype: Record<string, unknown> } };
  for (const proto of [dnsPromises.Resolver.prototype, (require('node:dns') as typeof dnsPromises).Resolver.prototype])
    for (const fn of ['resolve', 'resolve4', 'resolve6', 'resolveAny'] as const) {
      const real = proto[fn] as (this: unknown, host: string, ...rest: unknown[]) => unknown;
      proto[fn] = function (this: unknown, host: string, ...rest: unknown[]) {
        if (isLocal(host)) return real.call(this, host, ...rest);
        const err = refuse('dns query for', host);
        const cb = rest.at(-1);
        if (typeof cb === 'function') return void process.nextTick(cb, err);
        return Promise.reject(err);
      };
    }
  syncBuiltinESMExports();
}
