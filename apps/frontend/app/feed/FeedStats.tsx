import type { FeedWeekStats } from '../../lib/earnkit/site-data';
import { FEED_STATS, compactCount } from '../../lib/earnkit/site-copy';

/** The four cards' fills (Feed board, 160deg): blue, step, rust, green; each with its label colour. */
const CARDS: { key: keyof FeedWeekStats; label: string; fill: string; sub: string }[] = [
  { key: 'builders', label: FEED_STATS.builders, fill: 'bg-[linear-gradient(160deg,var(--ek-s-blue-top)_0%,var(--ek-s-blue-bottom)_100%)]', sub: 'text-s-on-navy-soft' },
  { key: 'commits', label: FEED_STATS.commits, fill: 'bg-[linear-gradient(160deg,var(--ek-s-step-top)_0%,var(--ek-s-step-bottom)_100%)]', sub: 'text-s-muted' },
  { key: 'went_live', label: FEED_STATS.live, fill: 'bg-[linear-gradient(160deg,var(--ek-s-rust-top)_0%,var(--ek-s-rust-bottom)_100%)]', sub: 'text-s-rust-sub' },
  { key: 'applications', label: FEED_STATS.applications, fill: 'bg-[linear-gradient(160deg,var(--ek-s-green-top)_0%,var(--ek-s-green-bottom)_100%)]', sub: 'text-s-green-sub' },
];

/** Commits compact ("1.2K"); the counts in full ("1,024"); 0 is "0". Pure. */
const shown = (key: keyof FeedWeekStats, n: number): string => (key === 'commits' ? compactCount(n) : n.toLocaleString('en-US'));

/**
 * v3.1 site Task 9 (Feed board): the selected week's four numbers (site-data.ts feedWeekStats, plan W5): builders
 * shipped, commits, went live, applications sent. The label above, the number in Kaftan Serif below. Two a row on a
 * phone, one row of four from md.
 */
export default function FeedStats({ stats, label }: { stats: FeedWeekStats; label: string }) {
  return (
    <section aria-label={label} className="grid grid-cols-2 gap-4 md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
      {CARDS.map((c) => (
        <div key={c.key} data-ek-stat={c.key} className={`flex min-h-[150px] flex-col justify-between gap-3.5 rounded-[32px] p-5 text-s-text md:p-[26px] ${c.fill}`}>
          <span className={`text-sm [overflow-wrap:anywhere] ${c.sub}`}>{c.label}</span>
          <span className="ek-serif text-[48px] leading-[0.9] tabular-nums md:text-[64px]">{shown(c.key, stats[c.key])}</span>
        </div>
      ))}
    </section>
  );
}
