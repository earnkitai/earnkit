import Hero from './components/sections/Hero';
import { Mark as HeroMark } from './components/ui/Logo';
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
        Hero — the Figma hero: a giant LED-matrix EarnKit mark glowing behind
        the headline on a dark sky. The LED effect is the Mark SVG under a
        dot-grid mask; the glow is layered drop-shadows on the wrapper.
      */}
      <section
        aria-label="EarnKit"
        className="relative flex overflow-hidden rounded-[40px] bg-[#02052c] md:rounded-[80px]"
      >
        {/* Fine LED mesh over the whole sky */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle,rgba(87,157,255,0.08)_1px,transparent_1.4px)] bg-[size:9px_9px]"
        />

        {/* Glowing mark */}
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center"
        >
          <div className="relative -translate-y-[6%]">
            <div className="absolute left-1/2 top-1/2 h-[42rem] w-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(87,157,255,0.5)_0%,rgba(46,112,234,0.16)_45%,transparent_70%)]" />
            <div className="relative opacity-90 [filter:drop-shadow(0_0_22px_rgba(87,157,255,0.8))_drop-shadow(0_0_70px_rgba(46,112,234,0.6))]">
              <HeroMark className="h-auto w-[20rem] text-ek-blue-bright [mask-image:radial-gradient(circle,black_1.4px,transparent_1.7px)] [mask-size:7px_7px] [mask-repeat:repeat] md:w-[32rem]" />
            </div>
          </div>
        </div>

        {/* Vignette — melts the mark's edges into the sky */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle_at_50%_44%,transparent_0%,rgba(2,5,44,0.3)_42%,rgba(2,5,44,0.8)_62%,#02052c_82%)]"
        />

        {/* Faint corner coins */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <img
            src="/images/graphics/coin.png"
            alt=""
            className="absolute left-[8%] top-[18%] w-10 -rotate-[18deg] opacity-30 md:w-14"
          />
          <img
            src="/images/graphics/coin.png"
            alt=""
            className="absolute right-[9%] top-[64%] w-12 rotate-[22deg] opacity-25 blur-[1px] md:w-16"
          />
        </div>

        <div className="relative flex h-[88vh] w-full flex-col items-center px-6 pt-[15vh] md:h-[calc(var(--vh,1vh)*100-12vh)] md:px-12">
          <Hero />
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
