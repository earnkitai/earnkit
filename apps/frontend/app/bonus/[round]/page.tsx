import { notFound } from 'next/navigation';
import { bonusBoard } from '@/lib/earnkit/bonus-board';
import { resolveRoundParam } from '@/lib/earnkit/bonus-rounds';
import BoardView from './BoardView';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Builder bonus · EarnKit',
  description: 'A builder bonus round: the pool, the ranking by real traction, and the payouts.',
};

/** The public builder bonus leaderboard of one round (v2.5 §4); 404 when it isn't a round. */
export default async function BonusRoundPage({ params }: { params: Promise<{ round: string }> }) {
  // Ruling 12 (plan): the slug or the v2.5 ':' form; M1: a malformed escape is a 404, never a 500.
  const round = resolveRoundParam((await params).round);
  if (round === null) notFound();
  const board = await bonusBoard(round);
  if (!board) notFound();
  return <BoardView board={board} />;
}
