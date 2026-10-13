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
  /**
   * v2.12 final review I6: a package's weekly downloads / 50 count as users, at most this many per
   * package (downloads can be botted for free; a botted package never fills the users part alone).
   */
  package_users: number;
  /**
   * v2.12 final review I2: merged-PR credit per target repo, at most this many users however many PRs
   * went into it (log10(1 + target stars), one PR per target counts). Below the users a person needs
   * for the token pitch, so a farm of PRs into one starred repo never reaches it alone.
   */
  pr_target_users: number;
  /** YYYY-MM-DD this calibration went live (the profile's "Scoring got stricter on <date>" note). */
  since: string;
};

export const CALIBRATIONS: Record<string, Calibration> = {
  'v1-launch': { id: 'v1-launch', users: 500, money_usd: 5_000, weeks: 13, staying_days: 60, package_users: 100, pr_target_users: 2, since: '2026-10-12' },
};

export const LIVE_CALIBRATION = 'v1-launch';

export function calibration(id: string = LIVE_CALIBRATION): Calibration {
  if (!Object.hasOwn(CALIBRATIONS, id)) throw new Error(`unknown calibration ${id}`);
  return CALIBRATIONS[id];
}

/** v2.12.1: the bars of formula v2 (Shipped, Used, Earned, Consistency). Same rule: only bars loosen, an owner decision. */
export type CalibrationV2 = {
  id: string;
  /** Faded people (U) for the full 40 Used points. */
  users: number;
  /** USD earned (coin creator fees, fees into their contracts, prizes won) for the full 20 Earned points. */
  money_usd: number;
  /** Faded active weeks for the full 20 Consistency points. */
  weeks: number;
  /** A package's weekly downloads / 50 count as people, at most this many per package (v2.12 I6). */
  package_users: number;
  since: string;
};
export const V2_CALIBRATIONS: Record<string, CalibrationV2> = {
  'v2-launch': { id: 'v2-launch', users: 500, money_usd: 5_000, weeks: 13, package_users: 100, since: '2026-10-14' },
};
export const LIVE_CALIBRATION_V2 = 'v2-launch';
export function calibrationV2(id: string = LIVE_CALIBRATION_V2): CalibrationV2 {
  if (!Object.hasOwn(V2_CALIBRATIONS, id)) throw new Error(`unknown calibration ${id}`);
  return V2_CALIBRATIONS[id];
}
