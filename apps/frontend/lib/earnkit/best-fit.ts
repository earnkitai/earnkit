import { sql } from './db';
import { bestApplies, scoreApplies, signedOutNow, type Seen } from './bench-find';
import { mainConfirmed } from './main-project';

/**
 * v3.1 Task 12 (spec 3.3): the Best fit outside a reply (the Monday email's money line): the one project
 * (builder_profiles.main_project_key), its apply candidates as score reads them (bench-find.ts scoreApplies: open,
 * listed programs, investments included, minus entered and hidden), then the ones the builder never told EarnKit about
 * and never declined in the last 30 days, in the order the reply offers them (bench-find.ts bestApplies). The first is
 * the one find and score name as the Best fit. Fix round 1: only where the reply names one (bench-find.ts benchView:
 * the ranked state): signed in (signedOutNow, for the person's own installation) and the one project confirmed
 * (mainConfirmed; a confirmed project is never `taken`, the reply checks that only while unconfirmed). Null: no
 * project, not ranked, no fit, or a read error. Never throws.
 */
export async function bestFitFor(builderId: number, now: Date): Promise<{ program_id: string; title: string; ends_at: Date | null } | null> {
  try {
    const [p] = await sql()<{ main: string | null; seen: unknown }[]>`
      SELECT main_project_key AS main, standing_seen AS seen FROM builder_profiles WHERE builder_id = ${builderId}`;
    if (!p?.main) return null;
    if ((await signedOutNow(builderId, builderId)) || !(await mainConfirmed(builderId))) return null;
    const { applies, skip } = await scoreApplies(builderId, p.main, now);
    const seen = (p.seen && typeof p.seen === 'object' ? p.seen : {}) as Seen;
    const best = (await bestApplies(builderId, applies, seen, skip, now))?.[0];
    return best ? { program_id: best.program_id, title: best.title, ends_at: best.ends_at ? new Date(best.ends_at) : null } : null;
  } catch (err) {
    console.error('[best fit]', err instanceof Error ? err.name : 'error');
    return null;
  }
}
