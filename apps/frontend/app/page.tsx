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

        {/* Builder */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 flex justify-center md:justify-end md:pr-[12%]"
        >
          <img
            src="/images/graphics/builder-blue.png"
            alt=""
            className="h-[38vh] w-auto opacity-95 [filter:drop-shadow(0_0_30px_rgba(46,112,234,0.55))] md:h-[46vh]"
          />
        </div>

        {/* Vignette keeps the text zone clean */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,transparent_0%,rgba(2,5,44,0.25)_45%,rgba(2,5,44,0.6)_72%,rgba(2,5,44,0.85)_100%)]"
        />

        {/* Coin field — sizes, blur and opacity fake depth; slow drift */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {[
            ['left-[6%] top-[12%] w-16 opacity-50', '-14deg', '7s', '0s'],
            ['left-[15%] top-[42%] w-9 opacity-30 blur-[1px]', '28deg', '9s', '-2s'],
            ['left-[9%] top-[68%] w-12 opacity-50', '8deg', '8s', '-4s'],
            ['left-[24%] top-[54%] w-10 opacity-35 blur-[0.5px]', '16deg', '8.5s', '-3.5s'],
            ['left-[26%] top-[16%] w-7 opacity-25 blur-[1.5px]', '45deg', '10s', '-1s'],
            ['right-[7%] top-[14%] w-12 opacity-45', '20deg', '7.5s', '-3s'],
            ['right-[18%] top-[34%] w-8 opacity-30 blur-[1px]', '-30deg', '9.5s', '-5s'],
            ['right-[28%] top-[8%] w-6 opacity-20 blur-[2px]', '60deg', '11s', '-2.5s'],
            ['right-[6%] top-[58%] w-20 opacity-55', '-6deg', '6.5s', '-1.5s'],
            ['left-[38%] top-[7%] w-8 opacity-25 blur-[1px]', '-40deg', '10.5s', '-6s'],
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
