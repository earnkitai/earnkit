import Link from 'next/link';
import Footer from '../components/common/Footer';
import UpdateCard from '../components/ui/UpdateCard';
import { SURFACE } from '../[handle]/score-colors';
import type { FeedCard } from '../../lib/earnkit/feed';

export const FEED_TITLE = 'This week on the leaderboard';
export const FEED_LINE = 'The best updates from builders on the leaderboard, with the facts EarnKit checked.';
export const FEED_EMPTY = 'No updates yet. They show here every Monday.';

const COLUMN = 'mx-auto w-full max-w-4xl px-4 md:px-8';

/**
 * v2.13 spec "The feed": long cards by week, best first. profile-whoop v2: the premium dark page (the
 * page wraps it in data-ek-premium with the slim top bar): a calm title block, each week under a
 * small label, cards on the profile's surface (globals.css .ek-premium), a clear empty state. Pure.
 */
export default function FeedView({ weeks }: { weeks: { monday: string; label: string; cards: FeedCard[] }[] }) {
  return (
    <div className={`${COLUMN} pt-6 md:pt-10`}>
      <section aria-label="Feed">
        <h1 className="font-funnel-display text-[2rem] font-medium leading-[1.1] tracking-[-0.03em] text-[var(--ek-p-text)] sm:text-5xl md:text-[3.5rem] md:leading-[1.05]">
          {FEED_TITLE}
        </h1>
        <p className="mt-3 max-w-2xl font-funnel-sans text-base text-[var(--ek-p-muted)] md:mt-4 md:text-lg">{FEED_LINE}</p>
      </section>
      <section aria-label="Updates" className="mt-10 md:mt-14">
        {weeks.length === 0 ? (
          <div className={`flex flex-col items-start gap-3 px-6 py-10 md:px-10 md:py-14 ${SURFACE}`}>
            <p className="font-funnel-display text-xl font-medium text-[var(--ek-p-text)] md:text-2xl">{FEED_EMPTY}</p>
            <Link
              href="/leaderboard"
              className="inline-flex h-9 items-center rounded-full border border-[var(--ek-p-border-strong)] bg-[var(--ek-p-chip)] px-4 font-funnel-sans text-sm font-medium text-[var(--ek-p-text)] transition-colors hover:bg-[var(--ek-p-chip-hover)]"
            >
              See the leaderboard
            </Link>
          </div>
        ) : (
          weeks.map((w) => (
            <section key={w.monday} aria-label={w.label} className="mb-12 last:mb-0 md:mb-16">
              <div className="mb-5 flex items-center gap-4 md:mb-6">
                <h2 className="shrink-0 font-funnel-display text-lg font-medium tracking-[-0.01em] text-[var(--ek-p-text)] md:text-xl">{w.label}</h2>
                <span aria-hidden="true" className="h-px flex-1 bg-[var(--ek-p-hairline)]" />
              </div>
              <div className="flex flex-col gap-4 md:gap-5">
                {w.cards.map((c) => (
                  <UpdateCard key={c.id} card={c} shape="long" showWeek={false} />
                ))}
              </div>
            </section>
          ))
        )}
      </section>
      <Footer />
    </div>
  );
}
