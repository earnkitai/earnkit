/**
 * The screen tool, for a program's reviewer: with applicants, queue a job; with job_id, progress and
 * results (public rows only); with job_id and outcomes, the program's decisions. Only a linked builder
 * the owner marked a reviewer of the program may call it; every refusal is one line and writes nothing.
 */
import { z } from 'zod';
import { inputDetail } from '../v5/tool-input';
import { getProgram } from '../v5/programs';
import { LIMITS, hit } from '../v5/rate-limit';
import { signInLink } from './record-tool';
import { reviewerPrograms } from './reviewers';
import { createJob, jobResults, jobStatus, recordOutcomes, ScreenApplicant, type ScreenResults } from './screen-jobs';
import { DEFAULT_THRESHOLDS, TIERS, type Thresholds } from './tiers';

export const ScreenInput = z
  .object({
    program_id: z.string().max(100).optional().describe('The program you review; omit when you review one'),
    applicants: z.array(ScreenApplicant).max(200).optional().describe('The list to screen: ref, name, repo_url, live_url, contracts, pitch, applied_at'),
    thresholds: z.record(z.string(), z.number()).optional().describe('Tier thresholds to override, by name'),
    job_id: z.string().max(40).optional().describe('A queued screen: its progress and results'),
    outcomes: z
      .array(z.object({ ref: z.string().max(60), outcome: z.enum(['won', 'rejected', 'shortlisted']), amount_usd: z.number().positive().max(1e9).optional() }).strict())
      .max(200)
      .optional()
      .describe('With job_id: the decisions, by ref'),
  })
  .strict();
export type ScreenReply = { show_to_builder: string; agent_note: string; job_id?: string; results?: ScreenResults; recorded?: number };

export const SCREEN_TEXT = {
  unlinked: (link: string) => `Sign in once at ${link} so EarnKit knows which program you review for.`,
  unlinkedNoLink: 'Sign in first, then ask EarnKit to add you as a reviewer for your program.',
  notReviewer: 'You are not yet a reviewer for that program here. Ask EarnKit to add you.',
  limit: 'Ten screens a day is the limit here.',
  whichProgram: 'Name the program you are screening for.',
  empty: 'Hand me at least one applicant.',
  noJob: 'No screen with that id here.',
  expired: 'That screen has expired; queue the list again.',
  nothing: 'Hand me an applicant list to queue, or a job_id for its results.',
  unread: "I could not read that. Send the applicant list, or a screen's id for its results.",
  queuedNote: 'Call screen with job_id for progress and results. Tell the builder what each tier means: used, live, building, unverified, flagged.',
  sortNote: 'Sort: used, then live, then building; flagged last with the rule named.',
  pendingNote: 'Call screen with job_id again later for the rest.',
  stopNote: 'Show this line and stop.',
} as const;

const line = (show: string, agent_note: string = SCREEN_TEXT.stopNote): ScreenReply => ({ show_to_builder: show, agent_note });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "412 applicants: 31 used, 88 live, 190 building, 74 unverified, 29 flagged; 0 pending." Pure. */
export function totalsLine(r: ScreenResults): string {
  const unread = r.total - r.totals.pending - TIERS.reduce((s, t) => s + r.totals[t], 0);
  const tiers = TIERS.map((t) => `${r.totals[t]} ${t}`).join(', ');
  return `${plural(r.total, 'applicant')}: ${tiers}; ${r.totals.pending} pending${unread > 0 ? `; ${unread} could not be read` : ''}.`;
}

/** Known threshold names only; the first unknown one is the refusal line. Pure. */
function thresholdsOf(given: Record<string, number> | undefined): Partial<Thresholds> | string {
  if (!given) return {};
  for (const k of Object.keys(given)) if (!Object.hasOwn(DEFAULT_THRESHOLDS, k)) return `Unknown threshold ${k}. Known: ${Object.keys(DEFAULT_THRESHOLDS).join(', ')}.`;
  return given as Partial<Thresholds>;
}

export async function screenTool(ctx: { installationId: number; builderId: number | null; now: Date }, raw: unknown): Promise<ScreenReply> {
  // The MCP layer passes anything through (tool-input.ts): this is the only check, with the detail for the agent.
  const parsed = ScreenInput.safeParse(raw);
  if (!parsed.success) return line(SCREEN_TEXT.unread, `Nothing was queued. ${inputDetail(parsed.error)}`);
  const input = parsed.data;
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
      const { recorded } = await recordOutcomes(input.job_id, ctx.builderId, input.outcomes, ctx.now);
      return { ...line(`Recorded ${plural(recorded, 'outcome')}.`, 'Tell the builder the outcomes are recorded.'), recorded };
    }
    const results = await jobResults(input.job_id, ctx.builderId, ctx.now);
    if (!results) return line(SCREEN_TEXT.expired);
    return { show_to_builder: totalsLine(results), agent_note: results.finished ? SCREEN_TEXT.sortNote : SCREEN_TEXT.pendingNote, job_id: results.job_id, results };
  }

  if (!input.applicants) return line(programs.length ? SCREEN_TEXT.nothing : SCREEN_TEXT.notReviewer);
  const programId = input.program_id ?? (programs.length === 1 ? programs[0] : null);
  if (!programId) return line(programs.length ? SCREEN_TEXT.whichProgram : SCREEN_TEXT.notReviewer);
  if (!programs.includes(programId)) return line(SCREEN_TEXT.notReviewer);
  if (!input.applicants.length) return line(SCREEN_TEXT.empty);
  const thresholds = thresholdsOf(input.thresholds);
  if (typeof thresholds === 'string') return line(thresholds);
  const program = await getProgram(programId);
  if (!program) return line(SCREEN_TEXT.notReviewer);
  // Counted atomically, per reviewer (not per installation), only once every refusal above has passed.
  const { limit, windowSeconds } = LIMITS.screenJobs;
  if (!(await hit(`screenJobs:b:${ctx.builderId}`, limit, windowSeconds, ctx.now)).allowed) return line(SCREEN_TEXT.limit);

  const job = await createJob({ programId, builderId: ctx.builderId, installationId: ctx.installationId, applicants: input.applicants, thresholds, now: ctx.now });
  return {
    show_to_builder: `Queued ${plural(job.total, 'applicant')} for ${program.file.title}; ${job.cached} already read. Results by tomorrow morning, or sooner when EarnKit runs the queue.`,
    agent_note: SCREEN_TEXT.queuedNote,
    job_id: job.id,
  };
}
