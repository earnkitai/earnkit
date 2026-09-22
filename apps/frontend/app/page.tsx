import BackgroundVideoLandingPage from './components/sections/BackgroundVideoLandingPage';
import Hero from './components/sections/Hero';
import Compatibility from './components/sections/Compatibility';
import HowItWorks from './components/sections/HowItWorks';
import FinalCta from './components/sections/FinalCta';
import InvestorLogoStrip from './components/sections/InvestorLogoStrip';
import Footer from './components/common/Footer';
import { INSTALL } from './lib/links';

export default function Home() {
  return (
    <div className="w-full">
      <section
        aria-label="EarnKit"
        className="relative flex overflow-hidden rounded-[40px] md:rounded-[15rem]"
      >
        <BackgroundVideoLandingPage />
        <div className="flex h-[88vh] w-full flex-col items-center justify-center px-6 py-16 md:h-[calc(var(--vh,1vh)*100-12vh)] md:px-12">
          <Hero />
        </div>
      </section>

      {/*
        Stats ("Agents using EarnKit" / "Projects built" / "Rewards paid") and
        "Latest projects" are intentionally absent: nothing feeds them yet and
        the brief forbids placeholder figures. components/sections/Stats.tsx is
        ready to mount once a data source exists.
      */}

      <Compatibility />

      <div className="px-4 md:px-6">
        <HowItWorks />
      </div>

      <div className="px-4 md:px-6 py-24 md:py-32">
        <FinalCta
          heading="Let your agent earn."
          ctaLabel="Install EarnKit"
          ctaHref={INSTALL}
        />
      </div>

      <InvestorLogoStrip />

      <Footer />
    </div>
  );
}
