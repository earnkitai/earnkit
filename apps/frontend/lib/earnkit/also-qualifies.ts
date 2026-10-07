import type { Chain } from './match';
import type { FieldKind, SubmissionRequirement } from './program-file';
import { bankFill } from './coach';
import { endsOf, prizeOf } from './entry-text';
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
  status: 'active' | 'closed';
  campaign: boolean;
  source: 'file' | 'sponsor';
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
 * twice); never a sponsor program, a campaign, `new_work_only`, closed, or ending within 2 days;
 * needs a chain fit, or `any_chain`. A program tagged "needs a live product" (matchRepo's gate)
 * shows only once the project has a live product, or when the live link is the only thing left to
 * answer (then "Still needed" names it). Sorted Easy first (C4), then the larger top prize per
 * winner, then fewest required fields the answer bank can't fill (the entry's own answers,
 * re-keyed by kind through the bank). Pure.
 */
export function alsoQualifies(a: {
  enteredProgramId: string;
  chains: Chain[];
  programs: AlsoProgram[];
  enteredIds: Set<string>;
  bank: Map<FieldKind, string>;
  answers: Record<string, string>;
  /** Whether the project has a live product (its live link), for the "needs a live product" gate. */
  hasLiveProduct: boolean;
  now: Date;
}): AlsoRow[] {
  const rows = a.programs
    .filter((p) => p.id !== a.enteredProgramId && !a.enteredIds.has(p.id))
    .filter((p) => p.status === 'active' && p.source === 'file' && !p.campaign && p.existing_work !== 'new_work_only')
    .filter((p) => p.ends_at === null || p.ends_at.getTime() - a.now.getTime() >= 2 * DAY)
    .filter((p) => p.any_chain || p.chains.some((c) => a.chains.includes(c)))
    .map((p) => {
      const filled = bankFill(p.requirements, a.answers, a.bank).answers;
      const empty = p.requirements.filter((r) => r.required && !filled[r.key]?.trim());
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
 * The builder's "Also qualifies" message, or null with no rows. `coinIn` (Ruling 5 (plan)): the
 * program this repo's one token is already entered in, so these other entries know they get none.
 * Pure.
 */
export function alsoText(rows: AlsoRow[], coinIn: string | null): string | null {
  if (rows.length === 0) return null;
  const body = rows.map((r) => [r.title, r.prize, r.ends, needs(r)]);
  const tail = `Say "enter it here too" for any of them.${coinIn ? ` Your builder bonus is in ${coinIn}; these entries don't add to it.` : ''}`;
  return `You also qualify for:\n${table(['Program', 'Prize', 'Ends', 'Still needed'], body)}\n${tail}`;
}
