import { notFound } from 'next/navigation';
import { bonusBoard } from '@/lib/earnkit/bonus-board';
import BoardView from './BoardView';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Builder bonus · EarnKit',
  description: 'A builder bonus round: the pool, the ranking by real traction, and the payouts.',
};

/** The public builder bonus leaderboard of one round (v2.5 §4); 404 when it isn't a round. */
export default async function BonusRoundPage({ params }: { params: Promise<{ round: string }> }) {
  const board = await bonusBoard(decodeURIComponent((await params).round));
  if (!board) notFound();
  return <BoardView board={board} />;
}
