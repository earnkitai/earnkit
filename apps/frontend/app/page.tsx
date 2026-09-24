import BackgroundVideoLandingPage from './components/sections/BackgroundVideoLandingPage';
import Hero from './components/sections/Hero';
import Compatibility from './components/sections/Compatibility';
import Stats from './components/sections/Stats';
import HowItWorks from './components/sections/HowItWorks';
import FinalCta from './components/sections/FinalCta';
import Footer from './components/common/Footer';
import { INSTALL } from './lib/links';
import { NETWORK_STATS } from './lib/stats';

export default function Home() {
  return (
    <div className="w-full">
      <section
        aria-label="EarnKit"
        className="relative flex overflow-hidden rounded-[40px] md:rounded-[15rem]"
      >
        <BackgroundVideoLandingPage />
        {/* Calms the video and keeps hero text readable over it */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-[5] bg-ek-black/45"
        />
        <div className="flex h-[88vh] w-full flex-col items-center justify-center px-6 py-16 md:h-[calc(var(--vh,1vh)*100-12vh)] md:px-12">
          <Hero />
        </div>
      </section>

      <Compatibility />

      <Stats stats={NETWORK_STATS} />

      <HowItWorks />

      <FinalCta
        heading="Let your agent earn."
        ctaLabel="Install EarnKit"
        ctaHref={INSTALL}
      />

      <Footer />
    </div>
  );
}
