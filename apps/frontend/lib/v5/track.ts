/**
 * The track tool: validates the input, writes the ledger, and answers with one line for the
 * builder, one for the agent, and the updated ledger.
 */
import { z } from 'zod';
import { ownerKey } from '../v6/builders';
import { getProgram, listOpenPrograms } from './programs';
import { record, summary, type Ledger, type Status } from './ledger';

export const TrackInput = z
  .object({
    program_id: z.string().min(1),
    status: z.enum(['applied', 'won', 'rejected', 'no_result', 'skipped', 'gap_done']),
    amount_usd: z.number().optional(),
    note: z.string().max(280).optional(),
    item: z.string().optional(),
  })
  .strict();

type Result = { show_to_builder: string; agent_note: string; ledger: Ledger };

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
  const res = await record(owner, i.program_id, i.status as Status, { installationId: ctx.installationId, amount_usd: i.amount_usd, note: i.note, item: i.item, now: ctx.now });
  if (!res.ok) return refuse(res.note);
  const title = (await getProgram(i.program_id))!.file.title;
  const lines: Record<Status, string> = {
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
