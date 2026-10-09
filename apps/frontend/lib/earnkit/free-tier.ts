import { sql } from './db';

/**
 * v2.9 C13: hard caps on the vendors' free tiers, kept in code so EarnKit never gets a bill. A
 * counter per name and period (`free_tier_usage`) only moves while it stays at or under its cap,
 * in one atomic statement, so concurrent takes can never pass it.
 * - r2Writes: R2 Class A operations (put, list) a month. R2's free tier is 1M; 900k leaves room.
 * - resendDay / resendMonth: emails a day and a month (Resend free: 100 and 3,000).
 */
export const FREE_CAPS = {
  r2Writes: { cap: 900_000, period: 'month' },
  resendDay: { cap: 100, period: 'day' },
  resendMonth: { cap: 3_000, period: 'month' },
} as const;

export type FreeTierName = keyof typeof FREE_CAPS;

/** The counter's period in UTC: `2026-10-08` for a day, `2026-10` for a month. Pure. */
export const periodKey = (period: 'day' | 'month', now: Date) => now.toISOString().slice(0, period === 'day' ? 10 : 7);

/** Thrown when a free-tier counter refuses (the builder sees "Hosting is full right now"). */
export class FreeTierFull extends Error {
  constructor(name: FreeTierName) {
    super(`Free tier full: ${name}`);
    this.name = 'FreeTierFull';
  }
}

/**
 * Takes `n` from the counter: true when it was taken (the total stays at or under the cap), false
 * when it would cross it (nothing changes).
 */
export async function takeFreeTier(name: FreeTierName, n: number, now = new Date()): Promise<boolean> {
  const { cap, period } = FREE_CAPS[name];
  if (n <= 0) return true;
  if (n > cap) return false;
  const rows = await sql()`
    INSERT INTO free_tier_usage (name, period, used) VALUES (${name}, ${periodKey(period, now)}, ${n})
    ON CONFLICT (name, period) DO UPDATE SET used = free_tier_usage.used + ${n}
    WHERE free_tier_usage.used + ${n} <= ${cap}
    RETURNING used`;
  return rows.length > 0;
}

/** Whether `n` more would still fit this period (a read; nothing is taken). */
export async function freeTierRoom(name: FreeTierName, n: number, now = new Date()): Promise<boolean> {
  const { cap, period } = FREE_CAPS[name];
  const [row] = await sql()<{ used: number }[]>`
    SELECT used FROM free_tier_usage WHERE name = ${name} AND period = ${periodKey(period, now)}`;
  return (row?.used ?? 0) + n <= cap;
}
