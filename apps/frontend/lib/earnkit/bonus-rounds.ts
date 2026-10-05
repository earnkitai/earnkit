import { sql } from './db';

/**
 * Builder bonus rounds (v2.5 §3). A program with an end date (`ends_at`) is one round, open from
 * `starts_at` (inclusive; none: open from the start) to `ends_at` (exclusive). A rolling program
 * (no `ends_at`) has UTC calendar-month rounds, keyed `<program id>:YYYY-MM`, none before its
 * `starts_at`.
 */
export type Round = { key: string; starts: Date; ends: Date };
type Window = { id: string; starts_at: Date | null; ends_at: Date | null };

/** The round of `program` open at `at`, or null. Pure. */
export function roundFor(program: Window, at: Date): Round | null {
  const t = at.getTime();
  if (program.starts_at && t < program.starts_at.getTime()) return null;
  if (program.ends_at) {
    if (t >= program.ends_at.getTime()) return null;
    return { key: program.id, starts: program.starts_at ?? new Date(0), ends: program.ends_at };
  }
  const month = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const next = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  const starts = program.starts_at && program.starts_at > month ? program.starts_at : month;
  return { key: `${program.id}:${month.toISOString().slice(0, 7)}`, starts, ends: next };
}

/**
 * Where a deposit at `at` from a coin entered in `program` goes: its open round, or the Safe (v2.5
 * §3: no rollover). The Safe also gets it when the program's submissions aren't public (no
 * `submission_proof`: no entry can be eligible, so the pool could never be paid) and when a rolling
 * program is closed. Pure.
 */
export function bookingFor(
  program: Window & { status: string; submission_proof: unknown },
  at: Date,
): { destination: 'round'; round: Round } | { destination: 'safe'; reason: string } {
  if (program.submission_proof === null || program.submission_proof === undefined)
    return { destination: 'safe', reason: 'builder bonus not available' };
  const round = !program.ends_at && program.status !== 'active' ? null : roundFor(program, at);
  return round ? { destination: 'round', round } : { destination: 'safe', reason: 'no open round' };
}

/**
 * The builder bonus pool so far of each program's round open now, by program id, in wei, in ONE
 * grouped read (Ruling 3). Only active programs whose round is open now (never a future
 * `starts_at` or an ended window), only this month's round of a rolling program, only rounds still
 * 'open' in bonus_rounds, and only rounds with booked deposits: a program missing from the map has
 * no pool yet. The round key is computed in SQL exactly as `roundFor` does (UTC month).
 */
export async function roundPoolsWei(
  programIds: string[],
  opts: { now?: Date; onQuery?: () => void } = {},
): Promise<Map<string, bigint>> {
  if (programIds.length === 0) return new Map();
  const now = opts.now ?? new Date();
  opts.onQuery?.();
  const rows = await sql()<{ id: string; wei: string }[]>`
    WITH open AS (
      SELECT p.id,
        CASE WHEN p.ends_at IS NULL
          THEN p.id || ':' || to_char(${now}::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM')
          ELSE p.id END AS round_key
      FROM programs p
      WHERE p.id IN ${sql()(programIds)} AND p.status = 'active'
        AND (p.starts_at IS NULL OR p.starts_at <= ${now})
        AND (p.ends_at IS NULL OR ${now} < p.ends_at)
    )
    SELECT o.id, sum(l.amount_wei)::text AS wei
    FROM open o
    JOIN bonus_ledger l ON l.round_key = o.round_key AND l.destination = 'round'
    LEFT JOIN bonus_rounds r ON r.round_key = o.round_key
    WHERE COALESCE(r.state, 'open') = 'open'
    GROUP BY o.id`;
  return new Map(rows.map((r) => [r.id, BigInt(r.wei)]));
}
