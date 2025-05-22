import Image from "next/image";
// import Link from "next/link";
// import { SocialButton } from "@/app/components/ui/SocialButton";
import Link from "next/link";
import BackgroundVideoLandingPage from "./components/sections/BackgroundVideoLandingPage";
import CarouselFeatures from "./components/sections/CarouselFeatures";
import UserTabsSection from "./components/sections/UserTabsSection";
import { Icons } from "@/app/components/ui/Icons";
import QuarterlyRolloutSection from "./components/sections/QuarterlyRolloutSection";
import AnimatedHeroText from "./components/sections/AnimatedHeroText";
import AnimatedGridImage from "./components/sections/AnimatedGridImage";
import ParallaxBuildingImage from "./components/sections/ParallaxBuildingImage";
import ParallaxOctoImage from "./components/sections/ParallaxOctoImage";
import DesktopOnlyMessage from "./components/sections/DesktopOnlyMessage";

export default function Home() {
  return (
    <main className="min-h-screen">
      <DesktopOnlyMessage />
      <div className="hidden md:block">
        {/* Hero Section */}
        <section aria-label="Hero" className="relative flex flex-col lg:flex-row overflow-hidden rounded-[15rem]">
          <BackgroundVideoLandingPage />
          <article className="w-full h-[100vh] md:min-h-[800px] p-4 pb-10 pt-4 lg:py-30 lg:p-8 lg:py-20 flex flex-col items-center justify-center rounded-[56px]">
            <AnimatedHeroText />
          </article>
        </section>

        <section className="w-full h-[100vh] md:min-h-[800px] flex items-center justify-center ">
          <aside className="w-full h-full md:w-1/2 relative rounded-[56px] overflow-hidden flex flex-col items-center justify-center bg-color9 gap-[40px]"
          >
            <div
              className="absolute top-0 left-0 w-full h-full bg-[url('/images/landing/grid.png')] bg-repeat mix-blend-luminosity opacity-30 bg-grid"
            ></div>
            <div className="w-full px-28 flex flex-col gap-[20px] z-10">
              <h2 className="font-funnel-display font-semibold text-[3rem] leading-[1.2] text-color10 global-text-shadow ">
                The Infrastructure That Makes Onchain Autonomy Real
              </h2>
              <div className="w-[70%] mt-4 text-color11 font-funnel-sans text-xl lg:text-[1.2rem] 2xl:text-[1.5dvh] font-normal leading-[1.4] flex flex-col gap-[20px]">
                <p>
                  Most agents can plan. Few can execute.
                </p>
                <p>
                  EarnKit makes AI agents capital-capable—from prompt to transaction, live onchain.
                </p>
              </div>
            </div>
          </aside>
          <AnimatedGridImage />
        </section>

        {/* Carousel Section */}
        <CarouselFeatures />

        <section className="w-full h-[530px] md:min-h-[530px] flex flex-col items-start justify-center rounded-[15rem] relative overflow-hidden px-[10rem]">

          <div className="absolute top-0 -left-[38%] w-[140%] h-[100%]">
            <Image
              src="/images/landing/section4.png"
              alt="grid image"
              fill
              className="" />

          </div>


          <div className="max-w-max z-20">
            <h2 className="text-color10 global-text-shadow font-funnel-display text-5xl font-semibold text-left leading-[1.2]">
              You design the strategy.

            </h2>
            <h2 className="text-color10 global-text-shadow font-funnel-display text-5xl font-semibold text-left leading-[1.2]">
              Your agent runs it.
            </h2>
          </div>
        </section>

        <section className="w-full min-h-[600px] flex items-center justify-center mt-10 relative">
          {/* create a container with full height of the right side section and add a background image to it */}
          <aside className="absolute top-0 left-0 w-[35%] h-full rounded-[56px] overflow-hidden">
            <ParallaxBuildingImage />
          </aside>

          <aside className="ml-[35%] w-[65%] bg-color3 rounded-[56px] flex flex-col items-start justify-center gap-10 p-24">
            <div className="text-color8 font-funnel-display text-5xl font-semibold text-left leading-[1.2]">
              <h2>
                Not for everyone.
              </h2>
              <h2>
                Built for the right users.
              </h2>
            </div>

            {/* tab section */}
            <UserTabsSection />
          </aside>

        </section>

        <section className="w-full min-h-[900px] bg-color13 mt-10 flex flex-col items-center justify-center py-20 px-4 md:px-0 rounded-[56px] relative overflow-hidden">
          <aside className="w-full max-w-7xl py-8">
            <div className="flex w-full flex-col items-start justify-center z-10 ">
              <div className="mb-6">
                <div className="mb-2">
                  {/* Earny logo from Icons */}
                  <span className="inline-block align-middle">
                    <Icons.earnyLogoPink className="w-36 h-16" />
                  </span>
                </div>
                <div className="flex items-start justify-center gap-12 pt-8">
                  <h2 className="text-color14 font-funnel-display text-3xl md:text-4xl font-semibold mb-4">See it in Action—No UI.<br />No Clicks. Just Action.</h2>
                  <p className="text-color14 text-lg md:text-lg font-funnel-sans max-w-md leading-[1.4] tracking-[0.2]">
                    In this short demo, an agent receives a user prompt, parses it, selects tools, and executes a multi-step strategy on Base—without a UI.
                  </p>
                </div>
              </div>
            </div>
          </aside>
          <div className="flex items-center justify-center w-full max-w-7xl z-10 p-4 md:p-0">
            <div className="bg-white rounded-3xl md:rounded-[36px] shadow-xl w-full max-w-7xl flex items-center justify-center overflow-hidden">
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
        </section>

        <QuarterlyRolloutSection />


        <section className="w-full min-h-[700px] flex flex-col md:flex-row items-stretch justify-center bg-transparent rounded-[56px] overflow-hidden mt-10">
          {/* Left Side */}
          <aside className="w-full md:w-[40%] bg-color5 flex flex-col justify-center items-center md:rounded-[56px] p-10 md:p-20">
            <div className="py-10 flex flex-col justify-center items-center">
              <h2 className="text-color8 font-funnel-display text-5xl font-semibold mb-8 leading-tight">
                Your Strategy.<br />
                Your Agent.<br />
                Your Edge.
              </h2>
              <div className="max-w-[70%] font-funnel-sans">
                <p className="text-color6 text-lg mb-6">
                  EarnKit turns your intent into execution<br />
                  —with no dashboards, no approvals, and no delay.
                </p>
                <p className="text-color6 text-lg mb-10">
                  This isn&apos;t just automation. It&apos;s programmable autonomy, live onchain.
                </p>
              </div>
              <div className="pt-40">
                <Link
                  href="#"
                  target="_blank"
                  className="inline-flex items-center w-full justify-center gap-2 px-10 py-6 outline outline-2 outline-color7 border border-transparent rounded-full text-color7 text-2xl font-funnel-sans font-medium group transition hover:border-color8 hover:outline-color8 hover:text-color8"
                >
                  <Icons.sparkleIcon className="w-6 h-6 transition group-hover:text-color8 text-color7" />
                  Join the Waitlist
                </Link>
              </div>
            </div>
          </aside>
          {/* Right Side */}
          <aside className="w-full md:w-[60%] relative h-[400px] md:h-auto bg-color4 rounded-[56px] overflow-hidden">
            <div className="hidden">
              <h1>hello</h1>
            </div>
            <ParallaxOctoImage />
          </aside>
        </section>
      </div>
    </main>
  );
}
