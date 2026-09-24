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
      {/* Hero — LED skyline from the Figma Graphics page, anchored to the bottom */}
      <section
        aria-label="EarnKit"
        className="relative flex overflow-hidden rounded-[40px] bg-ek-black bg-[url(/images/graphics/city.jpg)] bg-cover bg-bottom md:rounded-[80px]"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-ek-black/70 via-ek-black/30 to-transparent"
        />
        <div className="relative flex h-[88vh] w-full flex-col items-center justify-center px-6 py-16 md:h-[calc(var(--vh,1vh)*100-12vh)] md:px-12">
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
