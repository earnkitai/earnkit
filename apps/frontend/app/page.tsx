import Hero from './components/sections/Hero';
import {
  CoinFlat,
  CoinTiltRight,
  CoinTiltLeft,
} from './components/ui/CoinsField';
import Compatibility from './components/sections/Compatibility';
import Stats from './components/sections/Stats';
import HowItWorks from './components/sections/HowItWorks';
import BuilderBanner from './components/sections/BuilderBanner';
import FinalCta from './components/sections/FinalCta';
import Footer from './components/common/Footer';
import { INSTALL } from './lib/links';
import { NETWORK_STATS } from './lib/stats';

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

        {/* Vignette keeps the text zone clean */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,transparent_0%,rgba(2,5,44,0.25)_45%,rgba(2,5,44,0.55)_75%,rgba(2,5,44,0.8)_100%)]"
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

        <div className="relative flex min-h-[88vh] w-full flex-col items-center px-6 pt-[8vh] md:min-h-[calc(var(--vh,1vh)*100-12vh)] md:px-12 md:pt-[9vh]">
          <Hero />

          {/* Builder — centerpiece, sized by whatever space remains so he is
              never cropped and never collides with the CTA */}
          <div
            aria-hidden="true"
            className="relative mt-6 flex min-h-[34vh] w-full flex-1 items-end justify-center md:mt-10 md:min-h-[40vh]"
          >
            <img
              src="/images/graphics/builder-blue.png?v=4"
              alt=""
              className="h-full max-h-[52vh] w-auto object-contain object-bottom opacity-95 [filter:drop-shadow(0_0_36px_rgba(46,112,234,0.6))_drop-shadow(0_0_100px_rgba(46,112,234,0.35))]"
            />
          </div>
        </div>
      </section>

      {/*
        Stats figures are EXAMPLE values from the brief (app/lib/stats.ts) so
        the layout can be reviewed. Replace with real data or hide before ship.
      */}
      <Compatibility />

      <Stats stats={NETWORK_STATS} />

      <HowItWorks />

      <BuilderBanner />

      <FinalCta
        heading="Let your agent earn."
        ctaLabel="Install EarnKit"
        ctaHref={INSTALL}
        image={{ src: '/images/graphics/octo.jpg', alt: '' }}
      />

      <Footer />
    </div>
  );
}
