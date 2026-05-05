'use client';

import Image from 'next/image';
import Link from 'next/link';

export default function InvestorLogoStrip() {
  const investorLogos = [
    { src: '/images/investors/THE_LAO.png', alt: 'The LAO' },
    { src: '/images/investors/VOLT_CAPITAL.png', alt: 'Volt Capital' },
    { src: '/images/investors/GALAXY_DIGITAL.png', alt: 'Galaxy Digital' },
    { src: '/images/investors/IDEO.png', alt: 'IDEO' },
    { src: '/images/investors/ACAPITAL.png', alt: 'A Capital' },
    { src: '/images/investors/SCALAR.png', alt: 'Scalar' },
    { src: '/images/investors/gcr-logo-black.png', alt: 'GCR' },
    { src: '/images/investors/DEFI_ALLIANCE.png', alt: 'Alliance' },
    { src: '/images/investors/BLOCK0.png', alt: 'Block0' },
    { src: '/images/investors/COOPER_TURLEY.png', alt: 'Cooper Turley' },
  ];

  return (
    <section className="w-full min-h-[40vh] bg-color5 rounded-[56px] mt-10 flex flex-col items-center justify-center px-6 py-20 text-center overflow-hidden">
      {/* Final CTA Content */}
      <div className="max-w-3xl mb-16">
        <h2 className="text-color11 font-funnel-display text-4xl md:text-5xl font-bold">
          Tokens that buy back earn trust
        </h2>
        <p className="text-color11/80 font-funnel-sans text-lg md:text-xl mt-4">
          Projects that return value to holders last longer. Automated buybacks
          show your community the revenue is real and commitment is permanent.
          No manual buys. No trust-me promises. Just onchain execution, every
          time.
        </p>

        <div className="flex flex-row items-center justify-center gap-4 mt-8">
          <Link
            href="https://app.earnkit.com"
            className="inline-flex text-nowrap items-center w-full justify-center gap-2 px-6 md:px-10 py-2 md:py-6 outline outline-2 bg-color6 outline-color6 border border-color6 rounded-full text-color3 text-xl md:text-2xl font-funnel-sans font-medium group transition hover:bg-color7 hover:border-color7 hover:outline-color7 hover:text-color3"
            target="_blank"
          >
            Get Started
          </Link>
          <Link
            href="https://docs.earnkit.com"
            className="inline-flex text-nowrap items-center w-full justify-center gap-2 px-6 md:px-10 py-2 md:py-6 outline outline-2 outline-color7 border border-transparent rounded-full text-color7 text-xl md:text-2xl font-funnel-sans font-medium group transition hover:border-color8 hover:outline-color8 hover:text-color8"
            target="_blank"
          >
            Read the Docs
          </Link>
        </div>
      </div>

      {/* Quiet Logo Strip */}
      <div className="w-full flex flex-col items-center gap-10 mt-8">
        <p className="text-color11/40 font-funnel-sans text-xs uppercase tracking-[0.3em] font-medium">
          Backed by
        </p>

        {/* Marquee Container */}
        <div className="relative w-full overflow-hidden before:absolute before:left-0 before:top-0 before:z-10 before:h-full before:w-20 before:bg-gradient-to-r before:from-color5 before:to-transparent after:absolute after:right-0 after:top-0 after:z-10 after:h-full after:w-20 after:bg-gradient-to-l after:from-color5 after:to-transparent">
          <div className="flex w-fit animate-marquee items-center gap-16 md:gap-24 px-8">
            {/* Double the array to create the infinite loop effect */}
            {[...investorLogos, ...investorLogos].map((logo, index) => (
              <div
                key={index}
                className="relative h-8 md:h-10 w-28 md:w-36 flex-shrink-0 transition-all duration-300 opacity-100 brightness-0 invert hover:opacity-100 hover:filter-none"
              >
                <Image
                  src={logo.src}
                  alt={logo.alt}
                  fill
                  className="object-contain"
                  sizes="(max-width: 768px) 112px, 144px"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Required Animation Styles */}
      <style jsx global>{`
        @keyframes marquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        .animate-marquee {
          animation: marquee 30s linear infinite;
        }
        .animate-marquee:hover {
          animation-play-state: paused;
        }
      `}</style>
    </section>
  );
}
