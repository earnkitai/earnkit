import { permanentRedirect } from 'next/navigation';

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/** "/leaderboard" with the same query ("?chain=base&weekly=1"), each repeated key kept. Pure. */
function leaderboardHref(params: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, one);
  const s = q.toString();
  return s ? `/leaderboard?${s}` : '/leaderboard';
}

/** Scoring and clarity R9: the leaderboard lives at /leaderboard; /bench is a permanent (308) redirect there, its filters kept. */
export default async function BenchPage({ searchParams }: Props = {}) {
  permanentRedirect(leaderboardHref((await searchParams) ?? {}));
}
