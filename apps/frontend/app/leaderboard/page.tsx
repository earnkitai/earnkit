import { permanentRedirect } from 'next/navigation';

/** v2.14: the Bench is the board. /leaderboard is a permanent (308) redirect to /bench. */
export default function LeaderboardPage() {
  permanentRedirect('/bench');
}
