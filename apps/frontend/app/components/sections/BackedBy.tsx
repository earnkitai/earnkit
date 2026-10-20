import Image from 'next/image';

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

/** v2.13: the label is sentence case (no all-caps labels). */
export default function BackedBy() {
  return (
    <section aria-label="Backed by" className="flex w-full flex-col items-center gap-8">
      <p className="font-funnel-sans text-sm text-ek-muted">
        Backed by
      </p>

      <div className="relative w-full overflow-hidden before:absolute before:left-0 before:top-0 before:z-10 before:h-full before:w-8 before:bg-gradient-to-r before:from-ek-page before:to-transparent after:absolute after:right-0 after:top-0 after:z-10 after:h-full after:w-8 after:bg-gradient-to-l after:from-ek-page after:to-transparent">
        <ul className="flex w-fit animate-marquee items-center gap-16 px-8 md:gap-24">
          {/* Doubled for the seamless loop; the copies are decorative */}
          {[...investorLogos, ...investorLogos].map((logo, index) => (
            <li
              key={`${logo.alt}-${index}`}
              className="relative h-8 w-28 flex-shrink-0 md:h-10 md:w-36"
              aria-hidden={index >= investorLogos.length || undefined}
            >
              <Image
                src={logo.src}
                alt={index < investorLogos.length ? logo.alt : ''}
                fill
                className="object-contain opacity-70 brightness-0 invert"
                sizes="(max-width: 768px) 112px, 144px"
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
