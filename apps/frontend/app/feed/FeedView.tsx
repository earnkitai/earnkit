import Link from 'next/link';
import Footer from '../components/common/Footer';
import UpdateCard from '../components/ui/UpdateCard';
import { SURFACE } from '../[handle]/ScoreParts';
import { PART_COLORS, type PartLabel } from '../[handle]/score-colors';
import type { FeedCard } from '../../lib/earnkit/feed';

export const FEED_TITLE = 'This week on the Bench';
export const FEED_LINE = 'The best updates from builders on the Bench, with the facts EarnKit checked.';
export const FEED_EMPTY = 'No updates yet. They show here every Monday.';

const COLUMN = 'mx-auto w-full max-w-4xl px-4 md:px-8';

/** The four hues and what they mark: the key to the cards' accents. Decorative (the chips say it in words). */
function HueKey() {
  return (
    <ul aria-hidden="true" className="mt-5 flex flex-wrap gap-x-5 gap-y-2 font-funnel-sans text-xs text-[#9BA1AC] md:mt-6">
      {(Object.keys(PART_COLORS) as PartLabel[]).map((k) => (
        <li key={k} className="inline-flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundImage: `linear-gradient(135deg, ${PART_COLORS[k].to}, ${PART_COLORS[k].from})` }}
          />
          {k}
        </li>
      ))}
    </ul>
  );
}

/**
 * v2.13 spec "The feed": long cards by week, best first. profile-whoop v2: the premium dark page (the
 * page wraps it in data-ek-premium with the slim top bar): a calm title block, each week under a
 * small label, cards with their score-hue accents (globals.css .ek-premium), a clear empty state. Pure.
 */
export default function FeedView({ weeks }: { weeks: { monday: string; label: string; cards: FeedCard[] }[] }) {
  return (
    <div className={`${COLUMN} pt-6 md:pt-10`}>
      <section aria-label="Feed">
        <h1 className="font-funnel-display text-[2rem] font-medium leading-[1.1] tracking-[-0.03em] text-[#F5F6F8] sm:text-5xl md:text-[3.5rem] md:leading-[1.05]">
          {FEED_TITLE}
        </h1>
        <p className="mt-3 max-w-2xl font-funnel-sans text-base text-[#9BA1AC] md:mt-4 md:text-lg">{FEED_LINE}</p>
        <HueKey />
      </section>
      <section aria-label="Updates" className="mt-8 md:mt-10">
        {weeks.length === 0 ? (
          <div className={`flex flex-col items-start gap-3 px-6 py-10 md:px-10 md:py-14 ${SURFACE}`}>
            <p className="font-funnel-display text-xl font-medium text-[#F5F6F8] md:text-2xl">{FEED_EMPTY}</p>
            <Link
              href="/bench"
              className="inline-flex h-9 items-center rounded-full border border-white/10 bg-white/[0.04] px-4 font-funnel-sans text-sm font-medium text-[#F5F6F8] transition-colors hover:bg-white/[0.09]"
            >
              See the Bench
            </Link>
          </div>
        ) : (
          weeks.map((w) => (
            <section key={w.monday} aria-label={w.label} className="mb-10 last:mb-0">
              <div className="mb-4 flex items-center gap-4">
                <h2 className="shrink-0 font-funnel-display text-lg font-medium tracking-[-0.01em] text-[#F5F6F8] md:text-xl">{w.label}</h2>
                <span aria-hidden="true" className="h-px flex-1 bg-white/[0.06]" />
              </div>
              <div className="flex flex-col gap-3">
                {w.cards.map((c) => (
                  <UpdateCard key={c.id} card={c} shape="long" />
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
