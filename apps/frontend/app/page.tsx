import BackgroundVideoLandingPage from './components/sections/BackgroundVideoLandingPage';
import Hero from './components/sections/Hero';
import HowItWorks from './components/sections/HowItWorks';
import Audiences from './components/sections/Audiences';
import QualityLayer from './components/sections/QualityLayer';
import Rewards from './components/sections/Rewards';
import FirstProgram from './components/sections/FirstProgram';
import WaitlistCta from './components/sections/WaitlistCta';
import InvestorLogoStrip from './components/sections/InvestorLogoStrip';
import Footer from './components/common/Footer';

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

      <HowItWorks />

      <Audiences />

      <QualityLayer />

      <div className="px-4 md:px-6">
        <Rewards />
      </div>

      <FirstProgram />

      <div className="px-4 md:px-6">
        <WaitlistCta />
      </div>

      <InvestorLogoStrip />

      <Footer />
    </div>
  );
}
