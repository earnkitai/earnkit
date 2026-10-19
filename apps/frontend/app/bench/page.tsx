import { permanentRedirect } from 'next/navigation';

/** Scoring and clarity R9: the leaderboard lives at /leaderboard; /bench is a permanent (308) redirect there. */
export default function BenchPage() {
  permanentRedirect('/leaderboard');
}
