import { benchScore } from './bench-find';
import type { BenchAskKind } from './bench-reply';
import type { ReaderDeps } from './source-readers';

/** The score tool's one line on an agent serving many builders (plan R2): nothing is read or written. */
export const SCORE_SHARED = 'Open EarnKit in your own coding agent to see your score.';

type Ctx = { installationId: number; ownInstallationId?: number; sharedClient?: boolean };

/** v2.12.1 T8: the score tool's reply: where the person stands, one way to earn and the one step up. */
export type StandScoreReply = {
  show_to_builder: string;
  agent_note?: string;
  move_up?: { kind: BenchAskKind; project_key: string | null; agent_note: string };
  lead?: { program_id: string };
  /** With a lead: prepare it with lead.program_id when the builder picks it (find's EARN_NOTE). */
  note?: string;
  /** v2.13 T8: the person's rank lines (the Bench, then each chain) and the one project's streak. */
  rank_lines?: string[];
  streak?: number;
  /** v4.3: `1 week shipping` / `n weeks shipping in a row`; absent at 0. */
  standing?: string;
};

/**
 * v2.12.1 T8: the score tool. A shared client is never a person (plan R2): one plain line, nothing
 * read or written. Everyone else gets the Bench's reply in one of the four states, as find's (bench-find.ts benchScore).
 */
export async function scoreReply(ctx: Ctx, now: Date, o: { reader?: ReaderDeps } = {}): Promise<StandScoreReply> {
  const shared: StandScoreReply = { show_to_builder: SCORE_SHARED };
  if (ctx.sharedClient) return shared;
  return ((await benchScore(ctx, now, o)) as StandScoreReply | null) ?? shared;
}
