import { sql } from './db';

/**
 * Builder bonus rounds (v2.5 §3). A program with an end date (`ends_at`) is one round per window,
 * open from `starts_at` (inclusive) to `ends_at` (exclusive), keyed `<program id>:YYYY-MM-DD` (the
 * window's UTC start day, Ruling 21): a re-run cohort under the same program id (a new start) is a
 * new round, while an extended or shortened end keeps the round, whose stored window follows the
 * program file until it freezes (bookDeposit, programs.ts upsertProgram). A windowed program needs
 * a `starts_at` to have a round (M4: never a window from 1970; program-file.ts refuses a builder
 * bonus without one). A rolling program (no `ends_at`) has UTC calendar-month rounds, keyed
 * `<program id>:YYYY-MM`, none before its `starts_at`.
 */
export type Round = { key: string; starts: Date; ends: Date };
type Window = { id: string; starts_at: Date | null; ends_at: Date | null };

/** A windowed program's round key: its id and its window's UTC start day (Ruling 21). Pure. */
export const windowKey = (id: string, startsAt: Date) => `${id}:${startsAt.toISOString().slice(0, 10)}`;

/** The round of `program` open at `at`, or null. Pure. */
export function roundFor(program: Window, at: Date): Round | null {
  const t = at.getTime();
  if (program.starts_at && t < program.starts_at.getTime()) return null;
  if (program.ends_at) {
    if (!program.starts_at || t >= program.ends_at.getTime()) return null;
    return { key: windowKey(program.id, program.starts_at), starts: program.starts_at, ends: program.ends_at };
  }
  const month = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const next = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  const starts = program.starts_at && program.starts_at > month ? program.starts_at : month;
  return { key: `${program.id}:${month.toISOString().slice(0, 7)}`, starts, ends: next };
}

/**
 * Where a deposit at `at` from a coin entered in `program` goes: its open round, or the Safe (v2.5
 * §3: no rollover). The Safe also gets it when the program's submissions aren't public (no
 * `submission_proof`: no entry can be eligible, so the pool could never be paid) and whenever the
 * program isn't 'active' (one status rule, the same as `roundPoolsWei`). Pure.
 */
export function bookingFor(
  program: Window & { status: string; submission_proof: unknown },
  at: Date,
): { destination: 'round'; round: Round } | { destination: 'safe'; reason: string } {
  if (program.submission_proof === null || program.submission_proof === undefined)
    return { destination: 'safe', reason: 'builder bonus not available' };
  const round = program.status !== 'active' ? null : roundFor(program, at);
  return round ? { destination: 'round', round } : { destination: 'safe', reason: 'no open round' };
}

/**
 * The builder bonus pool so far of each program's round open now, by program id, in wei, in ONE
 * grouped read (Ruling 3). Only active programs whose round is open now (never a future
 * `starts_at` or an ended window), only this month's round of a rolling program, and only rounds
 * with booked deposits: a program missing from the map has no pool yet. A program whose current
 * round exists but is no longer 'open' (it froze, then the file moved its end or re-ran the same
 * start day) maps to null: its bonus is not available (I2). The round key is computed in SQL
 * exactly as `roundFor` does (UTC start day; UTC month).
 */
export async function roundPoolsWei(
  programIds: string[],
  opts: { now?: Date; onQuery?: () => void } = {},
): Promise<Map<string, bigint | null>> {
  if (programIds.length === 0) return new Map();
  const now = opts.now ?? new Date();
  opts.onQuery?.();
  const rows = await sql()<{ id: string; state: string | null; wei: string | null }[]>`
    WITH open AS (
      SELECT p.id,
        CASE WHEN p.ends_at IS NULL
          THEN p.id || ':' || to_char(${now}::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM')
          ELSE p.id || ':' || to_char(p.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') END AS round_key
      FROM programs p
      WHERE p.id IN ${sql()(programIds)} AND p.status = 'active'
        AND (p.starts_at IS NULL OR p.starts_at <= ${now})
        AND (p.ends_at IS NULL OR (p.starts_at IS NOT NULL AND ${now} < p.ends_at))
    )
    SELECT o.id, r.state,
      (SELECT sum(l.amount_wei) FROM bonus_ledger l WHERE l.round_key = o.round_key AND l.destination = 'round')::text AS wei
    FROM open o LEFT JOIN bonus_rounds r ON r.round_key = o.round_key`;
  const out = new Map<string, bigint | null>();
  for (const r of rows) {
    if (r.state !== null && r.state !== 'open') out.set(r.id, null);
    else if (r.wei !== null) out.set(r.id, BigInt(r.wei));
  }
  return out;
}
