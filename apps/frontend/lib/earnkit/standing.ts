import { sql, type Db } from './db';
import { freshSql } from './api-stale';
import { usd } from './campaigns';
import { closeDay, hoursLeft } from './deadline';
import { prizesWonSql } from './earned';
import { COIN_PROGRAM } from './policy-constants';
import { storedShipping } from './score-v2';
import { isRealAnswer } from './submission';
import type { RankLines } from './bench-rank';

/**
 * v4.7 T2: where the builder stands, the `standing` fact of every find and score reply (and the score reply's first
 * paragraph; Task 5's Monday email reuses it). `score` and `rank` are the page's own (pageScore, bench-rank rankLines'
 * `bench`: rank.ts shownRankLine, null under RANK_MIN_POOL); `streak` is streak.ts's; `wonUsd` the announced prizes
 * (earned.ts prizesWonSql); `applied` and `drafts` applicationCounts; `next` the earliest open deadline among the fits.
 */
export type Standing = {
  /** Fix round 1: null when unknown (a failed read, or a caller only the streak is said to): the part is left out. */
  score: number | null; rank: string | null; streak: number; wonUsd: number | null; applied: number; drafts: number;
  next: { program: string; day: string } | null;
};

/**
 * v4.7 T2: the score the builder's page shows (bench-data.ts profileData, the one rule): the stored Shipping number
 * while in the leaderboard's pool (`listed`), else null. A listed project is confirmed (benchPool), so the page is
 * never quiet beside it (BenchProfileView). Pure.
 */
export const pageScore = (lines: Pick<RankLines, 'listed'>, live: { parts: unknown } | null | undefined): number | null =>
  lines.listed && live ? (storedShipping(live.parts)?.points ?? null) : null;

/** "1 application", "2 drafts". Pure. */
const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * v4.7 T2 (exact copy): the standing paragraph. Its parts, each only when true, joined with ". ": "Score 77 · #1 of 40
 * builders" ("Score 77" under RANK_MIN_POOL), the weeks shipping, "$5,000 won so far" (else "No grants won yet"; no
 * part while wins are unknown), "2 applications in, 1 draft ready", "Next: Base Builder Grants closes Nov 1". Never
 * "points". Empty with no part. Fix round 1 (R6): standingParagraph, not winners.ts's standingText (bench-reply.ts already has a standingLine). Pure.
 */
export function standingParagraph(s: Standing): string {
  const work = [s.applied > 0 ? `${count(s.applied, 'application')} in` : null, s.drafts > 0 ? `${count(s.drafts, 'draft')} ready` : null]
    .filter(Boolean).join(', ');
  const parts = [
    // Final review 9: a score of 0 says neither the score nor the rank (the score-0 ruling: nothing to stand on yet).
    s.score !== null && s.score > 0 ? (s.rank ? `Score ${s.score} · ${s.rank}` : `Score ${s.score}`) : null,
    s.streak >= 1 ? (s.streak === 1 ? '1 week shipping' : `${s.streak} weeks shipping in a row`) : null,
    s.wonUsd === null ? null : s.wonUsd > 0 ? `${usd(Math.round(s.wonUsd))} won so far` : 'No grants won yet',
    work || null,
    s.next ? `Next: ${s.next.program} closes ${s.next.day}` : null,
  ];
  const said = parts.filter(Boolean);
  return said.length > 0 ? `${said.join('. ')}.` : '';
}

/**
 * Fix round 1 (R5): the standing leads the score reply only with a score or a streak part ("No grants won yet" alone
 * never leads; the fact still carries it). Pure.
 */
export const standingLeads = (s: Standing) =>
  // Final review 9: a score of 0 is no part (standingParagraph leaves it out), so it leads only with another part to say.
  (s.score !== null && (s.score > 0 || s.applied > 0 || s.drafts > 0 || s.next !== null)) || s.streak >= 1;

/**
 * Fix round 1 (R7, replyFacts' gating): the standing for a caller that is no signed-in person of their own (signed out,
 * or a shared client without its own X account): the weeks only, nothing read. Pure.
 */
export const streakOnly = (streak: number): Standing => ({ score: null, rank: null, streak, wonUsd: null, applied: 0, drafts: 0, next: null });

type DeadlineCard = { id: string; title: string; summary: string; tz?: string | null; ends_at?: Date | string | null };

/**
 * v4.7 T2: the earliest open deadline among the builder's fits: its program and close day (deadline.ts closeDay, the
 * program's own zone), or under 48 hours the time left (hoursLeft, "in 20 hours"; v4.8.1 final fix R-3). A rolling program, or one already closed, has none. Null with none. Pure.
 */
export function nextDeadline(fits: { program_id: string }[], cards: DeadlineCard[], now: Date): Standing['next'] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  let best: { c: DeadlineCard; at: number; day: string } | null = null;
  for (const f of fits) {
    const c = byId.get(f.program_id);
    const day = c ? closeDay(c) : null;
    if (!c || !day) continue;
    const at = new Date(c.ends_at!).getTime();
    // v4.8.1 final fix (R-3): under 48 hours the time left ("in 20 hours"), the same in every zone.
    if (at > now.getTime() && (!best || at < best.at)) best = { c, at, day: hoursLeft(new Date(at).toISOString(), now) ?? day };
  }
  return best ? { program: best.c.title, day: best.day } : null;
}

/**
 * v4.7 final review (one rule for "applied"): the programs the builder (the installation group, COALESCE(builder_id,
 * id)) told EarnKit they applied to (builder_program_status, any status but not_interested: applied, accepted, funded,
 * rejected), as a fragment selecting program_id. applicationCounts and the alert emails (alert-mail.ts) read it.
 */
export const toldAppliedSql = (db: Db, builderId: number) => db`
  SELECT s.program_id FROM builder_program_status s JOIN installations i ON i.id = s.installation_id
  WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND s.login = '' AND s.status <> 'not_interested'`;

/**
 * v4.7 T2 (ruling R3: Task 3's token gate reads the same): the builder's programs applied to, and drafts ready, one per
 * program, across the installation group (COALESCE(builder_id, id)), never a campaign or the coin program. Applied: an
 * entry submitted (projects.ts openEntries' rule) or a program the builder told EarnKit they applied to
 * (builder_program_status). A draft: an entry not submitted, in a program still open, with a real stored answer
 * (bench-find readyDraft's rule), in a program not applied to.
 */
export async function applicationCounts(builderId: number): Promise<{ applied: number; drafts: number }> {
  const db = sql();
  const [entries, told] = await Promise.all([
    db<{ program_id: string; submitted: boolean; open: boolean; application: { answers?: Record<string, unknown> } | null }[]>`
      SELECT p.program_id, (p.confirmed_at IS NULL OR p.submission_confirmed_at IS NOT NULL OR p.submission_proof_ok_at IS NOT NULL) AS submitted,
        (pr.status = 'active' AND (pr.ends_at IS NULL OR pr.ends_at > now()) AND ${freshSql(db, 'pr')}) AS open, p.application
      FROM projects p JOIN programs pr ON pr.id = p.program_id JOIN installations i ON i.id = p.installation_id
      WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND pr.campaign IS NULL AND p.program_id <> ${COIN_PROGRAM}`,
    // Fix round 1: never a campaign or the coin program here either (the entries' rule).
    db<{ program_id: string }[]>`
      SELECT DISTINCT t.program_id FROM (${toldAppliedSql(db, builderId)}) t JOIN programs pr ON pr.id = t.program_id
      WHERE pr.campaign IS NULL AND t.program_id <> ${COIN_PROGRAM}`,
  ]);
  const applied = new Set([...told.map((t) => t.program_id), ...entries.filter((e) => e.submitted).map((e) => e.program_id)]);
  const drafts = new Set(
    entries
      .filter((e) => !e.submitted && e.open && !applied.has(e.program_id))
      .filter((e) => Object.values(e.application?.answers ?? {}).some((a) => typeof a === 'string' && isRealAnswer(a)))
      .map((e) => e.program_id),
  );
  return { applied: applied.size, drafts: drafts.size };
}

/** v4.7 T2: the announced prizes the builder won (earned.ts prizesWonSql), whole dollars. */
export async function wonUsdOf(builderId: number): Promise<number> {
  const db = sql();
  const [r] = await db<{ usd: string | null }[]>`SELECT (${prizesWonSql(db, builderId)})::text AS usd`;
  return Number(r?.usd ?? 0);
}

/**
 * v4.7 T2: the builder's standing, read with the page's own rules: the rank lines (bench-rank rankLines) and
 * builder_live's parts (fix round 1: both as find and score already read them), the streak, the fits and the cards. A
 * failed read leaves its part out (never "No grants won yet" for a failed wins read), never the reply.
 */
export async function readStanding(
  builderId: number,
  o: { lines: Pick<RankLines, 'listed' | 'bench'>; parts: unknown; streak: number; fits: { program_id: string }[]; cards: DeadlineCard[]; now: Date },
): Promise<Standing> {
  const fail = (what: string) => (err: unknown) => {
    console.error(`[standing] ${what}`, err instanceof Error ? err.name : 'error');
    return null;
  };
  const score = pageScore(o.lines, { parts: o.parts });
  const [wonUsd, counts] = await Promise.all([
    wonUsdOf(builderId).catch(fail('won')),
    applicationCounts(builderId).catch(fail('applications')),
  ]);
  return {
    score,
    rank: score !== null ? o.lines.bench : null,
    streak: o.streak,
    wonUsd,
    applied: counts?.applied ?? 0,
    drafts: counts?.drafts ?? 0,
    next: nextDeadline(o.fits, o.cards, o.now),
  };
}

/**
 * Whether the caller is a person: not a shared client, or a shared client whose own installation is bound to X.
 * v4.7 T2 fix round 1 (R7): moved here from reply-facts.ts, so its facts and the standing read one gate.
 */
export async function personal(ctx: { installationId: number; ownInstallationId?: number; sharedClient?: boolean }): Promise<boolean> {
  if (!ctx.sharedClient) return true;
  const [r] = await sql()<{ x: string | null }[]>`SELECT x_user_id AS x FROM installations WHERE id = ${ctx.ownInstallationId ?? ctx.installationId}`;
  return Boolean(r?.x);
}
