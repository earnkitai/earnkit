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
  const raw = (await params).round;
  // M1: a malformed escape (URIError) is a plain 404, never a 500.
  let round: string;
  try {
    round = decodeURIComponent(raw);
  } catch {
    notFound();
  }
  const board = await bonusBoard(round);
  if (!board) notFound();
  return <BoardView board={board} />;
}
