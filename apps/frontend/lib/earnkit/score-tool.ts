import { benchScore } from './bench-find';
import type { MoveUp } from './stand-text';
import type { ReaderDeps } from './source-readers';
import type { ToolContext } from './tools';
import type { FreshOn } from './present';

/** The score tool's one line on an agent serving many builders (plan R2): nothing is read or written. */
export const SCORE_SHARED = 'Open EarnKit in your own coding agent to see your score.';

type Ctx = { installationId: number; ownInstallationId?: number; sharedClient?: boolean; freshDeps?: ToolContext['freshDeps']; tokenDeps?: ToolContext['tokenDeps'] };

/** v2.12.1 T8: the score tool's reply: where the person stands, one way to earn and the one step up. */
export type StandScoreReply = {
  show_to_builder: string;
  agent_note?: string;
  move_up?: { kind: MoveUp['kind']; project_key: string | null; agent_note: string };
  claim?: { link: string };
  lead?: { program_id: string };
  /** With a lead: prepare it with lead.program_id when the builder picks it (find's EARN_NOTE). */
  note?: string;
  /** v2.13 T8: the person's rank lines (the Bench, then each chain) and the one project's streak. */
  rank_lines?: string[];
  streak?: number;
};

/**
 * v2.12.1 T8: the score tool. A shared client is never a person (plan R2): one plain line, nothing
 * read or written. Everyone else gets the Bench's three parts, as find's (bench-find.ts benchScore;
 * `hold`: the reply already asks something, a pending join, so the ask waits).
 */
export async function scoreReply(ctx: Ctx, now: Date, o: { hold?: boolean; reader?: ReaderDeps; fresh?: FreshOn } = {}): Promise<StandScoreReply> {
  const shared: StandScoreReply = { show_to_builder: SCORE_SHARED };
  if (ctx.sharedClient) return shared;
  return ((await benchScore(ctx, now, o)) as StandScoreReply | null) ?? shared;
}
