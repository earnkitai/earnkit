/**
 * The repro pack's target (v6.1.17 Task 5): the base URL, database and local secrets, read from the environment.
 * Local only: a base URL whose host is not localhost, 127.0.0.1 or ::1 is refused unless REPRO_ALLOW_REMOTE=1, and
 * earnkit.com (or any subdomain) and the Railway app domain (`*.up.railway.app`) are refused always. Hosts are compared
 * with trailing dots removed, and earnkit.com in look-alike letters too (each label through `fold`, L40-B2 v6.1.18).
 * The database must be a local Postgres named by its host (not empty, no `hostaddr=`, L40-C3). The default secrets
 * are the throwaway values of the local server; they sign nothing outside it. Pure.
 */
import { domainToUnicode } from 'node:url';
import { fold } from '../../lib/v5/oauth';
export type ReproTarget = { base: string; database: string; authSecret: string; cronSecret: string };

export const REPRO_DEFAULTS = {
  REPRO_BASE_URL: 'http://localhost:4600',
  REPRO_DATABASE_URL: 'postgresql://localhost:5432/earnkit_journeys',
  REPRO_AUTH_SECRET: 'journeys-local-secret-not-for-prod-0123456789abcdef',
  REPRO_CRON_SECRET: 'journeys-cron-secret',
} as const;

const LOCAL = ['localhost', '127.0.0.1', '::1'];
const hostOf = (url: string, what: string) => {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`local only: ${what} is not a URL`);
  }
  return { u, host: u.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '') };
};
/** The host's labels as they read: punycode decoded, each label folded (look-alike letters to Latin, lower case), and
 *  `l` or `1` read as `i` (so a Lisu or Cherokee EARNKIT is earnkit). Only compared, never connected to. */
const readAs = (host: string) => domainToUnicode(host).split('.').map((l) => fold(l).replace(/[l1]/g, 'i')).join('.');
const isUnder = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function reproTarget(env: Record<string, string | undefined> = process.env): ReproTarget {
  const pick = (k: keyof typeof REPRO_DEFAULTS) => env[k] || REPRO_DEFAULTS[k];
  const { u, host } = hostOf(pick('REPRO_BASE_URL'), 'REPRO_BASE_URL');
  if (isUnder(host, 'earnkit.com') || isUnder(readAs(host), 'earnkit.com')) throw new Error('local only: the repro pack never runs against earnkit.com');
  if (isUnder(host, 'up.railway.app')) throw new Error('local only: the repro pack never runs against a Railway app domain');
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('local only: REPRO_BASE_URL must be http or https');
  if (!LOCAL.includes(host) && env.REPRO_ALLOW_REMOTE !== '1') throw new Error(`local only: ${host} is not this machine (set REPRO_ALLOW_REMOTE=1 to allow it)`);
  const database = pick('REPRO_DATABASE_URL');
  const db = hostOf(database, 'REPRO_DATABASE_URL');
  const socket = db.u.searchParams.get('host');
  // L40-C3: an empty host leaves the choice to PGHOST, and `hostaddr=` connects to an address whatever the host says.
  const hostaddr = [...db.u.searchParams.keys()].some((k) => k.toLowerCase() === 'hostaddr');
  if (!LOCAL.includes(db.host) || hostaddr || (socket && !socket.startsWith('/') && !LOCAL.includes(socket.toLowerCase())))
    throw new Error('local only: REPRO_DATABASE_URL must be a local Postgres');
  return { base: u.origin, database, authSecret: pick('REPRO_AUTH_SECRET'), cronSecret: pick('REPRO_CRON_SECRET') };
}
