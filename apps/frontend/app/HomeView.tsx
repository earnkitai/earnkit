import Hero from './components/sections/Hero';
import { CoinFlat, CoinTiltRight, CoinTiltLeft } from './components/ui/CoinsField';
import BackedBy from './components/sections/BackedBy';
import Footer from './components/common/Footer';
import HowItWorks from './components/sections/HowItWorks';
import ProgramCards from './components/sections/ProgramCards';
import StatsStrip from './components/sections/StatsStrip';
import { HOME_CARDS, HOME_CARDS_MOBILE, type Landing } from '../lib/earnkit/landing';
import { usd } from '../lib/earnkit/campaigns';

/**
 * The homepage (v2.7 §1), pure: hero with the live figure, the open programs (6, then "See all"),
 * the stats strip, how it works, backed by, the footer. `landing` is null when the read failed
 * (Ruling 21 (plan)): the hero renders without its figure, and the cards and the strip are skipped.
 * It lives outside page.tsx because a page file may only export Next's own fields.
 */
export default function HomeView({ landing }: { landing: Landing | null }) {
  return (
    <div className="w-full">
      <section
        aria-label="EarnKit"
        className="relative flex overflow-hidden rounded-[40px] bg-[#02052c] md:rounded-[80px]"
      >
        {/* Fine LED mesh */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle,rgba(87,157,255,0.08)_1px,transparent_1.4px)] bg-[size:9px_9px]"
        />

        {/* Builder - dim backdrop behind the headline */}
        <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
          <img
            src="/images/graphics/builder-blue.png?v=4"
            alt=""
            className="h-[52vh] w-auto translate-y-[6%] opacity-45 [filter:drop-shadow(0_0_36px_rgba(46,112,234,0.3))] md:h-[64vh]"
          />
        </div>

        {/* Text pocket + edge vignette */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(ellipse_55%_38%_at_50%_36%,rgba(2,5,44,0.6)_0%,rgba(2,5,44,0.25)_55%,transparent_80%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,transparent_35%,rgba(2,5,44,0.5)_75%,rgba(2,5,44,0.85)_100%)]"
        />

        {/* The designer's coins */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 text-ek-blue-bright">
          <div className="coin-float absolute left-[-12%] top-[6%] w-36 opacity-[0.25] md:left-[3%] md:top-[8%] md:w-64 md:opacity-[0.34]" style={{ animationDuration: '9s' }}>
            <CoinFlat className="h-auto w-full" />
          </div>
          <div className="coin-float absolute right-[-16%] top-[32%] w-40 opacity-[0.24] md:right-[2%] md:top-[30%] md:w-72 md:opacity-[0.3]" style={{ animationDuration: '11s', animationDelay: '-4s' }}>
            <CoinTiltRight className="h-auto w-full" />
          </div>
          <div className="coin-float absolute bottom-[2%] left-[-14%] w-36 opacity-[0.24] md:bottom-[6%] md:left-[6%] md:w-60 md:opacity-[0.28]" style={{ animationDuration: '10s', animationDelay: '-2s' }}>
            <CoinTiltLeft className="h-auto w-full" />
          </div>
          <div className="coin-float absolute right-[24%] top-[9%] hidden w-16 opacity-[0.2] blur-[1px] md:block md:w-24" style={{ animationDuration: '13s', animationDelay: '-6s' }}>
            <CoinTiltLeft className="h-auto w-full" />
          </div>
          <div className="coin-float absolute left-[22%] top-[48%] hidden w-14 opacity-[0.22] blur-[1px] md:block md:w-20" style={{ animationDuration: '12s', animationDelay: '-3s' }}>
            <CoinTiltRight className="h-auto w-full" />
          </div>
        </div>

        <div className="relative flex min-h-[88vh] w-full flex-col items-center justify-center px-6 py-16 md:min-h-[calc(var(--vh,1vh)*100-12vh)] md:px-12">
          <Hero openText={landing && landing.open_usd > 0 ? usd(landing.open_usd) : null} />
        </div>
      </section>

      {/* Sections stack 16px apart, as on every page; the footer brings its own top margin. */}
      <div className="flex flex-col gap-4 pt-4">
        {landing && landing.tiles.length > 0 && <ProgramCards tiles={landing.tiles} limit={HOME_CARDS} mobileLimit={HOME_CARDS_MOBILE} seeAll />}
        {landing && <StatsStrip items={landing.stats} />}
        <HowItWorks />
        <BackedBy />
      </div>

      <Footer />
    </div>
  );
}
