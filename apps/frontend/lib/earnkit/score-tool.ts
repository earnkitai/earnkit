import { enqueueDiscovery } from './discovery';
import { prizeOf } from './entry-text';
import { noteEvent } from './events';
import { ensureProfile } from './profiles';
import { benchEnabled } from './builder-score-flag';
import { benchScore } from './bench-find';
import { listPrograms } from './programs';
import type { ReaderDeps } from './source-readers';
import type { ToolContext } from './tools';
import { hostFor, scoreEarn, standBase, startRefresh } from './stand-view';
import { openEntries } from './projects';
import { hiddenIds, hiddenPrograms, readMemory } from './builder-memory';
import type { Card, FreshOn } from './present';
import { EARN_NOTE, MOVE_UP_NOTE, chooseStep, placeBuild, whereYouStand, type MoveUp } from './stand-text';

/** v2.12.1 T8: the agent's note when the step asks for a link (find says the same). */
export const SEND_LINK_NOTE = 'When the builder sends a link to something they made, pass it to find in identity.projects (live_url or repo).';

/** The score tool's one line on an agent serving many builders (plan R2): nothing is read or written. */
export const SCORE_SHARED = 'Open EarnKit in your own coding agent to see your score.';

type Ctx = { installationId: number; ownInstallationId?: number; sharedClient?: boolean; freshDeps?: ToolContext['freshDeps']; tokenDeps?: ToolContext['tokenDeps']; proofBranchFetch?: ToolContext['proofBranchFetch'] };

/** v2.12.1 T8: the score tool's reply: where the person stands, one way to earn and the one step up. */
export type StandScoreReply = {
  show_to_builder: string;
  agent_note?: string;
  move_up?: { kind: MoveUp['kind']; project_key: string | null; agent_note: string };
  claim?: { link: string };
  lead?: { program_id: string };
  /** With a lead: prepare it with lead.program_id when the builder picks it (find's EARN_NOTE). */
  note?: string;
  build_offer?: { program_id: string; starter_id: string; can_build: boolean };
  /** v2.13 T8 (Bench flag): the person's rank lines (the Bench, then each chain) and the one project's streak. */
  rank_lines?: string[];
  streak?: number;
};

/**
 * v2.12.1 T8: the score tool. A shared client is never a person (plan R2): one plain line, nothing
 * read or written. Everyone else gets a profile (and a discovery run) on their first call, the
 * on-demand refresh within its budget, then the same view as find's: where they stand, one way to
 * earn (fix round 1: every reply; stand-view.ts scoreEarn, by find's rules without a GitHub read)
 * and the one step up (`hold`: the reply already asks something, a pending join, so the step
 * waits). One score_viewed event a minute (v2.12).
 */
export async function scoreReply(ctx: Ctx, now: Date, o: { hold?: boolean; reader?: ReaderDeps; fresh?: FreshOn } = {}): Promise<StandScoreReply> {
  const shared: StandScoreReply = { show_to_builder: SCORE_SHARED };
  if (ctx.sharedClient) return shared;
  // v2.13 T8: under the Bench flag, the same three parts as find's (bench-find.ts).
  if (benchEnabled()) return ((await benchScore(ctx, now, o)) as StandScoreReply | null) ?? shared;
  const id = ctx.installationId;
  const made = await ensureProfile(id, now);
  if (!made) return shared;
  if (made.created) await enqueueDiscovery(id, 'first_find');
  await startRefresh(id, { now, start: Date.now(), reader: o.reader }).within();
  const read = await standBase(id, { fresh: o.fresh });
  const base = read?.base ?? { standing: { ranked: false, rank: 0, total: 0 }, claimed: false, handle: null, claimLink: null, projects: [] };
  const [programs, entries, memory] = await Promise.all([
    listPrograms().catch(() => []),
    openEntries(id).catch(() => []),
    readMemory(id).catch(() => null),
  ]);
  const cards = (programs as (Card & { agent_completable?: boolean; earnkit_campaign?: boolean; starts_at: Date | null; opened_at: Date | null })[])
    .filter((p) => p.agent_completable !== false && !p.earnkit_campaign);
  const hidden = memory ? hiddenIds(hiddenPrograms(memory, cards.map((c) => ({ id: c.id, starts_at: c.starts_at, ends_at: c.ends_at ?? null, opened_at: c.opened_at })))) : new Set<string>();
  const entered = new Set(entries.map((e) => e.program_id));
  const money = await scoreEarn(id, { cards: cards.filter((c) => !hidden.has(c.id)), entered, hidden, now, projects: base.projects, fresh: o.fresh });
  const view0 = { ...base, earn: money.earn, fresh: null, money: money.money };
  const step0 = o.hold ? null : chooseStep(view0, { coin: () => false, build: null, host: hostFor(o.fresh?.canBuild ?? false) });
  const pick = money.pick ? { title: money.pick.card.title, prize: prizeOf(money.pick.card).split(' × ')[0], canBuild: money.pick.canBuild } : null;
  const { step, fresh } = placeBuild(pick, step0, Boolean(o.hold));
  const reply: StandScoreReply = { show_to_builder: whereYouStand({ ...view0, fresh, step, news: null }) };
  if (step && step.kind !== 'send_link' && step.kind !== 'build')
    reply.move_up = { kind: step.kind, project_key: step.project_key, agent_note: MOVE_UP_NOTE };
  if (step?.kind === 'send_link') reply.agent_note = SEND_LINK_NOTE;
  if (money.earn[0]) {
    reply.lead = { program_id: money.earn[0].program_id };
    reply.note = EARN_NOTE;
  }
  if (money.pick) reply.build_offer = { program_id: money.pick.card.id, starter_id: money.pick.starter.id, can_build: money.pick.canBuild };
  if (base.claimLink) reply.claim = { link: base.claimLink };
  await noteEvent('score_viewed', () => ({
    type: 'score_viewed',
    dedupe_key: `score_viewed:${id}:${Math.floor(now.getTime() / 60_000)}`,
    installation_id: id,
    detail: { rank: base.standing.ranked ? base.standing.rank : null, total: base.standing.total },
  }));
  return reply;
}
