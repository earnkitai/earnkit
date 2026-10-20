import Hero from './components/sections/Hero';
import BackedBy from './components/sections/BackedBy';
import Footer from './components/common/Footer';
import { COLUMN } from './components/common/Panel';
import BenchTop from './components/sections/BenchTop';
import UpdateCarousel from './components/sections/UpdateCarousel';
import ProgramCards from './components/sections/ProgramCards';
import type { Landing } from '../lib/earnkit/landing';

/**
 * The homepage (R18: one idea per block): the hero (what EarnKit does, add it to your agent), the
 * leaderboard's top 10, what builders shipped this week (when there is any), the money open now,
 * backed by, the footer. `landing` is null when the read failed (Ruling 21 (plan)): the hero
 * renders without its stats line and the live parts are skipped.
 * It lives outside page.tsx because a page file may only export Next's own fields.
 */
export default function HomeView({ landing }: { landing: Landing | null }) {
  const bench = landing?.bench ?? null;
  return (
    <div className="w-full">
      <section aria-label="EarnKit" className="relative overflow-hidden">
        {/* The builder, dim and fading out at the edges, behind the headline. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center [mask-image:radial-gradient(closest-side,black_40%,transparent)]">
          <img src="/images/graphics/builder-blue.png?v=4" alt="" className="h-[90%] w-auto opacity-25" />
        </div>
        <div className={`${COLUMN} relative flex min-h-[70svh] flex-col items-center justify-center py-20 md:min-h-[80svh]`}>
          <Hero statsLine={landing?.stats_line ?? null} wonLine={landing?.won_line ?? null} />
        </div>
      </section>

      <div className={`${COLUMN} flex flex-col gap-16 md:gap-24`}>
        {bench && <BenchTop rows={bench.rows} count={bench.count} />}
        {bench && bench.cards.length > 0 && <UpdateCarousel cards={bench.cards} />}
        {landing && landing.tiles.length > 0 && <ProgramCards tiles={landing.tiles} figure={landing.open_text} bench />}
        <BackedBy />
      </div>

      <Footer />
    </div>
  );
}
