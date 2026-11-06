/**
 * The track tool: validates the input, writes the ledger (or, for started, the claim), and answers
 * with one line for the builder, one for the agent, and the updated ledger.
 */
import { z } from 'zod';
import { ownerKey } from '../v6/builders';
import { claim } from '../v6/claims';
import { getProgram, listOpenPrograms } from './programs';
import { record, summary, type Ledger, type Status } from './ledger';

export const TrackInput = z
  .object({
    program_id: z.string().min(1),
    status: z.enum(['started', 'applied', 'won', 'rejected', 'no_result', 'skipped', 'gap_done']),
    amount_usd: z.number().optional(),
    note: z.string().max(280).optional(),
    item: z.string().optional(),
    project_id: z.string().max(40).optional(),
    submitted_by: z.enum(['agent', 'builder']).optional(),
    fields_used: z.array(z.string().max(60)).max(60).optional(),
  })
  .strict();

type Result = { show_to_builder: string; agent_note: string; ledger: Ledger; already_started?: true };

/** "09:14 UTC"; "earlier today" when the time does not read. Pure. */
const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'earlier today' : `${d.toISOString().slice(11, 16)} UTC`;
};

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

export type TrackContext = { installationId: number; builderId: number | null; now: Date };

export async function track(ctx: TrackContext, input: unknown): Promise<Result> {
  const owner = ownerKey(ctx.installationId, ctx.builderId);
  const programs = await listOpenPrograms(ctx.now);
  const refuse = async (note: string): Promise<Result> => ({
    show_to_builder: note,
    agent_note: 'Nothing was recorded.',
    ledger: await summary(owner, programs, ctx.now),
  });
  const parsed = TrackInput.safeParse(input);
  if (!parsed.success) return refuse('I could not read that. Send the program, a status, and for a win the amount.');
  const i = parsed.data;
  if (i.status === 'started') {
    const program = await getProgram(i.program_id);
    if (!program) return refuse("I don't know that program.");
    const c = await claim(owner, i.program_id, i.project_id ?? null, ctx.installationId, ctx.now);
    if (!c.ok)
      return {
        show_to_builder: `${program.file.title} is already being handled since ${clock(c.already.since)} by ${c.already.by ?? 'another agent'}.`,
        agent_note: 'Do not submit this one; call find again later.',
        ledger: await summary(owner, programs, ctx.now),
        already_started: true,
      };
    return {
      show_to_builder: 'Started. Nothing else will submit this one for 24 hours.',
      agent_note: 'Fill the form from the fields, submit, then call track with applied, submitted_by and fields_used.',
      ledger: await summary(owner, programs, ctx.now),
    };
  }
  const applied = i.status === 'applied' ? { submitted_by: i.submitted_by, fields_used: i.fields_used, project_id: i.project_id } : {};
  const res = await record(owner, i.program_id, i.status as Status, { installationId: ctx.installationId, amount_usd: i.amount_usd, note: i.note, item: i.item, now: ctx.now, ...applied });
  if (!res.ok) return refuse(res.note);
  const title = (await getProgram(i.program_id))!.file.title;
  const lines: Record<Exclude<Status, 'started'>, string> = {
    applied: "Tracked. I'll ask how it went when results are due.",
    won: `Recorded: ${usd(i.amount_usd ?? 0)} from ${title}.`,
    rejected: 'Recorded. On to the next one.',
    no_result: 'Recorded.',
    skipped: `Skipped ${title}. I won't bring it up again.`,
    gap_done: "Noted. I'll re-check the repo on the next look.",
  };
  return {
    show_to_builder: lines[i.status],
    agent_note: i.status === 'gap_done' ? 'Call find again so the repo is re-read.' : 'Call find again for the updated ledger.',
    ledger: await summary(owner, programs, ctx.now),
  };
}
