/**
 * Fixed-window request counters in Postgres (`rate_windows`), so they hold across instances. One
 * atomic upsert per hit; the first hit of a window clears that key's older windows, and now and
 * then the whole table's stale windows.
 */
import { sql } from './db';

/** The limits. Keys are `<name>:<who>`. */
export const LIMITS = {
  /** POST /api/programs/write, per owner token (one key), after the token check. */
  programsWrite: { limit: 120, windowSeconds: 3_600 },
  /** GET /oauth/authorize, per client IP: each approval is a code that can become an installation. */
  oauthAuthorize: { limit: 60, windowSeconds: 3_600 },
  /** POST /oauth/register, per client IP: the abuse floor. */
  oauthRegister: { limit: 50, windowSeconds: 3_600 },
  /** The per-IP register floor for a known hosted service's redirect host (many builders share its IPs). */
  oauthRegisterHosted: { limit: 500, windowSeconds: 3_600 },
  /** POST /oauth/register, per agent app (its https redirect host): a high ceiling, warned at REGISTER_HOST_WARN. */
  oauthRegisterHost: { limit: 10_000, windowSeconds: 86_400 },
  /** New installations (POST /oauth/token that creates one), per registration, and per IP as the floor. */
  installClient: { limit: 500, windowSeconds: 86_400 },
  installHour: { limit: 50, windowSeconds: 3_600 },
  installHourHosted: { limit: 500, windowSeconds: 3_600 },
} as const;

/** Registrations per agent app a day at which a warning is logged, before oauthRegisterHost refuses. */
export const REGISTER_HOST_WARN = 8_000;

/** The start of the fixed window `now` falls in. Pure. */
export const windowStart = (now: Date, windowMs: number) =>
  new Date(Math.floor(now.getTime() / windowMs) * windowMs);

export type Hit = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the current window ends (when a refused caller can try again). */
  retryAfter: number;
};

/** What a hit means once the window's count is known. Pure. */
export function hitResult(
  count: number,
  limit: number,
  windowSeconds: number,
  now: Date,
): Hit {
  const windowMs = windowSeconds * 1000;
  const end = windowStart(now, windowMs).getTime() + windowMs;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: Math.max(1, Math.ceil((end - now.getTime()) / 1000)),
  };
}

/** "a minute", "12 minutes", "3 hours": a readable retry-after. Pure. */
export function retryText(seconds: number) {
  if (seconds <= 60) return 'a minute';
  if (seconds < 3_600) return `${Math.ceil(seconds / 60)} minutes`;
  const hours = Math.ceil(seconds / 3_600);
  return hours === 1 ? 'an hour' : `${hours} hours`;
}

/**
 * An IPv6 address as its /64 ("2001:db8:0:0::/64"): one subscriber usually holds a whole /64, so
 * per-address keys could be rotated for free. IPv4 (and IPv4-mapped IPv6) is returned as is.
 * Pure.
 */
function ipKey(ip: string): string {
  const addr = ip
    .trim()
    .replace(/^\[|\]$/g, '')
    .split('%')[0];
  if (!addr.includes(':')) return addr;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  if (mapped) return mapped[1];
  const [head, tail] = addr.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups =
    tail === undefined
      ? left
      : [
          ...left,
          ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'),
          ...right,
        ];
  return `${groups
    .slice(0, 4)
    .map((g) => (parseInt(g, 16) || 0).toString(16))
    .join(':')}::/64`;
}

/**
 * The caller's IP, as a rate-limit key. Railway's edge sets X-Real-IP to the client's address
 * (documented), so it comes first; then the rightmost `x-forwarded-for` entry (the one a proxy
 * appended; entries to its left are whatever the client sent); then the socket address when the
 * runtime gives one. Pure.
 */
export function clientIp(headers: Headers, remoteAddress?: string): string {
  const real = headers.get('x-real-ip')?.trim();
  const forwarded = headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  const ip = real || forwarded || remoteAddress?.trim();
  return ip ? ipKey(ip) : 'unknown';
}

/** Counts one request for `key` in the current `windowSeconds` window; the window's count so far. */
export async function countHit(key: string, windowSeconds: number, now = new Date()): Promise<number> {
  const start = windowStart(now, windowSeconds * 1000);
  const [row] = await sql()<{ count: number }[]>`
    INSERT INTO rate_windows (key, window_start, count) VALUES (${key}, ${start}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_windows.count + 1
    RETURNING count`;
  if (row.count === 1) {
    await sql()`DELETE FROM rate_windows WHERE key = ${key} AND window_start < ${start}`;
    // Keys that never come back (one-off IPs) are swept now and then; no window is over a day.
    if (Math.random() < 0.01)
      await sql()`DELETE FROM rate_windows WHERE window_start < now() - interval '2 days'`;
  }
  return row.count;
}

/** Counts one request for `key` in the current `windowSeconds` window. */
export async function hit(
  key: string,
  limit: number,
  windowSeconds: number,
  now = new Date(),
): Promise<Hit> {
  return hitResult(await countHit(key, windowSeconds, now), limit, windowSeconds, now);
}

/** A refused call: the message says what was limited and when to try again. */
export class RateLimitError extends Error {
  constructor(
    what: string,
    readonly retryAfter: number,
  ) {
    super(`${what} Try again in ${retryText(retryAfter)}.`);
    // Every log that prints err.name shows the class.
    this.name = 'RateLimitError';
  }
}

/** Counts one call against `LIMITS[name]` for `who`; throws a RateLimitError when over it. */
export async function enforce(
  name: keyof typeof LIMITS,
  who: string | number,
  what: string,
) {
  const { limit, windowSeconds } = LIMITS[name];
  const r = await hit(`${name}:${who}`, limit, windowSeconds);
  if (!r.allowed) throw new RateLimitError(what, r.retryAfter);
  return r;
}
