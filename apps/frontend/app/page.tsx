import Hero from './components/sections/Hero';
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

        {/* Builder — the centerpiece */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-[-10vh] flex justify-center md:bottom-[-18vh]"
        >
          <img
            src="/images/graphics/builder-blue.png"
            alt=""
            className="h-[46vh] w-auto opacity-95 [filter:drop-shadow(0_0_36px_rgba(46,112,234,0.6))_drop-shadow(0_0_100px_rgba(46,112,234,0.35))] md:h-[54vh]"
          />
        </div>

        {/* Vignette keeps the text zone clean */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,transparent_0%,rgba(2,5,44,0.25)_45%,rgba(2,5,44,0.55)_75%,rgba(2,5,44,0.8)_100%)]"
        />

        {/*
          Coin field around the builder — a few big, quiet coins at the far
          edges (tone-on-tone, blurred), smaller brighter ones close to him.
        */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {[
            ['left-[3%] top-[9%] w-24 opacity-[0.16] blur-[2px] md:w-40', '-22deg', '11s', '0s'],
            ['right-[5%] top-[15%] w-16 opacity-[0.22] blur-[1px] md:w-28', '26deg', '9.5s', '-3s'],
            ['left-[10%] top-[56%] w-12 opacity-[0.32] md:w-20', '10deg', '8s', '-5s'],
            ['right-[11%] top-[50%] w-10 opacity-[0.3] md:w-16', '-14deg', '8.5s', '-2s'],
            ['right-[24%] top-[7%] w-6 opacity-[0.22] blur-[1.5px] md:w-8', '52deg', '12s', '-6s'],
            ['left-[24%] top-[26%] w-7 opacity-[0.25] blur-[1px] md:w-10', '-38deg', '10s', '-1.5s'],
            ['left-[30%] top-[74%] w-8 opacity-[0.5] md:w-11', '18deg', '7s', '-4s'],
            ['right-[31%] top-[68%] w-9 opacity-[0.5] md:w-12', '-26deg', '7.5s', '-2.5s'],
          ].map(([cls, rot, dur, delay]) => (
            <img
              key={`${cls}${rot}`}
              src="/images/graphics/coin-blue.png"
              alt=""
              className={`coin-float absolute h-auto ${cls}`}
              style={{
                ['--coin-rot' as string]: rot,
                animationDuration: dur,
                animationDelay: delay,
              }}
            />
          ))}
        </div>

        <div className="relative flex h-[88vh] w-full flex-col items-center px-6 pt-[10vh] md:h-[calc(var(--vh,1vh)*100-12vh)] md:px-12 md:pt-[11vh]">
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
