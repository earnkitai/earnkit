/**
 * The track tool: validates the input, writes the ledger (or, for started, the claim), and answers
 * with one line for the builder, one for the agent, and the updated ledger.
 */
import { z } from 'zod';
import { getRecord, ownerKey } from '../v6/builders';
import { claim } from '../v6/claims';
import { forgetGap, lastGaps } from './installations';
import { getProgram, listOpenPrograms } from './programs';
import { record, summary, type Ledger, type Status } from './ledger';

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
  })
  .strict();

type Result = { show_to_builder: string; agent_note: string; ledger: Ledger; already_started?: true };

/** "09:14 UTC" for today (UTC), "Nov 5, 22:10 UTC" for another day; "earlier today" when the time does not read. Pure. */
export const clock = (iso: string, now: Date) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'earlier today';
  const hm = `${d.toISOString().slice(11, 16)} UTC`;
  if (d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) return hm;
  return `${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(d)}, ${hm}`;
};

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

export type TrackContext = { installationId: number; builderId: number | null; now: Date };

export async function track(ctx: TrackContext, input: unknown): Promise<Result> {
  const owner = ownerKey(ctx.installationId, ctx.builderId);
  const programs = await listOpenPrograms(ctx.now);
  const refuse = async (note: string, agentNote = 'Nothing was recorded.'): Promise<Result> => ({
    show_to_builder: note,
    agent_note: agentNote,
    ledger: await summary(owner, programs, ctx.now),
  });
  const parsed = TrackInput.safeParse(input);
  if (!parsed.success) return refuse('I could not read that. Send the program, a status, and for a win the amount.');
  const i = parsed.data;
  if (i.status === 'started') {
    const program = await getProgram(i.program_id);
    if (!program) return refuse("I don't know that program.");
    const c = await claim(owner, i.program_id, i.project_id ?? null, ctx.installationId, ctx.now);
    if (!c.ok && 'skipped' in c)
      return {
        show_to_builder: `You skipped ${program.file.title} here; say unskip it if you want it back.`,
        agent_note: 'Do not submit this one.',
        ledger: await summary(owner, programs, ctx.now),
      };
    if (!c.ok)
      return {
        show_to_builder: c.already.sent
          ? `${program.file.title} was already sent.`
          : `${program.file.title} is already being handled since ${clock(c.already.since, ctx.now)} by ${c.already.by ?? 'another agent'}.`,
        agent_note: c.already.sent ? 'Do not submit this one; it was already sent.' : 'Do not submit this one; call find again later.',
        ledger: await summary(owner, programs, ctx.now),
        already_started: true,
      };
    // The last find called this one a gap: say what was still missing, so it is fixed before the form goes in.
    const gap = (await lastGaps(ctx.installationId))[program.id];
    if (gap)
      return {
        show_to_builder: `Started. When I last looked it was still one change away: ${gap}. Make sure that is done first.`,
        agent_note: 'Make the change before you submit, or call find again to check it. Then fill the form from the fields, submit, and call track with applied, submitted_by and fields_used.',
        ledger: await summary(owner, programs, ctx.now),
      };
    return {
      show_to_builder: 'Started. Nothing else will submit this one for 24 hours.',
      agent_note: 'Fill the form from the fields, submit, then call track with applied, submitted_by and fields_used.',
      ledger: await summary(owner, programs, ctx.now),
    };
  }
  // Sent under standing approval: the builder's policy at this moment (never for an unlinked installation).
  // Only an agent's own submission under the builder's standing approval; a form the builder sent is never one.
  const autoApplied = i.status === 'applied' && i.submitted_by === 'agent' && ctx.builderId !== null && (await getRecord(ctx.builderId)).policy.auto_apply;
  const applied = i.status === 'applied' ? { submitted_by: i.submitted_by, fields_used: i.fields_used, project_id: i.project_id, autoApplied } : {};
  const res = await record(owner, i.program_id, i.status as Status, { installationId: ctx.installationId, amount_usd: i.amount_usd, note: i.note, item: i.item, now: ctx.now, ...applied });
  if (!res.ok)
    return res.items ? refuse(res.note, `Items for this program: ${res.items.join(', ')}. Call track gap_done with one of them.`) : refuse(res.note);
  if (i.status === 'gap_done') await forgetGap(ctx.installationId, i.program_id);
  const title = (await getProgram(i.program_id))!.file.title;
  const lines: Record<Exclude<Status, 'started'>, string> = {
    applied: "Tracked. I'll ask how it went when results are due.",
    won: `Recorded: ${usd(i.amount_usd ?? 0)} from ${title}.`,
    rejected: 'Recorded. On to the next one.',
    no_result: 'Recorded.',
    skipped: `Skipped ${title}. I won't bring it up again.`,
    unskip: `Unskipped ${title}. It can come back in the list.`,
    gap_done: "Noted. I'll re-check the repo on the next look.",
  };
  return {
    show_to_builder: lines[i.status],
    agent_note: i.status === 'gap_done' ? 'Call find again so the repo is re-read.' : 'Call find again for the updated ledger.',
    ledger: await summary(owner, programs, ctx.now),
  };
}
