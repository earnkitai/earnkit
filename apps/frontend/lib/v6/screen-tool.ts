/**
 * The screen tool, for a program's reviewer: with applicants, queue a job; with job_id, progress and
 * results (public rows only); with job_id and outcomes, the program's decisions. Only a linked builder
 * the owner marked a reviewer of the program may call it; every refusal is one line and writes nothing.
 */
import { z } from 'zod';
import { inputDetail } from '../v5/tool-input';
import { OVER_CAP, WHOLE_DOLLARS, winCapOf } from '../v5/ledger';
import { getProgram } from '../v5/programs';
import { LIMITS, hit } from '../v5/rate-limit';
import { listWords, signInLink } from './record-tool';
import { reviewerPrograms } from './reviewers';
import { badRequeues, createJob, jobResults, jobStatus, OWN_APPLICATION, queuedAhead, recordOutcomes, ScreenApplicant, type ScreenResults } from './screen-jobs';
import { SCREEN_BATCH } from './screen-worker';
import { DEFAULT_THRESHOLDS, TIERS, type Thresholds } from './tiers';

export const ScreenInput = z
  .object({
    program_id: z.string().max(100).optional().describe('The program you review; omit when you review one'),
    applicants: z.array(ScreenApplicant).optional().describe('The list to screen, each { ref (required), name, repo_url, live_url, contracts: [{ chain, address }], pitch, applied_at, application_id, requeue: { job_id, ref } of the earlier row it replaces }'),
    thresholds: z.record(z.string(), z.number()).optional().describe('Tier thresholds to override, by name'),
    job_id: z.string().max(40).optional().describe('A queued screen: its progress and results'),
    page: z.number().int().min(1).max(1000).optional().describe('With job_id: the page of results, 25 applicants each, from 1; next_page names the next, null on the last'),
    outcomes: z
      .array(z.object({ ref: z.string().max(60), outcome: z.enum(['won', 'rejected', 'shortlisted']), amount_usd: z.number().finite().optional() }).strict())
      .optional()
      .describe('With job_id: the decisions, by ref'),
  })
  .strict();
/** The most applicants or outcomes one call reads (C2, v6.1.13); 200 is read, 201 refused. */
export const SCREEN_MAX = 200;
export type ScreenReply = { show_to_builder: string; agent_note: string; job_id?: string; results?: ScreenResults; next_page?: number | null; recorded?: number };

export const SCREEN_TEXT = {
  unlinked: (link: string) => `Sign in once at ${link} so EarnKit knows which program you review for.`,
  unlinkedNoLink: 'Screening is for program reviewers.',
  notReviewer: 'Screening is for program reviewers, and you do not review that program.',
  noProgram: 'You review no program yet.',
  limit: 'You can queue ten screens a day.',
  whichProgram: 'Name the program you are screening for.',
  empty: 'Hand me at least one applicant.',
  noJob: "I don't have that screen.",
  expired: 'That screen has expired; queue the list again.',
  nothing: 'Give me an applicant list, or the screen you queued.',
  unread: "I could not read that. Send the applicant list, or a screen's id for its results.",
  /** C2 (v6.1.13): over SCREEN_MAX applicants or outcomes in one call. */
  overMax: 'At most 200 at a time; send the rest in another call.',
  queuedNote: 'Call screen with job_id for progress and results. Tell the builder what each tier means: used, live, building, unverified, flagged.',
  sortNote: 'Sort: used, then live, then building; flagged last with the rule named.',
  pendingNote: 'Call screen with job_id again later for the rest.',
  stopNote: 'Show this line and stop.',
  /** L15-3 (v6.1.14): the last line of a page with more to come. */
  nextPage: (n: number) => `Ask for page ${n} for the rest.`,
  /** Task 8 security follow-up (v6.1.14): a requeue that names no earlier row of the program with the same EarnKit id. */
  badRequeue: (refs: string) => `Not queued: the earlier row named for ${refs} is not in this program's screens with the same EarnKit id.`,
} as const;

/** L13-5 (v6.1.14): a refused outcomes call writes none of them. */
const OUTCOMES_UNWRITTEN = 'Nothing was recorded. Show this line and stop.';
const line = (show: string, agent_note: string = SCREEN_TEXT.stopNote): ScreenReply => ({ show_to_builder: show, agent_note });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "412 applicants: 31 used, 88 live, 190 building, 74 unverified, 29 flagged; 0 pending." Pure. */
export function totalsLine(r: ScreenResults): string {
  const unread = r.total - r.totals.pending - TIERS.reduce((s, t) => s + r.totals[t], 0);
  const tiers = TIERS.map((t) => `${r.totals[t]} ${t}`).join(', ');
  return `${plural(r.total, 'applicant')}: ${tiers}; ${r.totals.pending} pending${unread > 0 ? `; ${unread} could not be read` : ''}.`;
}

/** Known threshold names only, each from 0 to 100 (v6.1.7 C39); the first that is not is the refusal line. Pure. */
function thresholdsOf(given: Record<string, number> | undefined): Partial<Thresholds> | string {
  if (!given) return {};
  for (const [k, v] of Object.entries(given)) {
    if (!Object.hasOwn(DEFAULT_THRESHOLDS, k)) return `Unknown threshold ${k}. Known: ${Object.keys(DEFAULT_THRESHOLDS).join(', ')}.`;
    if (!(v >= 0 && v <= 100)) return `Threshold ${k} must be from 0 to 100.`;
  }
  return given as Partial<Thresholds>;
}

/**
 * When the results come (v6.1.7 B14): the daily run reads SCREEN_BATCH applicants, oldest job first, so the job
 * is done in the next run when it fits after the queue ahead of it; else in as many daily runs as the two need. Pure.
 */
export function promiseLine(ahead: number, total: number): string {
  const days = Math.ceil((ahead + total) / SCREEN_BATCH);
  return days <= 1 ? 'Results by tomorrow morning.' : `${plural(ahead, 'applicant')} ahead of yours; results within ${days} days.`;
}

export async function screenTool(ctx: { installationId: number; builderId: number | null; now: Date }, raw: unknown): Promise<ScreenReply> {
  // The MCP layer passes anything through (tool-input.ts): this is the only check, with the detail for the agent.
  // T6 (v6.1.14): an applicant's old `repo` key, as text, reads as `repo_url` when that is not given; any other `repo` is refused by its own key (F5).
  const r = raw as { applicants?: unknown } | null;
  const list: unknown[] = Array.isArray(r?.applicants) ? r.applicants : [];
  const badRepo = list.findIndex((a) => a && typeof a === 'object' && 'repo' in a && a.repo != null && typeof a.repo !== 'string' && !('repo_url' in a));
  if (badRepo >= 0) return line(SCREEN_TEXT.unread, `Nothing was queued. applicants.${badRepo}.repo: not text; send the repo link as text in repo_url.`);
  const aliased = list.length ? { ...r, applicants: list.map((a) => (a && typeof a === 'object' && 'repo' in a && typeof a.repo === 'string' && !('repo_url' in a) ? { ...a, repo_url: a.repo } : a)) } : raw;
  const parsed = ScreenInput.safeParse(aliased);
  // L13-5 (v6.1.14): the note says what was not written: outcomes are recorded, a list is queued.
  const nothing = r && typeof r === 'object' && 'outcomes' in r ? 'Nothing was recorded.' : 'Nothing was queued.';
  if (!parsed.success) return line(SCREEN_TEXT.unread, `${nothing} ${inputDetail(parsed.error)}`);
  const input = parsed.data;
  // C2 (v6.1.13): a list over SCREEN_MAX was read, it is only too long: one line, nothing written.
  if ((input.applicants?.length ?? 0) > SCREEN_MAX) return line(SCREEN_TEXT.overMax, 'Nothing was queued. Split the list and call screen once per part.');
  if ((input.outcomes?.length ?? 0) > SCREEN_MAX) return line(SCREEN_TEXT.overMax, 'Nothing was recorded. Split the outcomes and call screen once per part.');
  if (ctx.builderId === null) {
    // R7: the installation's sign-in link, as find and record give it; no link (not configured, or refused) keeps one plain line.
    const link = await signInLink(ctx.installationId, ctx.now);
    return line(link ? SCREEN_TEXT.unlinked(link) : SCREEN_TEXT.unlinkedNoLink);
  }
  const programs = await reviewerPrograms(ctx.builderId);

  if (input.job_id) {
    const s = await jobStatus(input.job_id, ctx.builderId, ctx.now);
    if (!s || !programs.includes(s.program_id)) return line(SCREEN_TEXT.noJob);
    if (s.expired) return line(SCREEN_TEXT.expired);
    if (input.outcomes) {
      // A win over what the program pays is refused as the ledger refuses it, and nothing is recorded (v6.1.7 C38).
      // Low 19 (v6.1.13): a win is whole dollars, at least 1, as the ledger takes it.
      if (input.outcomes.some((o) => o.outcome === 'won' && o.amount_usd != null && !(Number.isInteger(o.amount_usd) && o.amount_usd >= 1))) return line(WHOLE_DOLLARS, OUTCOMES_UNWRITTEN);
      const cap = winCapOf(await getProgram(s.program_id));
      // L13-5 (v6.1.14): any amount over the cap, however large, is this line, as the ledger answers it.
      if (input.outcomes.some((o) => o.outcome === 'won' && o.amount_usd != null && o.amount_usd > cap)) return line(OVER_CAP, OUTCOMES_UNWRITTEN);
      const { recorded, notFound, notes, own } = await recordOutcomes(input.job_id, ctx.builderId, input.outcomes, ctx.now);
      // The refs not in this screen are named (C19); L15-1 (v6.1.14): an outcome on the reviewer's own application is refused in one line.
      const counted = notFound.length > 0 ? `Recorded ${plural(recorded, 'outcome')}; not found: ${listWords(notFound, 10)}.` : `Recorded ${plural(recorded, 'outcome')}.`;
      const show = own ? `${counted} ${OWN_APPLICATION}` : counted;
      const note = notFound.length > 0 ? 'Tell the builder the outcomes are recorded, and which refs this screen does not hold.' : 'Tell the builder the outcomes are recorded.';
      return { ...line(show, [note, ...notes].join(' ')), recorded };
    }
    const results = await jobResults(input.job_id, ctx.builderId, ctx.now, input.page ?? 1);
    if (!results) return line(SCREEN_TEXT.expired);
    // L15-3 (v6.1.14): one page of 25; the last line asks for the next when there is one.
    const more = results.next_page !== null ? ` ${SCREEN_TEXT.nextPage(results.next_page)}` : '';
    return {
      show_to_builder: `${totalsLine(results)}${more}`,
      agent_note: [results.finished ? SCREEN_TEXT.sortNote : SCREEN_TEXT.pendingNote, ...(results.next_page !== null ? [`Call screen with job_id and page ${results.next_page} for the next 25.`] : [])].join(' '),
      job_id: results.job_id,
      results,
      next_page: results.next_page,
    };
  }

  // A builder who reviews no program and names none hears that in one line (v6.1.7 C18).
  if (!programs.length && !input.program_id) return line(SCREEN_TEXT.noProgram);
  if (!input.applicants) return line(programs.length ? SCREEN_TEXT.nothing : SCREEN_TEXT.notReviewer);
  const programId = input.program_id ?? (programs.length === 1 ? programs[0] : null);
  if (!programId) return line(programs.length ? SCREEN_TEXT.whichProgram : SCREEN_TEXT.notReviewer);
  if (!programs.includes(programId)) return line(SCREEN_TEXT.notReviewer);
  if (!input.applicants.length) return line(SCREEN_TEXT.empty);
  const thresholds = thresholdsOf(input.thresholds);
  if (typeof thresholds === 'string') return line(thresholds);
  const program = await getProgram(programId);
  if (!program) return line(SCREEN_TEXT.notReviewer);
  // Task 8 security follow-up (v6.1.14): a requeue must name an earlier row of this program carrying the same id.
  const bad = await badRequeues(programId, input.applicants);
  if (bad.length > 0) return line(SCREEN_TEXT.badRequeue(listWords(bad, 10)), 'Nothing was queued. Each requeue names { job_id, ref } of an earlier row of this program with the same application_id; fix or drop it and call screen again.');
  // Counted atomically, per reviewer (not per installation), only once every refusal above has passed.
  const { limit, windowSeconds } = LIMITS.screenJobs;
  if (!(await hit(`screenJobs:b:${ctx.builderId}`, limit, windowSeconds, ctx.now)).allowed) return line(SCREEN_TEXT.limit);

  const job = await createJob({ programId, builderId: ctx.builderId, installationId: ctx.installationId, applicants: input.applicants, thresholds, now: ctx.now });
  const ahead = await queuedAhead(job.id, ctx.now);
  return {
    show_to_builder: `Queued ${plural(job.total, 'applicant')} for ${program.file.title}. ${promiseLine(ahead, job.total)}`,
    agent_note: SCREEN_TEXT.queuedNote,
    job_id: job.id,
  };
}
