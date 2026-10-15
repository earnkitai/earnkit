import { notFound, redirect } from 'next/navigation';
import { bonusBoard } from '@/lib/earnkit/bonus-board';
import { boardRedirect, boardStays, programOfRound, resolveRoundParam } from '@/lib/earnkit/bonus-rounds';
import { benchEnabled } from '@/lib/earnkit/builder-score-flag';
import BoardView from './BoardView';

export const dynamic = 'force-dynamic';
const METADATA = {
  title: 'Builder bonus · EarnKit',
  description: 'A builder bonus round: the pool, the ranking by real traction, and the payouts.',
};
/** v2.13 R16: the page is a 404 under the Bench flag, so its title never names the bonus. */
export function generateMetadata() {
  return benchEnabled() ? {} : METADATA;
}

/** The public builder bonus leaderboard of one round (v2.5 §4); 404 when it isn't a round. */
export default async function BonusRoundPage({ params }: { params: Promise<{ round: string }> }) {
  // v2.13 R16: no builder bonus under the Bench flag; its pages are a 404 (flag off: today's).
  if (benchEnabled()) notFound();
  // Ruling 12 (plan): the slug or the v2.5 ':' form; M1: a malformed escape is a 404, never a 500.
  const round = resolveRoundParam((await params).round);
  if (round === null) notFound();
  const board = await bonusBoard(round);
  if (!board) notFound();
  // v2.12 (D1, final review): a frozen, in-review, paying or paid round stays public; with the score
  // on, an open or empty round's board moves to the leaderboard (307: the flag can still go off).
  const target = boardRedirect({ program: programOfRound(round), stays: boardStays(board.state) });
  if (target) redirect(target);
  return <BoardView board={board} />;
}
