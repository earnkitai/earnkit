/**
 * The repro pack's target (v6.1.17 Task 5): the base URL, database and local secrets, read from the environment.
 * Local only: a base URL whose host is not localhost, 127.0.0.1 or ::1 is refused unless REPRO_ALLOW_REMOTE=1, and
 * earnkit.com (or any subdomain) is refused always. The database must be a local Postgres. The default secrets are the
 * throwaway values of the local server; they sign nothing outside it. Pure.
 */
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
  return { u, host: u.hostname.replace(/^\[|\]$/g, '').toLowerCase() };
};

export function reproTarget(env: Record<string, string | undefined> = process.env): ReproTarget {
  const pick = (k: keyof typeof REPRO_DEFAULTS) => env[k] || REPRO_DEFAULTS[k];
  const { u, host } = hostOf(pick('REPRO_BASE_URL'), 'REPRO_BASE_URL');
  if (host === 'earnkit.com' || host.endsWith('.earnkit.com')) throw new Error('local only: the repro pack never runs against earnkit.com');
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('local only: REPRO_BASE_URL must be http or https');
  if (!LOCAL.includes(host) && env.REPRO_ALLOW_REMOTE !== '1') throw new Error(`local only: ${host} is not this machine (set REPRO_ALLOW_REMOTE=1 to allow it)`);
  const database = pick('REPRO_DATABASE_URL');
  const db = hostOf(database, 'REPRO_DATABASE_URL');
  const socket = db.u.searchParams.get('host');
  if (!(db.host === '' || LOCAL.includes(db.host)) || (socket && !socket.startsWith('/') && !LOCAL.includes(socket.toLowerCase())))
    throw new Error('local only: REPRO_DATABASE_URL must be a local Postgres');
  return { base: u.origin, database, authSecret: pick('REPRO_AUTH_SECRET'), cronSecret: pick('REPRO_CRON_SECRET') };
}
