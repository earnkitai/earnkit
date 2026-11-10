/**
 * The track tool: validates the input, writes the ledger (or, for started, the claim), and answers
 * with one line for the builder, one for the agent, and the updated ledger.
 */
import { z } from 'zod';
import { getRecord, ownerKey, takeUnlinkedNotice, unlinkedReason } from '../v6/builders';
import { DELETED_NOTICE } from '../v6/reply-words';
import { claim } from '../v6/claims';
import { NIGHT_LIMIT, REQUIRED_MISSING, outsideApproval, requiredLeftOut, storedRecordContext } from '../v6/find-record';
import { prefill, reportedFacts, unvouchedRequired } from './prefill';
import { forgetGap, lastGaps, lastProjectKey, unmarkNightFind } from './installations';
import { projectKeyOf } from './project-input';
import { getProgram, isOpen, listOpenPrograms } from './programs';
import { dayOf, doneItems, record, summary, titleOf, type Ledger, type Status } from './ledger';
import { clock } from './reply';
import { codeChecked, itemKey } from './eligibility';
import { eligibilityOf } from './program-file';
import { sql } from './db';
import { inputDetail } from './tool-input';

export const TrackInput = z
  .object({
    program_id: z.string().min(1).max(80),
    status: z.enum(['started', 'applied', 'won', 'rejected', 'no_result', 'skipped', 'unskip', 'gap_done']),
    amount_usd: z.number().finite().min(0).max(100_000_000).optional(),
    note: z.string().max(280).optional(),
    item: z.string().max(80).optional(),
    project_id: z.string().max(40).optional(),
    submitted_by: z.enum(['agent', 'builder']).optional(),
    fields_used: z.array(z.string().max(60)).max(60).optional(),
    /** The project find was called with (v6.1.10 L1c-1): only its name and repo link are read, the rest is ignored. */
    project: z.object({ name: z.unknown().optional(), repo_url: z.unknown().optional() }).passthrough().optional()
      .describe('The project you passed to find (its name and repo_url), so its steps stay with it'),
  })
  .strict();

type Result = { show_to_builder: string; agent_note: string; ledger: Ledger; already_started?: true };

/** A passed project fact as text, or null. Pure. */
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

/** True when the owner's row for the program is an application already sent (applied or with a result). */
async function sentHere(owner: string, programId: string): Promise<boolean> {
  const [r] = await sql()<{ status: string }[]>`SELECT status FROM applications WHERE owner = ${owner} AND program_id = ${programId}`;
  return r !== undefined && r.status !== 'started' && r.status !== 'skipped';
}

/** The program's rules the owner has not confirmed yet. */
async function rulesLeft(owner: string, programId: string, projectKey: string): Promise<number> {
  const program = await getProgram(programId);
  if (!program) return 0;
  const done = await doneItems(owner, programId, projectKey);
  return [...new Set(eligibilityOf(program.file).filter((x) => x.kind === 'rule').map(itemKey))].filter((k) => !done.has(k)).length;
}

export type TrackContext = { installationId: number; builderId: number | null; now: Date };

export const TRACK_UNREAD = 'I could not read that. Send the program, a status, and for a win the amount.';

/**
 * The project this track is about (projectKeyOf, v6.1.10 L1c-1): the project passed, else the record project named by
 * project_id, else the installation's last find with a project. `given` is false for the last find's.
 */
async function projectOf(ctx: TrackContext, i: { project?: { name?: unknown; repo_url?: unknown }; project_id?: string }): Promise<{ key: string; given: boolean }> {
  const passed = projectKeyOf(i.project);
  if (passed) return { key: passed, given: true };
  if (i.project_id !== undefined && ctx.builderId !== null) {
    const p = (await getRecord(ctx.builderId)).projects.find((x) => x.id === i.project_id);
    const key = projectKeyOf(p);
    if (key) return { key, given: true };
  }
  return { key: await lastProjectKey(ctx.installationId), given: false };
}

/** Whether `projectId` is one of the linked builder's record projects (an unlinked installation has none). */
async function knownProject(builderId: number | null, projectId: string): Promise<boolean> {
  return builderId !== null && (await getRecord(builderId)).projects.some((p) => p.id === projectId);
}

/** The agent's next step on a program the builder presses submit on (in person, or builder-only; v6.1.9). */
export const BUILDER_SUBMITS = 'The builder presses submit; prepare the answers and hand them over.';
/** After track started: fill and submit, or (`builderSubmits`) fill and hand over. */
const sendNote = (builderSubmits: boolean) =>
  builderSubmits
    ? `Fill the form from the fields. ${BUILDER_SUBMITS} Once it is sent, call track with applied, submitted_by builder and fields_used.`
    : 'Fill the form from the fields, submit, then call track with applied, submitted_by and fields_used.';

export async function track(ctx: TrackContext, input: unknown): Promise<Result> {
  // v6.1.9: a send tracked as the first call after the account was deleted writes nothing; the notice alone answers.
  const sending = (input as { status?: unknown } | null)?.status === 'applied';
  if (sending && ctx.builderId === null && (await unlinkedReason(ctx.installationId)) === 'deleted') {
    const owner = ownerKey(ctx.installationId, null);
    const r: Result = {
      show_to_builder: DELETED_NOTICE,
      agent_note: 'Nothing was recorded: the builder deleted their record and this agent is unlinked. Ask the builder before you track this send again.',
      ledger: await summary(owner, await listOpenPrograms(ctx.now), ctx.now),
    };
    if (await takeUnlinkedNotice(ctx.installationId)) return r;
  }
  const r = await answer(ctx, input);
  // C51 (v6.1.9): the first call after the account was deleted carries the notice, track as well as find and record;
  // taken once the reply is built, so a throw keeps it for the next call.
  if (ctx.builderId !== null || (await unlinkedReason(ctx.installationId)) !== 'deleted' || !(await takeUnlinkedNotice(ctx.installationId))) return r;
  return { ...r, show_to_builder: `${DELETED_NOTICE} ${r.show_to_builder}` };
}

async function answer(ctx: TrackContext, input: unknown): Promise<Result> {
  const owner = ownerKey(ctx.installationId, ctx.builderId);
  const programs = await listOpenPrograms(ctx.now);
  const refuse = async (note: string, agentNote = 'Nothing was recorded.'): Promise<Result> => ({
    show_to_builder: note,
    agent_note: agentNote,
    ledger: await summary(owner, programs, ctx.now),
  });
  // The MCP layer passes anything through (tool-input.ts): this is the only check, with the detail for the agent.
  const parsed = TrackInput.safeParse(input);
  if (!parsed.success) return refuse(TRACK_UNREAD, `Nothing was recorded. ${inputDetail(parsed.error)}`);
  // An unknown project_id is dropped, and named for the agent (v6.1.7, C17).
  const { project_id, ...rest } = parsed.data;
  if (project_id === undefined || (await knownProject(ctx.builderId, project_id))) return act(ctx, owner, programs, refuse, parsed.data);
  const r = await act(ctx, owner, programs, refuse, rest);
  return { ...r, agent_note: `${r.agent_note} project_id ${project_id} is not known; ignored.`.trim() };
}

/**
 * The required fields a send under standing approval cannot vouch for: the program prefilled with the stored record and
 * the send's project (its passed links, else the record project's; else the last find's project key), as reported.
 */
export async function unvouchedAtSend(ctx: TrackContext, i: z.infer<typeof TrackInput>, row: NonNullable<Awaited<ReturnType<typeof getProgram>>>): Promise<string[]> {
  const passed = (i.project ?? {}) as Record<string, unknown>;
  const last = passed.name === undefined && passed.repo_url === undefined ? await lastProjectKey(ctx.installationId) : '';
  const fromKey = last.startsWith('name:') ? { name: last.slice(5) } : last ? { repo_url: last } : {};
  const repo = str(passed.repo_url) ?? (fromKey as { repo_url?: string }).repo_url ?? null;
  const name = str(passed.name) ?? (fromKey as { name?: string }).name ?? null;
  const rec = await storedRecordContext(ctx.builderId!, i.project_id, repo, name);
  const stored = rec.record.projects.find((p) => p.id === rec.projectId);
  const facts = reportedFacts({
    name: name ?? stored?.name ?? null, description: str(passed.description),
    repo_url: repo ?? stored?.repo_url ?? null, live_url: str(passed.live_url) ?? stored?.live_url ?? null, demo_url: str(passed.demo_url),
  });
  return unvouchedRequired(prefill(row, facts, rec).fields).map((f) => f.key);
}

async function act(
  ctx: TrackContext,
  owner: string,
  programs: Awaited<ReturnType<typeof listOpenPrograms>>,
  refuse: (note: string, agentNote?: string) => Promise<Result>,
  i: z.infer<typeof TrackInput>,
): Promise<Result> {
  const project = await projectOf(ctx, i);
  // The last find's gaps are its project's: another project passed here is not that one.
  const sameAsLast = !project.given || project.key === (await lastProjectKey(ctx.installationId));
  if (i.status === 'started') {
    const program = await getProgram(i.program_id);
    if (!program) return refuse("I don't know that program.");
    const sentAlready = {
      show_to_builder: `${program.file.title} was already sent.`,
      agent_note: 'Do not submit this one; it was already sent.',
    };
    // The same open list find reads (active, not past its close, not stale): a program not in it is never claimed.
    // An application already sent says so first, even when its program has since closed (v6.1.7).
    if (!programs.some((p) => p.id === program.id) && (await sentHere(owner, program.id)))
      return { ...sentAlready, ledger: await summary(owner, programs, ctx.now), already_started: true };
    if (!programs.some((p) => p.id === program.id))
      return refuse(`${program.file.title} is not open; nothing to start.`, 'Do not submit this one; call find for what is open.');
    const c = await claim(owner, i.program_id, i.project_id ?? null, ctx.installationId, ctx.now);
    if (!c.ok && 'skipped' in c)
      return {
        show_to_builder: 'You skipped that one. Say unskip to bring it back.',
        agent_note: 'Do not submit this one.',
        ledger: await summary(owner, programs, ctx.now),
      };
    if (!c.ok)
      return {
        ...(c.already.sent
          ? sentAlready
          : {
              show_to_builder: `${program.file.title} is already being handled since ${clock(c.already.since, ctx.now)} by ${c.already.by ?? 'another agent'}.`,
              agent_note: 'Do not submit this one; call find again later.',
            }),
        ledger: await summary(owner, programs, ctx.now),
        already_started: true,
      };
    // The last find called this one a gap: say what was still missing, so it is fixed before the form goes in. Not
    // when the builder (through any of their agents) has since closed that item (v6.1.7, C23).
    const builderSubmits = program.file.in_person || program.file.submit === 'builder';
    const gap = sameAsLast ? (await lastGaps(ctx.installationId))[program.id] : undefined;
    if (gap && !(gap.item && (await doneItems(owner, program.id, project.key)).has(gap.item)))
      return gap.kind === 'rule'
        ? {
            show_to_builder: `Started. When I last looked it still had a rule to confirm: ${gap.what}. Say yes if that is you.`,
            agent_note: "If the builder says the rule fits, call track gap_done with that gap's item, then find again. Otherwise skip the program.",
            ledger: await summary(owner, programs, ctx.now),
          }
        : {
            show_to_builder: `Started. When I last looked it was still one change away: ${gap.what}. Make sure that is done first.`,
            agent_note: `Make the change before you submit, or call find again to check it. ${builderSubmits ? sendNote(true) : 'Then fill the form from the fields, submit, and call track with applied, submitted_by and fields_used.'}`,
            ledger: await summary(owner, programs, ctx.now),
          };
    return {
      // N11 (v6.1.9): an unlinked agent has no other agents to speak of.
      show_to_builder: ctx.builderId === null ? 'Started.' : 'Started. Your other agents leave this one alone for 24 hours.',
      agent_note: sendNote(builderSubmits),
      ledger: await summary(owner, programs, ctx.now),
    };
  }
  // Sent under standing approval: the builder's policy at this moment (never for an unlinked installation), and only
  // an agent's own submission; a form the builder sent is never one. With the policy on, the send counts as approved
  // only within every limit (v6.1.8 B18): `outside` says why not; the nightly count is the ledger's, under its lock.
  const policy = i.status === 'applied' && i.submitted_by === 'agent' && ctx.builderId !== null ? await getRecord(ctx.builderId) : null;
  const standing = policy?.policy.auto_apply === true;
  const row = i.status === 'applied' ? await getProgram(i.program_id) : null;
  // S6 (v6.1.9): within the limits, a send under standing approval also needs every required answer.
  // F1 (v6.1.10, fix round 2): and every required field must be one EarnKit vouches for (`unvouchedRequired`, the rule
  // find holds the tonight list on), over the program prefilled with the stored record and the send's project, whatever
  // keys fields_used names.
  const owed = standing && row ? await unvouchedAtSend(ctx, i, row) : [];
  let outside = standing && row ? (outsideApproval(policy!, row) ?? (requiredLeftOut(row, i.fields_used).length > 0 || owed.length > 0 ? REQUIRED_MISSING : null)) : null;
  const applied = i.status === 'applied'
    ? { submitted_by: i.submitted_by, fields_used: i.fields_used, project_id: i.project_id, autoApplied: standing && outside === null, ...(standing ? { maxPerNight: policy!.policy.max_per_night } : {}) }
    : {};
  // A second skip says so (v6.1.9, lane 8 simplify).
  if (i.status === 'skipped' && (await sql()`SELECT 1 FROM applications WHERE owner = ${owner} AND program_id = ${i.program_id} AND status = 'skipped'`).length > 0)
    return { show_to_builder: 'Already skipped.', agent_note: 'Call find again for the updated ledger.', ledger: await summary(owner, programs, ctx.now) };
  const res = await record(owner, i.program_id, i.status as Status, { installationId: ctx.installationId, amount_usd: i.amount_usd, note: i.note, item: i.item, projectKey: project.key, now: ctx.now, ...applied });
  if (res.ok && 'night' in res) outside = NIGHT_LIMIT;
  // The find before a send under standing approval was the night routine's: it leaves the overnight report (v6.1.9).
  if (res.ok && i.status === 'applied' && standing && outside === null) await unmarkNightFind(ctx.installationId);
  if (!res.ok)
    return res.items ? refuse(res.note, `Items for this program: ${res.items.join(', ')}. Call track gap_done with one of them.`) : refuse(res.note);
  if (i.status === 'gap_done' && sameAsLast) await forgetGap(ctx.installationId, i.program_id);
  if (i.status === 'gap_done') {
    // A repeat says so (v6.1.7, C26); a rule is confirmed, not re-read from the repo (m3).
    // N2 (v6.1.8): the program comes back ready only when no other rule of it is left to confirm.
    // N-5 (v6.1.9): what the code or the report settles is re-checked on the next find; the builder's word counts done.
    const left = i.item!.startsWith('rule:') && !('repeated' in res) ? await rulesLeft(owner, i.program_id, project.key) : 0;
    const [show, note] = 'repeated' in res
      ? ['Already noted.', 'Call find again for the updated ledger.']
      : i.item!.startsWith('rule:')
        ? ['Noted. That rule counts as confirmed.', left === 0 ? 'Call find again; the program comes back ready.' : `Call find again; ${left === 1 ? 'one rule is' : `${left} rules are`} left.`]
        : codeChecked(i.item!)
          ? ['Noted. I check the repo on the next look.', 'Call find again so the repo is re-read.']
          : ['Noted.', 'Call find again; that step counts as done.'];
    return { show_to_builder: show, agent_note: note, ledger: await summary(owner, programs, ctx.now) };
  }
  const title = await titleOf(owner, i.program_id);
  const lines: Record<Exclude<Status, 'started' | 'gap_done'>, string> = {
    applied: "Tracked. I'll ask how it went when results are due.",
    won: `Recorded: ${usd(i.amount_usd ?? 0)} from ${title}.`,
    rejected: 'Recorded. On to the next one.',
    no_result: 'Recorded.',
    skipped: `Skipped ${title}. I won't bring it up again.`,
    unskip: `Unskipped ${title}. It can come back in the list.`,
  };
  // v6.1.9: a send after the program closed is still recorded, and says so.
  const closed = i.status === 'applied' && row && !isOpen(row.file, ctx.now) && row.file.ends_at && Date.parse(row.file.ends_at) <= ctx.now.getTime()
    ? `${row.file.title} closed on ${dayOf(new Date(row.file.ends_at))}; recorded anyway.`
    : null;
  if (i.status === 'applied' && outside)
    return {
      show_to_builder: [closed, `Sent, but outside your standing approval: ${outside}.`].filter(Boolean).join(' '),
      agent_note: 'Recorded as applied, not under standing approval. Send nothing else alone that falls outside the limits; ask the builder first. Call find again for the updated ledger.',
      ledger: await summary(owner, programs, ctx.now),
    };
  // I1 (v6.1.9 final): after a send under standing approval the agent does not find again, so the morning report stays.
  return {
    show_to_builder: closed ?? lines[i.status],
    agent_note: i.status === 'applied' && standing && outside === null
      ? "Done for tonight. The builder's next find reports it; do not call find again until they ask."
      : 'Call find again for the updated ledger.',
    ledger: await summary(owner, programs, ctx.now),
  };
}
