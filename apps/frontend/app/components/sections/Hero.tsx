import InstallButton from '../common/InstallButton';
import FeaturedCard from './FeaturedCard';
import { BTN_PRIMARY } from '../common/Button';
import { COLUMN, H1, LEDE } from '../common/Panel';
import type { FeaturedData } from './FeaturedCard';

/** v2.13 spec "Landing page" 1, R18, v3 Stage 3 (spec 5.6): the hero's words. Shipping and funding; no coin, no community round. */
export const BENCH_HERO_TITLE = 'Ship every week. Get funded.';
export const BENCH_HERO_SUBTITLE =
  'Add EarnKit to the agent you already use. It writes your weekly ship log from real commits, ranks you against every builder, and routes you to grants, accelerators and backers.';

/**
 * v3 Stage 3 (spec 5.8): a statement and one real artifact. The title, the one line under it and the one
 * primary action on the left; the featured builder's live profile preview (FeaturedCard, production data)
 * on the right from md, under the words on a phone. No video, no second button, no stats line.
 * Server-safe: the install button is the one client island.
 */
export default function Hero({ featured }: { featured: FeaturedData | null }) {
  return (
    <section aria-label="EarnKit" className={`${COLUMN} pb-14 pt-12 md:pb-24 md:pt-24`}>
      {/* Review round 1: with no card, the words take the whole column (no empty right half). */}
      <div className={featured ? 'grid gap-12 md:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] md:items-center lg:gap-20' : ''}>
        <div>
          <h1 className={`${H1} ${featured ? 'max-w-[16ch]' : ''}`}>{BENCH_HERO_TITLE}</h1>
          <p className={LEDE}>{BENCH_HERO_SUBTITLE}</p>
          <div className="mt-8 md:mt-10">
            <InstallButton className={BTN_PRIMARY} />
          </div>
        </div>
        {featured ? <FeaturedCard {...featured} /> : null}
      </div>
    </section>
  );
}
