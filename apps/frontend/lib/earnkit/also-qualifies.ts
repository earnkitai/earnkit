import type { Chain } from './match';
import type { FieldKind, SubmissionRequirement } from './program-file';
import { bankFill } from './coach';
import { prepareSubmission, type ProjectInfo } from './submission';
import { AMOUNT_HEADER, endsOf, prizeOf, upToCell } from './entry-text';
import { table } from './present';
import type { Difficulty } from './guide';

/**
 * v2.8 Ruling 29 (plan): "Also qualifies", shown right after record_submission (the entry is
 * recorded). Pure: no DB, no network, no LLM. Reuses the answer bank (coach.ts bankFill) so a
 * later program shows how little is left to answer, the same way the coach does.
 */

export const MAX_ALSO = 3;

/** What alsoQualifies needs about one candidate program. */
export type AlsoProgram = {
  id: string;
  title: string;
  summary: string;
  chains: Chain[];
  any_chain: boolean;
  existing_work: 'allowed' | 'new_work_only' | 'unknown';
  /** Review fix round 1, item 3: matchRepo's "needs a live product" gate (match.ts tag). */
  tag: string | null;
  ends_at: Date | null;
  status: 'active' | 'closed' | 'upcoming' | 'unlisted';
  campaign: boolean;
  source: 'file' | 'sponsor' | 'api';
  /**
   * Ruling C23: an investment program (a16z speedrun). Never in Also qualifies: its form isn't
   * public, so "Still needed" can't be counted, and it is never shown as a prize.
   */
  investment: boolean;
  /** v2.9 A3: the round's window and when it opened, for "applied outside EarnKit" (hiddenPrograms). */
  starts_at?: Date | null;
  opened_at?: Date | null;
  /** Review fix round 1, item 1 (C4): the top prize per winner, for the sort; null for a campaign or unstated. */
  max_award_usd: number | null;
  /** Review fix round 1, item 1 (C4): null for any campaign, as programCard computes it. */
  difficulty: Difficulty | null;
  requirements: SubmissionRequirement[];
};

export type AlsoRow = {
  id: string;
  title: string;
  prize: string;
  ends: string;
  left: number;
  /** Fix round 1, item 3: the only gap is the live link; "Still needed" names it, not a count. */
  needsLive?: true;
};

const DAY = 86_400_000;

/**
 * Up to MAX_ALSO other curated programs the project already qualifies for. Never the program just
 * entered, and never one already entered by this installation for the same project (Task 8 carry:
 * a confirmed-but-unsubmitted entry counts as entered, so the same program is never offered
 * twice); never one the builder is not interested in or applied to outside EarnKit (v2.9 A3); never a sponsor program, a campaign, `new_work_only`, closed, or ending within 2 days;
 * needs a chain fit, or `any_chain`. Never an investment program (Ruling C23). A program tagged "needs a live product" (matchRepo's gate)
 * shows only once the project has a live product, or when the live link is the only thing left to
 * answer (then "Still needed" names it). Sorted Easy first (C4), then the larger top prize per
 * winner, then fewest required fields the answer bank can't fill (the entry's own answers,
 * re-keyed by kind through the bank). A field the project info fills (its repo, its live link, its
 * name) counts as filled: the count runs prepareSubmission, as the coach does. Pure.
 */
export function alsoQualifies(a: {
  enteredProgramId: string;
  chains: Chain[];
  programs: AlsoProgram[];
  enteredIds: Set<string>;
  bank: Map<FieldKind, string>;
  answers: Record<string, string>;
  /** The project info (repo, live link, name, ...): fields it fills are never counted as left. */
  project?: ProjectInfo;
  /** Whether the project has a live product (its live link), for the "needs a live product" gate. */
  hasLiveProduct: boolean;
  now: Date;
  /** v2.9 A3 (builder-memory.ts hiddenPrograms): not interested, or applied outside EarnKit this round. */
  hidden?: { notInterested: Set<string>; applied: Set<string> };
  /**
   * v2.9 T12 (G15 M1): whether the entered repo could really win this program (the alert precision
   * rule, alerts.ts repoCanWin, over what the builder said): never a program whose row still needs
   * real users or new work, or is Hard and small. Absent: every program passes.
   */
  canWin?: (p: AlsoProgram) => boolean;
}): AlsoRow[] {
  const rows = a.programs
    .filter((p) => p.id !== a.enteredProgramId && !a.enteredIds.has(p.id))
    .filter((p) => a.canWin?.(p) ?? true)
    .filter((p) => !a.hidden?.notInterested.has(p.id) && !a.hidden?.applied.has(p.id))
    .filter((p) => p.status === 'active' && p.source === 'file' && !p.campaign && !p.investment && p.existing_work !== 'new_work_only')
    .filter((p) => p.ends_at === null || p.ends_at.getTime() - a.now.getTime() >= 2 * DAY)
    .filter((p) => p.any_chain || p.chains.some((c) => a.chains.includes(c)))
    .map((p) => {
      // Final review I1: the same check as the coach (prepareSubmission), so a field the project
      // info fills (repo, live link, name) is never counted as left.
      const filled = bankFill(p.requirements, a.answers, a.bank).answers;
      const missing = new Set(
        prepareSubmission(p.requirements, { project: a.project, answers: filled })
          .missing.filter((m) => m.required)
          .map((m) => m.key),
      );
      const empty = p.requirements.filter((r) => missing.has(r.key));
      const contact = empty.some((r) => (r.kind ?? 'other') === 'contact') ? 1 : 0;
      const left = empty.filter((r) => (r.kind ?? 'other') !== 'contact').length + contact;
      // The live-product gate: a tagged program needs a live product; without one, it can still
      // show when the live link is the only thing left (that field, and nothing else, is empty).
      const liveField = p.requirements.find((r) => r.project_field === 'live_url');
      const needsLiveProduct = p.tag === 'needs a live product' && !a.hasLiveProduct;
      const liveOnly = needsLiveProduct && liveField !== undefined && empty.length === 1 && empty[0] === liveField;
      return { p, left, blocked: needsLiveProduct && !liveOnly, liveOnly };
    })
    .filter(({ blocked }) => !blocked)
    .sort(
      (x, y) =>
        Number(y.p.difficulty?.level === 'Easy') - Number(x.p.difficulty?.level === 'Easy') ||
        (y.p.max_award_usd ?? -1) - (x.p.max_award_usd ?? -1) ||
        x.left - y.left,
    );
  return rows.slice(0, MAX_ALSO).map(({ p, left, liveOnly }) => ({
    id: p.id,
    title: p.title,
    prize: prizeOf(p),
    ends: endsOf(p),
    left,
    ...(liveOnly && { needsLive: true as const }),
  }));
}

/** "a live link", "1 answer", "3 answers", "nothing". Pure. */
const needs = (r: AlsoRow) => (r.needsLive ? 'a live link' : r.left === 0 ? 'nothing' : `${r.left} answer${r.left === 1 ? '' : 's'}`);

/**
 * The builder's "Also qualifies" message, or null with no rows. v2.10 item 1: no bonus sentences
 * (the reply's one bonus line is enteredText's). Pure.
 */
export function alsoText(rows: AlsoRow[]): string | null {
  if (rows.length === 0) return null;
  const body = rows.map((r) => [r.title, upToCell(r.prize), r.ends, needs(r)]);
  return `You also qualify for:\n${table(['Program', AMOUNT_HEADER, 'Ends', 'Still needed'], body)}\nSay "enter it here too" for any of them.`;
}
