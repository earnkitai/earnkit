import Link from 'next/link';
import Avatar from '../[handle]/Avatar';
import { streakCount } from '../[handle]/site/StreakCard';
import Serif from '../components/site/Serif';
import XHandle, { type XHandleTone } from '../components/site/XHandle';
import { METAL } from '../components/site/ui';
import type { BenchRow } from '../../lib/earnkit/bench-data';
import { pagePath } from '../../lib/earnkit/reserved-routes';

/** The three podium cards, first to third on the page (Leaderboard board): blue, navy, rust. */
const CARDS: { fill: string; sub: string; tone: XHandleTone }[] = [
  { fill: 'bg-s-blue text-s-on-blue', sub: 'text-s-on-blue-soft', tone: 'blue' },
  { fill: 'bg-s-navy text-s-text', sub: 'text-s-on-navy-soft', tone: 'navy' },
  { fill: 'bg-s-rust text-s-text', sub: 'text-s-rust-sub', tone: 'rust' },
];

/** The place pill's fill by the builder's whole-board rank: gold #1, silver #2, bronze #3, a plain pill after (a filtered view's "#5" is never silver). */
export function placeFill(rank: number): string {
  const metal: (keyof typeof METAL)[] = ['gold', 'silver', 'bronze'];
  return rank >= 1 && rank <= 3 ? METAL[metal[rank - 1]] : 'bg-s-inset22';
}

/**
 * v3.1 site Task 8: the first three builders of page 1 as cards. The place pill shows the builder's rank (always the
 * whole board's) in that rank's metal (placeFill), only while `ranked` (RANK_MIN_POOL ranked builders, plan S14). The card is one
 * link to the builder's page (the name's link stretched over it); the @handle above it is its own link to X.
 */
export default function Podium({ rows, ranked }: { rows: BenchRow[]; ranked: boolean }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="Top builders" className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
      {rows.slice(0, 3).map((r, i) => {
        const c = CARDS[i];
        return (
          <article
            key={r.handle}
            data-ek-podium={i + 1}
            className={`relative flex min-h-[260px] min-w-0 flex-col gap-[22px] rounded-[28px] p-7 md:rounded-[36px] ${c.fill}`}
          >
            <div className="flex min-h-[30px] items-center justify-between gap-3">
              {ranked ? (
                <span data-ek-place="" className={`inline-flex h-[30px] items-center rounded-full px-3.5 text-sm font-bold ${placeFill(r.rank)}`}>
                  #{r.rank}
                </span>
              ) : (
                <span />
              )}
              {r.streak > 0 && <span className={`text-[13px] ${c.sub}`}>{streakCount(r.streak)}</span>}
            </div>
            <div className="flex min-w-0 items-center gap-3.5">
              <Avatar src={r.avatar} handle={r.handle} className="h-14 w-14 text-xl" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <Link
                  href={pagePath(r.handle)}
                  className="ek-serif -my-[5px] inline-flex min-h-11 min-w-0 items-center text-[34px] leading-none [overflow-wrap:anywhere] md:my-0 md:min-h-0 after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2"
                >
                  {r.name}
                </Link>
                <p className={`flex min-w-0 flex-wrap items-center gap-x-1 text-[13px] ${c.sub}`}>
                  {/* 44px to the touch on a phone without moving the line (as the landing's Activity cards). */}
                  <XHandle handle={r.handle} tone={c.tone} className="relative z-10 -my-3 min-h-11 md:my-0 md:min-h-0" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">· {r.project}</span>
                </p>
              </div>
            </div>
            <div className="mt-auto flex items-baseline gap-2">
              <Serif size={56} className="tabular-nums leading-[0.9]">
                {r.points}
              </Serif>
              <span className={`text-sm ${c.sub}`}>Shipping</span>
            </div>
          </article>
        );
      })}
    </section>
  );
}
