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
        Hero — headline in the open sky, LED skyline as a bottom band.
        #02052c is sampled from the skyline image's own sky so panel and
        image blend seamlessly.
      */}
      <section
        aria-label="EarnKit"
        className="relative flex overflow-hidden rounded-[40px] bg-[#02052c] md:rounded-[80px]"
      >
        {/* Skyline band */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[34%] bg-[url(/images/graphics/city.jpg)] bg-cover bg-bottom md:h-[46%]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-[24%] h-[18%] bg-gradient-to-b from-[#02052c] to-transparent md:bottom-[30%] md:h-[22%]"
        />

        {/* Floating coins in the sky */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <img
            src="/images/graphics/coin.png"
            alt=""
            className="absolute left-[8%] top-[14%] w-14 -rotate-[18deg] opacity-45 md:w-20"
          />
          <img
            src="/images/graphics/coin.png"
            alt=""
            className="absolute right-[10%] top-[10%] w-10 rotate-[24deg] opacity-30 blur-[1px] md:w-14"
          />
          <img
            src="/images/graphics/coin.png"
            alt=""
            className="absolute left-[16%] top-[58%] w-8 rotate-[40deg] opacity-25 blur-[1.5px] md:w-12"
          />
          <img
            src="/images/graphics/coin.png"
            alt=""
            className="absolute right-[14%] top-[52%] w-16 -rotate-[8deg] opacity-40 md:w-24"
          />
        </div>

        <div className="relative flex h-[88vh] w-full flex-col items-center px-6 pt-[16vh] md:h-[calc(var(--vh,1vh)*100-12vh)] md:px-12 md:pt-[14vh]">
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
