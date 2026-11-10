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
  /** POST /oauth/register, per address block (IPv4 /16, IPv6 /48) a day (v6.1.13, B1): one network can never spend
   *  every other network's sign-ups, as the one shared hosted ceiling let it. */
  oauthRegisterBlock: { limit: 2_000, windowSeconds: 86_400 },
  /** New installations (POST /oauth/token that creates one), per registration, and per IP as the floor for every client. */
  installClient: { limit: 500, windowSeconds: 86_400 },
  /** The per-registration ceiling for a hosted service's callback client: the hosted tier raises only this (v6.1.7, B5). */
  installClientHosted: { limit: 5_000, windowSeconds: 86_400 },
  installHour: { limit: 50, windowSeconds: 3_600 },
  /** New installations per address block a day (v6.1.13, B1), beside the per-address floor and the per-client limits. */
  installBlock: { limit: 2_000, windowSeconds: 86_400 },
  /** MCP tool calls, per installation, and per client IP as the floor. */
  mcp: { limit: 120, windowSeconds: 3_600 },
  mcpIp: { limit: 600, windowSeconds: 3_600 },
  /** Uncached GitHub repo reads, per installation, per UTC day (a cache hit is free). */
  repoRead: { limit: 10, windowSeconds: 86_400 },
  /** GET /link/<code> and the GitHub sign-in callback, per client IP, one window for both. */
  linkGet: { limit: 60, windowSeconds: 3_600 },
  /** screen jobs, per reviewer ('b:<builder>'), per UTC day: counted once the call passed every other refusal. */
  screenJobs: { limit: 10, windowSeconds: 86_400 },
} as const;

/** The 429 text of the per-block daily caps (v6.1.13, B1): the whole line, with no retry clause after it. */
export const BLOCK_LIMITED = 'Too many sign-ups from your network today. Try again tomorrow.';

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
 * The busy line for a refused tool call, from its window's seconds left (v6.1.7, C8): minutes rounded up (at least
 * one), hours rounded up once over 90 minutes. Pure.
 */
export function busyText(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const wait = minutes > 90 ? `${Math.ceil(seconds / 3_600)} hours` : minutes === 1 ? '1 minute' : `${minutes} minutes`;
  return `EarnKit is busy. Try again in about ${wait}.`;
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
 * The address block a rate-limit key (`ipKey`) is in (v6.1.13, B1): IPv4 as its /16 ("10.9.0.0/16"), IPv6 as its /48
 * ("2001:db8:11::/48"); anything else ('unknown') as is. Pure.
 */
export function blockOf(key: string): string {
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(key);
  if (v4) return `${v4[1]}.${v4[2]}.0.0/16`;
  const v6 = /^([0-9a-f]+):([0-9a-f]+):([0-9a-f]+):[0-9a-f]+::\/64$/.exec(key);
  return v6 ? `${v6[1]}:${v6[2]}:${v6[3]}::/48` : key;
}

/**
 * The caller's IP, as a rate-limit key. Railway's edge appends the client's address to
 * `x-forwarded-for`, so its rightmost entry is the one we trust (entries to its left, and any
 * `x-real-ip`, are whatever the client sent: a client-sent x-real-ip must never win, or one header
 * rotates every per-IP limit). `x-real-ip` counts only when there is no forwarded header at all;
 * then the socket address when the runtime gives one. Pure.
 */
export function clientIp(headers: Headers, remoteAddress?: string): string {
  const forwarded = headers.get('x-forwarded-for');
  const ip = forwarded !== null ? forwarded.split(',').at(-1)?.trim() || remoteAddress?.trim() : headers.get('x-real-ip')?.trim() || remoteAddress?.trim();
  return ip ? ipKey(ip) : 'unknown';
}

/** Whether this first hit also sweeps old windows (one in a hundred); replaceable in tests. */
let sweep = (): boolean => Math.random() < 0.01;
/** Tests only: sets the sweep's chance (true always, false never); undefined restores it. */
export function setSweepForTests(always: boolean | undefined): void {
  sweep = always === undefined ? () => Math.random() < 0.01 : () => always;
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
    // Keys that never come back (one-off IPs) are swept now and then; no window is over a day. Against the caller's
    // clock, not the database's, so a fixed clock keeps its windows (v6.1.9 final I5).
    if (sweep())
      await sql()`DELETE FROM rate_windows WHERE window_start < ${new Date(now.getTime() - 2 * 86_400_000)}`;
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

/** A refused call: the message says what was limited and when to try again (`whole`: `what` already says it). */
export class RateLimitError extends Error {
  constructor(
    what: string,
    readonly retryAfter: number,
    whole = false,
  ) {
    super(whole ? what : `${what} Try again in ${retryText(retryAfter)}.`);
    // Every log that prints err.name shows the class.
    this.name = 'RateLimitError';
  }
}

/** Counts one call against `LIMITS[name]` for `who`; throws a RateLimitError when over it. */
export async function enforce(
  name: keyof typeof LIMITS,
  who: string | number,
  what: string,
  whole = false,
) {
  const { limit, windowSeconds } = LIMITS[name];
  const r = await hit(`${name}:${who}`, limit, windowSeconds);
  if (!r.allowed) throw new RateLimitError(what, r.retryAfter, whole);
  return r;
}
