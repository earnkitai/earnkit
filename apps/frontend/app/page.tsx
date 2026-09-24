import Hero from './components/sections/Hero';
import {
  CoinFlat,
  CoinTiltRight,
  CoinTiltLeft,
} from './components/ui/CoinsField';
import HowItWorks from './components/sections/HowItWorks';
import BuilderBanner from './components/sections/BuilderBanner';
import FinalCta from './components/sections/FinalCta';
import Footer from './components/common/Footer';
import { FOLLOW_X } from './lib/links';

export default function Home() {
  return (
    <div className="w-full">
      {/*
        Hero — the LED builder at his laptop, low in the frame, under a sky
        of drifting EarnKit-blue coins. Builder and coins are recolored LED
        assets from the Figma Graphics page; mesh + vignette carry the same
        sky treatment as the Figma hero.
      */}
      <section
        aria-label="EarnKit"
        className="relative flex overflow-hidden rounded-[40px] bg-[#02052c] md:rounded-[80px]"
      >
        {/* Fine LED mesh */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle,rgba(87,157,255,0.08)_1px,transparent_1.4px)] bg-[size:9px_9px]"
        />

        {/* Builder — dim backdrop behind the headline, like the Figma hero */}
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center"
        >
          <img
            src="/images/graphics/builder-blue.png?v=4"
            alt=""
            className="h-[52vh] w-auto translate-y-[6%] opacity-45 [filter:drop-shadow(0_0_36px_rgba(46,112,234,0.3))] md:h-[64vh]"
          />
        </div>

        {/* Text pocket + edge vignette keep the copy readable */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(ellipse_55%_38%_at_50%_36%,rgba(2,5,44,0.6)_0%,rgba(2,5,44,0.25)_55%,transparent_80%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,transparent_35%,rgba(2,5,44,0.5)_75%,rgba(2,5,44,0.85)_100%)]"
        />

        {/*
          The designer's three pixel coins — a few big, a couple small,
          placed around the center. Each drifts on its own phase.
        */}
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

        <div className="relative flex h-[88vh] w-full flex-col items-center justify-center px-6 md:h-[calc(var(--vh,1vh)*100-12vh)] md:px-12">
          <Hero />
        </div>
      </section>

      <HowItWorks />

      <BuilderBanner />

      <FinalCta
        heading="Let your agent earn."
        ctaLabel="Follow EarnKit on X"
        ctaHref={FOLLOW_X}
        image={{ src: '/images/graphics/octo.jpg', alt: '' }}
      />

      <Footer />
    </div>
  );
}
