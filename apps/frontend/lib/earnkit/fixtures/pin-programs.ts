import { sql } from '../db';
import { closeDay } from '../deadline';

/**
 * v4.10.1 Task 5: pins the real program set against the clock. The committed programs carry real deadlines (a16z speedrun
 * 2026-11-02T07:59Z, Arc Studio 04:59Z, ...), and a test about a reply's wording must not start failing the day one
 * closes. For the run, every dated active program moves by the same whole number of years, enough that the earliest
 * is more than 30 days out: the order of the closes stays as committed, and each close keeps its day in its own zone
 * (closeDay has no year; an hour is added or taken where a year's daylight saving ends on another day). Nothing is
 * lapsed. `pinPrograms` returns the restore; no other test sees the move.
 */
export async function pinPrograms(): Promise<() => Promise<void>> {
  const rows = await sql()<{ id: string; ends_at: Date; summary: string; tz: string | null }[]>`
    SELECT id, ends_at, summary, tz FROM programs WHERE status = 'active' AND ends_at IS NOT NULL`;
  const floor = Date.now() + 30 * 86_400_000;
  const earliest = Math.min(...rows.map((r) => r.ends_at.getTime()));
  const years = rows.length && earliest < floor ? Math.ceil((floor - earliest) / (365.25 * 86_400_000)) : 0;
  if (years > 0) {
    for (const r of rows) {
      const moved = new Date(r.ends_at);
      moved.setUTCFullYear(moved.getUTCFullYear() + years);
      const day = closeDay(r);
      const same = [0, 1, -1].map((h) => new Date(moved.getTime() + h * 3_600_000)).find((d) => closeDay({ ...r, ends_at: d }) === day) ?? moved;
      await sql()`UPDATE programs SET ends_at = ${same} WHERE id = ${r.id}`;
    }
  }
  return async () => {
    if (years > 0) for (const r of rows) await sql()`UPDATE programs SET ends_at = ${r.ends_at} WHERE id = ${r.id}`;
  };
}

export async function withProgramsPinned<T>(run: () => Promise<T>): Promise<T> {
  const restore = await pinPrograms();
  try {
    return await run();
  } finally {
    await restore();
  }
}
