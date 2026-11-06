/**
 * Preloaded (`--import`) by the v5 test runs, so no test reaches an outside service whatever the shell exports:
 * the vendor keys are cleared, and `fetch`, http(s) and dns reach only this machine. A test that needs another
 * host injects its own fetch. Each test file gets its own database (test-db.ts).
 */
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { perFileDatabase } from './test-db';
const CLEARED = ['RESEND_API_KEY', 'GITHUB_TOKEN', 'EARNKIT_PROGRAMS_TOKEN', 'GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET'];
for (const name of CLEARED) delete process.env[name];
// One database per test file (test-db.ts); a no-op outside a test-runner child.
perFileDatabase();

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

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

/** localhost, 127.0.0.1, ::1 (bare or bracketed). */
const isLocal = (host: string) => LOCAL.has(host) || LOCAL.has(`[${host}]`) || host === '::1';

const require = createRequire(import.meta.url);
// TEST_GUARD_LOG=<file>: every refused host is appended there too (a catch can swallow the throw),
// so a whole run can be checked for outside connection attempts.
const logFile = process.env.TEST_GUARD_LOG;
const refuse = (what: string, host: string) => {
  if (logFile) (require('node:fs') as typeof import('node:fs')).appendFileSync(logFile, `${what} ${host}\n`);
  return new Error(`test guard: no network in tests (${what} ${host}); inject a fake`);
};

{
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
