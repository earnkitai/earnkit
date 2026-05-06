import Image from 'next/image';
// import Link from "next/link";
// import { SocialButton } from "@/app/components/ui/SocialButton";
import Link from 'next/link';
import BackgroundVideoLandingPage from './components/sections/BackgroundVideoLandingPage';
import CarouselFeatures from './components/sections/CarouselFeatures';
import UserTabsSection from './components/sections/UserTabsSection';
import { Icons } from '@/app/components/ui/Icons';
import AnimatedHeroText from './components/sections/AnimatedHeroText';
import AnimatedGridImage from './components/sections/AnimatedGridImage';
import ParallaxBuildingImage from './components/sections/ParallaxBuildingImage';
import ParallaxOctoImage from './components/sections/ParallaxOctoImage';
// import DesktopOnlyMessage from "./components/sections/DesktopOnlyMessage";
import Footer from './components/common/Footer';
import IntegrateInMinutesSection from './components/sections/IntegrateInMinutesSection';
import WarningMsg from './components/common/WarningMsg';
import YoutubeEmbed from './components/sections/YoutubeEmbed';
import BuybackDedicatedSection from './components/sections/BuybackDedicatedSection';
import { InvestorsIcons } from './components/ui/TeamIcons';
import InvestorLogoStrip from './components/sections/InvestorLogoStrip';

export default function Home() {
  return (
    <>
      <main className="md:h-screen md:min-h-screen">
        {/* <DesktopOnlyMessage /> */}
        <div className="w-full">
          {/* Hero Section */}
          <section
            aria-label="Hero"
            className=" relative flex flex-col lg:flex-row overflow-hidden rounded-[56px] md:rounded-[15rem]"
          >
            <BackgroundVideoLandingPage />
            <article className="w-full h-[90vh] md:h-[calc(var(--vh,1vh)*100-12vh)] p-4 pb-20 pt-4 lg:py-30 lg:p-8 lg:py-20 flex flex-col items-center md:justify-center justify-end rounded-[56px]">
              {/* <WarningMsg /> */}
              <AnimatedHeroText />
            </article>
          </section>

          {/* <section className="w-full md:h-screen flex flex-col md:flex-row items-center justify-center mt-10">
            <aside className="w-full h-[90vh] md:h-full md:w-1/2 relative rounded-[56px] overflow-hidden flex flex-col items-center justify-center bg-color9 gap-[40px]"
            >
              <div
                className="absolute top-0 left-0 w-full h-full bg-[url('/images/landing/grid.png')] bg-repeat mix-blend-luminosity opacity-30 bg-grid"
              ></div>
              <div className="w-full px-14 md:px-28 flex flex-col gap-[20px] z-10">
                <h2 className="font-funnel-display font-semibold text-[2.3rem] md:text-[3rem] leading-[1.2] text-color10 global-text-shadow ">
                  Fee Infrastructure for Every Agent
                </h2>
                <div className="w-[90%] md:w-[80%] mt-4 text-color11 font-funnel-sans text-xl lg:text-[1.2rem] 2xl:text-[3dvh] font-normal leading-[1.4] flex flex-col gap-[20px] font-light">
                  <p>
                    You built the agent. We&apos;ll help you earn from it.
                  </p>
                  <p>
                    EarnKit gives developers a simple SDK to monetize AI agents with just a few lines of code.
                  </p>
                </div>
              </div>
            </aside>
            <AnimatedGridImage />
          </section> */}

          {/* Carousel Section */}
          <CarouselFeatures />

          <YoutubeEmbed />

          {/* <section className="w-full h-[90vh] md:h-[530px] md:min-h-[530px] bg-color15 flex flex-col md:flex-row items-center justify-center md:justify-between rounded-[56px] md:rounded-[15rem] px-6 md:px-[10rem] ">

            <div className="md:max-w-max w-full max-w-[80%] py-10 md:py-0">
              <h2 className="text-color10 global-text-shadow font-funnel-display text-[2.2rem] md:text-5xl font-semibold text-left leading-[1.4] md:leading-[1.2]">
                Automatic, trustless
              </h2>
              <h2 className="text-color10 global-text-shadow font-funnel-display text-[2.2rem] md:text-5xl font-semibold text-left leading-[1.4] md:leading-[1.2]">
                revenue—made dead easy.
              </h2>
            </div>

            <div className="w-[100%] aspect-square md:w-[60%] lg:max-w-[450px] h-[50%] md:h-[90%] relative">
              <Image
                src="/images/landing/section04.png"
                alt="grid image"
                fill
                className="" />

            </div>
          </section> */}

          {/* <BuybackDedicatedSection /> */}

          <IntegrateInMinutesSection />

          {/* <section className="w-full md:min-h-[600px] flex flex-col md:flex-row items-center justify-center mt-10 relative"> */}
          {/* create a container with full height of the right side section and add a background image to it */}
          {/* <aside className="absolute top-0 left-0 w-full md:w-[35%] h-[90vh] md:h-full rounded-[56px] overflow-hidden bg-color5">
              <ParallaxBuildingImage />
            </aside>

            <aside className="ml-0 mt-[90vh] md:mt-0 md:ml-[35%] w-full md:w-[65%] bg-color3 rounded-[56px] flex flex-col items-start justify-center gap-10 p-12 md:p-24">
              <div className="w-[90%] md:w-full text-color8 font-funnel-display text-4xl md:text-5xl font-semibold text-left leading-[1.2]">
                <h2>
                  Built for those
                </h2>
                <h2>
                  who build agents.
                </h2>
              </div>

              <UserTabsSection />
            </aside> */}

          {/* </section> */}

          {/* video section */}
          {/* <section className="w-full min-h-[90vh] md:min-h-[900px] bg-color13 mt-8 flex flex-col items-center justify-center py-20 px-4 md:px-0 rounded-[56px] relative overflow-hidden">
            <aside className="w-full max-w-7xl py-4 px-8 md:px-14">
              <div className="flex w-full flex-col items-start justify-center z-10">
                <div className="mb-6">
                  <div className="flex flex-col items-start justify-center gap-6 pt-8">
                    <h2 className="text-color14 font-funnel-display text-5xl md:text-4xl font-semibold mb-4">Add Fees in Minutes.<br />See It Live.</h2>
                    <p className="text-color14 text-lg md:text-lg font-funnel-sans max-w-md leading-[1.4] tracking-[0.2]">
                      See how easy it is to start<br /> earning from your agent.
                    </p>
                  </div>
                </div>
              </div>
            </aside>
            <div className="flex items-center justify-center w-full max-w-7xl z-10 p-2 md:p-0">
              <div className="bg-white rounded-2xl md:rounded-[36px] shadow-xl w-full max-w-7xl flex items-center justify-center overflow-hidden">
                <video
                  src="https://res.cloudinary.com/coinvise/video/upload/v1747911422/ZORA_TRADER_NEW_mdrduy.mp4"
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </section> */}

          {/* <section className="w-full min-h-[700px] flex flex-col md:flex-row items-stretch justify-center bg-transparent rounded-[56px] overflow-hidden mt-10">
            <aside className="w-full h-[90vh] md:h-full md:w-[40%] bg-color5 flex flex-col justify-center items-center rounded-[56px] p-10 md:p-20">
              <div className="md:py-10 flex flex-col justify-center items-center">
                <h2 className="w-[90%] md:max-w-[70%] text-color8 text-center md:text-left font-funnel-display text-3xl md:text-5xl font-semibold mb-8 md:leading-[1.2]">
                  Monetize
                  <br className="hidden md:block" /> Your Agent,
                  <br className="hidden md:block" /> Your Way
                </h2>
                <div className="w-[90%] md:max-w-[70%] font-funnel-sans">
                  <p className="text-color6 text-lg text-center md:text-left mb-6">
                    Whether it&apos;s per prompt, per swap, or per LLM call,
                    EarnKit helps your agent earn without rebuilding the wheel.
                  </p>
                </div>
                <div className="pt-10 md:pt-20 w-[90%] md:max-w-[70%] font-funnel-display">
                  <p className="w-full text-color14 font-funnel-sans font-medium text-lg text-center md:text-left pb-10 leading-[1.4]">
                    The easiest way to earn is with EarnKit.
                  </p>
                  <Link
                    href="https://app.earnkit.com"
                    target="_blank"
                    className="inline-flex items-center w-full justify-center gap-2 px-6 md:px-10 py-4 md:py-6 outline outline-2 outline-color7 border border-transparent rounded-full text-color7 text-xl md:text-2xl font-funnel-sans font-medium group transition hover:border-color8 hover:outline-color8 hover:text-color8"
                  >
                    <Icons.sparkleIcon className="w-6 h-6 transition group-hover:text-color8 text-color7" />
                    Get Started
                  </Link>
                </div>
              </div>
            </aside>
            <aside className="w-full md:w-[60%] relative h-[400px] md:h-auto bg-color4 rounded-[56px] overflow-hidden">
              <ParallaxOctoImage />
            </aside>
          </section> */}

          <InvestorLogoStrip />
        </div>
        <Footer />
      </main>
    </>
  );
}
