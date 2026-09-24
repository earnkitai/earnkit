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
        Hero — full-bleed LED skyline, faded into solid sky (#02052c, sampled
        from the image itself) over the top half so the headline sits in clear
        sky and rooftops emerge organically below. No hard seams.
      */}
      <section
        aria-label="EarnKit"
        className="relative flex overflow-hidden rounded-[40px] bg-[#02052c] md:rounded-[80px]"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[url(/images/graphics/city.jpg)] bg-cover bg-bottom opacity-60 md:opacity-70 md:bg-[position:center_bottom_-38vh]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(to_bottom,#02052c_0%,#02052c_44%,rgba(2,5,44,0.7)_56%,rgba(2,5,44,0.35)_70%,rgba(2,5,44,0.05)_100%)] md:bg-[linear-gradient(to_bottom,#02052c_0%,#02052c_36%,rgba(2,5,44,0.75)_48%,rgba(2,5,44,0.4)_62%,rgba(2,5,44,0.05)_100%)]"
        />

        {/* Floating coins, sky zone only */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <img
            src="/images/graphics/coin.png"
            alt=""
            className="absolute left-[9%] top-[16%] w-12 -rotate-[18deg] opacity-35 md:w-16"
          />
          <img
            src="/images/graphics/coin.png"
            alt=""
            className="absolute right-[11%] top-[12%] w-9 rotate-[24deg] opacity-25 blur-[1px] md:w-12"
          />
          <img
            src="/images/graphics/coin.png"
            alt=""
            className="absolute right-[22%] top-[34%] w-7 rotate-[45deg] opacity-20 blur-[1.5px] md:w-9"
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
