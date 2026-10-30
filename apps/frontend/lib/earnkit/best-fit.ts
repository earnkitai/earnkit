import { sql } from './db';
import { bestApplies, realFit, scoreApplies, signedOutNow, type Fit, type Seen } from './bench-find';
import { rankLines } from './bench-rank';
import { mainConfirmed } from './main-project';
import type { Card } from './present';
import { readStanding, type Standing } from './standing';
import { streaksFor } from './streak';

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

/**
 * v4.7 T5: the builder's open fits outside a reply (the alert emails' closing fits): the Best fit's list (bestApplies:
 * never a program told about or declined), on the same gates as bestFitFor (signed in, the one project confirmed;
 * otherwise no fits), with the open cards and what to skip (entered or hidden) as scoreApplies reads them. Empty on a
 * read error. Never throws.
 */
export async function openFitsFor(builderId: number, now: Date): Promise<{ fits: Fit[]; cards: Card[]; skip: Set<string> }> {
  try {
    const [p] = await sql()<{ main: string | null; seen: unknown }[]>`
      SELECT main_project_key AS main, standing_seen AS seen FROM builder_profiles WHERE builder_id = ${builderId}`;
    const ranked = Boolean(p?.main) && !(await signedOutNow(builderId, builderId)) && (await mainConfirmed(builderId));
    const { applies, cards, skip } = await scoreApplies(builderId, ranked ? p!.main : null, now);
    const seen = (p?.seen && typeof p.seen === 'object' ? p.seen : {}) as Seen;
    const fits = applies.length > 0 ? ((await bestApplies(builderId, applies, seen, skip, now)) ?? []) : [];
    return { fits, cards, skip };
  } catch (err) {
    console.error('[best fit] open', err instanceof Error ? err.name : 'error');
    return { fits: [], cards: [], skip: new Set() };
  }
}

/**
 * v4.7 T5: the builder's full standing outside a reply (the Monday email's top paragraph; the email goes only to the
 * opted-in builder themself): standing.ts readStanding with the page's rank lines, builder_live's parts, streak.ts's
 * streak and the one project's real fits (scoreApplies, as score reads them; none while unconfirmed). Null on a read
 * error. Never throws.
 */
export async function standingFor(builderId: number, now: Date): Promise<Standing | null> {
  try {
    const [p] = await sql()<{ main: string | null }[]>`SELECT main_project_key AS main FROM builder_profiles WHERE builder_id = ${builderId}`;
    const [lines, [live], lit, confirmed] = await Promise.all([
      rankLines(builderId),
      sql()<{ parts: unknown }[]>`SELECT parts FROM builder_live WHERE builder_id = ${builderId}`,
      streaksFor([builderId], now).then((m) => m.get(builderId) ?? null),
      p?.main ? mainConfirmed(builderId) : Promise.resolve(false),
    ]);
    const { applies, cards } = p?.main && confirmed ? await scoreApplies(builderId, p.main, now) : { applies: [] as Fit[], cards: [] };
    return await readStanding(builderId, { lines, parts: live?.parts ?? null, streak: confirmed ? (lit?.streak ?? 0) : 0, fits: applies.filter(realFit), cards, now });
  } catch (err) {
    console.error('[best fit] standing', err instanceof Error ? err.name : 'error');
    return null;
  }
}
