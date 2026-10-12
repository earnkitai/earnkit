/**
 * v2.12 spec 4 (owner ruling 2026-10-12, "generous early, harsher later"): the bars for full points,
 * versioned. Only the bars loosen; verification and anti-farming are strict from day one. A new
 * version is an owner decision (never automatic), added here with its `since` date and made live by
 * changing LIVE_CALIBRATION. Every score row stores its calibration id; raw inputs are stored
 * unscaled, so any score can be recomputed under any calibration. Pure, import-free.
 */
export type Calibration = {
  id: string;
  /** U for the full 45 users points. */
  users: number;
  /** M (USD, last 365 days) for the full 20 money points. */
  money_usd: number;
  /** Commit weeks in the last 52 for the full 10 consistency points. */
  weeks: number;
  /** Days a project must stay live or used after its first outcome (staying power). */
  staying_days: number;
  /** YYYY-MM-DD this calibration went live (the profile's "Scoring got stricter on <date>" note). */
  since: string;
};

export const CALIBRATIONS: Record<string, Calibration> = {
  'v1-launch': { id: 'v1-launch', users: 500, money_usd: 5_000, weeks: 13, staying_days: 60, since: '2026-10-12' },
};

export const LIVE_CALIBRATION = 'v1-launch';

export function calibration(id: string = LIVE_CALIBRATION): Calibration {
  if (!Object.hasOwn(CALIBRATIONS, id)) throw new Error(`unknown calibration ${id}`);
  return CALIBRATIONS[id];
}
