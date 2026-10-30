import { sql } from './db';
import { usd } from './campaigns';
import { closeDay } from './deadline';
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
  score: number | null; rank: string | null; streak: number; wonUsd: number; applied: number; drafts: number;
  next: { program: string; day: string } | null;
};

/**
 * v4.7 T2: the score the builder's page shows (bench-data.ts profileData, the one rule): the stored Shipping number
 * while in the leaderboard's pool (`listed`), else null. A listed project is confirmed (benchPool), so the page is
 * never quiet beside it (BenchProfileView). Pure.
 */
export const pageScore = (lines: Pick<RankLines, 'listed'>, live: { parts: unknown } | null | undefined): number | null =>
  lines.listed && live ? (storedShipping(live.parts)?.points ?? null) : null;

/** v4.7 T2: the page's score for the builder, from builder_live (pageScore). Never throws: a failed read is null. */
export async function pageScoreOf(builderId: number, lines: Pick<RankLines, 'listed'>): Promise<number | null> {
  if (!lines.listed) return null;
  const [live] = await sql()<{ parts: unknown }[]>`SELECT parts FROM builder_live WHERE builder_id = ${builderId}`.catch(() => []);
  return pageScore(lines, live);
}

/** "1 application", "2 drafts". Pure. */
const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * v4.7 T2 (exact copy): the standing paragraph. Its parts, each only when true, joined with ". ": "Score 77 · #1 of 40
 * builders" ("Score 77" under RANK_MIN_POOL), the weeks shipping, "$5,000 won so far" (else "No grants won yet"),
 * "2 applications in, 1 draft ready", "Next: Base Builder Grants closes Nov 1". Never "points". Pure.
 */
export function standingText(s: Standing): string {
  const work = [s.applied > 0 ? `${count(s.applied, 'application')} in` : null, s.drafts > 0 ? `${count(s.drafts, 'draft')} ready` : null]
    .filter(Boolean).join(', ');
  const parts = [
    s.score !== null ? (s.rank ? `Score ${s.score} · ${s.rank}` : `Score ${s.score}`) : null,
    s.streak >= 1 ? (s.streak === 1 ? '1 week shipping' : `${s.streak} weeks shipping in a row`) : null,
    s.wonUsd > 0 ? `${usd(Math.round(s.wonUsd))} won so far` : 'No grants won yet',
    work || null,
    s.next ? `Next: ${s.next.program} closes ${s.next.day}` : null,
  ];
  return `${parts.filter(Boolean).join('. ')}.`;
}

type DeadlineCard = { id: string; title: string; summary: string; tz?: string | null; ends_at?: Date | string | null };

/**
 * v4.7 T2: the earliest open deadline among the builder's fits: its program and close day (deadline.ts closeDay, the
 * program's own zone). A rolling program, or one already closed, has none. Null with none. Pure.
 */
export function nextDeadline(fits: { program_id: string }[], cards: DeadlineCard[], now: Date): Standing['next'] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  let best: { c: DeadlineCard; at: number; day: string } | null = null;
  for (const f of fits) {
    const c = byId.get(f.program_id);
    const day = c ? closeDay(c) : null;
    if (!c || !day) continue;
    const at = new Date(c.ends_at!).getTime();
    if (at > now.getTime() && (!best || at < best.at)) best = { c, at, day };
  }
  return best ? { program: best.c.title, day: best.day } : null;
}

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
        (pr.status = 'active' AND (pr.ends_at IS NULL OR pr.ends_at > now())) AS open, p.application
      FROM projects p JOIN programs pr ON pr.id = p.program_id JOIN installations i ON i.id = p.installation_id
      WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND pr.campaign IS NULL AND p.program_id <> ${COIN_PROGRAM}`,
    db<{ program_id: string }[]>`
      SELECT DISTINCT s.program_id FROM builder_program_status s JOIN installations i ON i.id = s.installation_id
      WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND s.login = '' AND s.status <> 'not_interested'`,
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
 * v4.7 T2: the builder's standing, read with the page's own rules: the rank lines (bench-rank rankLines, which find and
 * score already read), the streak, the fits and the cards. A failed read leaves its part out (wins: "No grants won
 * yet"), never the reply.
 */
export async function readStanding(
  builderId: number,
  o: { lines: Pick<RankLines, 'listed' | 'bench'>; streak: number; fits: { program_id: string }[]; cards: DeadlineCard[]; now: Date },
): Promise<Standing> {
  const fail = (what: string) => (err: unknown) => {
    console.error(`[standing] ${what}`, err instanceof Error ? err.name : 'error');
    return null;
  };
  const [score, wonUsd, counts] = await Promise.all([
    pageScoreOf(builderId, o.lines),
    wonUsdOf(builderId).catch(fail('won')),
    applicationCounts(builderId).catch(fail('applications')),
  ]);
  return {
    score,
    rank: score !== null ? o.lines.bench : null,
    streak: o.streak,
    wonUsd: wonUsd ?? 0,
    applied: counts?.applied ?? 0,
    drafts: counts?.drafts ?? 0,
    next: nextDeadline(o.fits, o.cards, o.now),
  };
}
