import Footer from '../components/common/Footer';
import { Panel } from '../components/common/Panel';
import UpdateCard from '../components/ui/UpdateCard';
import type { FeedCard } from '../../lib/earnkit/feed';

export const FEED_TITLE = 'This week on the Bench';
export const FEED_LINE = 'The best updates from builders on the Bench, with the facts EarnKit checked.';
export const FEED_EMPTY = 'No updates yet. They show here every Monday.';

/** v2.13 spec "The feed": long cards by week, best first. Pure. */
export default function FeedView({ weeks }: { weeks: { monday: string; label: string; cards: FeedCard[] }[] }) {
  return (
    <div className="w-full pt-4">
      <Panel className="py-10 md:py-16" label="Feed">
        <h1 className="font-funnel-display text-[2.125rem] font-medium leading-[1.1] tracking-tight text-ek-white sm:text-5xl md:text-[4rem] md:leading-[1.05]">{FEED_TITLE}</h1>
        <p className="mt-4 max-w-2xl font-funnel-sans text-base font-light text-ek-blue-light md:text-lg">{FEED_LINE}</p>
      </Panel>
      <Panel className="mt-4 py-6 md:py-10" label="Updates">
        {weeks.length === 0 ? (
          <p className="py-6 font-funnel-sans text-base font-light text-ek-blue-light">{FEED_EMPTY}</p>
        ) : (
          weeks.map((w) => (
            <section key={w.monday} className="mb-8 last:mb-0">
              <h2 className="mb-4 font-funnel-display text-2xl font-medium text-ek-white">{w.label}</h2>
              <div className="flex flex-col gap-4">
                {w.cards.map((c) => (
                  <UpdateCard key={c.id} card={c} shape="long" />
                ))}
              </div>
            </section>
          ))
        )}
      </Panel>
      <Footer />
    </div>
  );
}
