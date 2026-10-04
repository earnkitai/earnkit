/** What winner selection reads about an entry (projects row). */
export type Candidate = {
  id: number;
  score: number | null;
  submitted_at: Date;
  payout_wallet: string;
  installation_id: number | null;
  vetoed_at: Date | null;
  payout_status: string | null;
  prize_tx: string | null;
};

/** campaign_runs.state: the automatic lifecycle (v2.4 §3). */
export type RunState = 'running' | 'review' | 'paying' | 'paid';

/** Scored entries, best first: score, then the earlier entry (spec: ties go to it), then the id. Pure. */
export function rankEntries<T extends Candidate>(entries: T[]): T[] {
  return entries
    .filter((e) => e.score !== null)
    .sort(
      (a, b) =>
        b.score! - a.score! ||
        a.submitted_at.getTime() - b.submitted_at.getTime() ||
        a.id - b.id,
    );
}

/**
 * The winners in rank order (v2.4 §3): eligible (score >= minScore), not removed in review, payout
 * wallet not refused at payout, and one prize per payout wallet and per installation; a skipped
 * entry's slot goes to the next one. Pure; exported for tests.
 */
export function pickWinners<T extends Candidate>(entries: T[], winners: number, minScore: number) {
  const picked: T[] = [];
  const skipped: { id: number; reason: string }[] = [];
  const wallets = new Set<string>();
  const agents = new Set<number>();
  for (const e of rankEntries(entries)) {
    if (picked.length >= winners || e.score! < minScore) break;
    const wallet = e.payout_wallet.toLowerCase();
    const reason = e.vetoed_at
      ? 'removed in review'
      : e.payout_status === 'refused'
        ? "the payout wallet can't receive prizes"
        : wallets.has(wallet)
          ? 'one prize per payout wallet: another entry with this wallet is ahead'
          : e.installation_id !== null && agents.has(e.installation_id)
            ? "one prize per agent: this agent's other entry is ahead"
            : null;
    if (reason) {
      skipped.push({ id: e.id, reason });
      continue;
    }
    picked.push(e);
    wallets.add(wallet);
    if (e.installation_id !== null) agents.add(e.installation_id);
  }
  return { winners: picked, skipped };
}

/**
 * One entry's standing as builders read it (v2.4 §6 Standing). Unscored: "not scored yet" (no
 * rank). Running: "#3, in the top 5", "#7, 4 users behind #5", "#8, 6 users short of the 10
 * minimum", or "#4, <why it is skipped>". After the end: "winner" (paying, paid or paid out), "in
 * review", or "not in top 5". Pure; exported for tests.
 */
export function standingText(
  entry: Candidate,
  all: Candidate[],
  c: { winners: number; min_score: number },
  a: { state: RunState; ended: boolean },
) {
  if (entry.prize_tx) return 'winner';
  if (entry.score === null) return 'not scored yet';
  const picks = pickWinners(all, c.winners, c.min_score);
  const winner = picks.winners.some((w) => w.id === entry.id);
  if (a.ended || a.state !== 'running') {
    if (winner) return a.state === 'paying' || a.state === 'paid' ? 'winner' : 'in review';
    return `not in top ${c.winners}`;
  }
  const rank = rankEntries(all).findIndex((x) => x.id === entry.id) + 1;
  if (winner) return `#${rank}, in the top ${c.winners}`;
  const skipped = picks.skipped.find((s) => s.id === entry.id);
  if (skipped) return `#${rank}, ${skipped.reason}`;
  const short = c.min_score - entry.score;
  if (short > 0)
    return `#${rank}, ${short} user${short === 1 ? '' : 's'} short of the ${c.min_score} minimum`;
  const last = picks.winners.at(-1);
  if (!last || picks.winners.length < c.winners) return `#${rank}, in the top ${c.winners}`;
  const gap = last.score! - entry.score;
  return gap > 0
    ? `#${rank}, ${gap} user${gap === 1 ? '' : 's'} behind #${c.winners}`
    : `#${rank}, level with #${c.winners} (the earlier entry wins ties)`;
}
