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

export default function InvestorLogoStrip() {
  return (
    <section
      aria-labelledby="backers"
      className="w-full px-6 py-20 md:px-16 md:py-24"
    >
      <h2
        id="backers"
        className="font-funnel-sans text-sm font-medium uppercase tracking-[0.18em] text-ek-blue-soft"
      >
        Backed by
      </h2>

      <ul className="mt-10 flex flex-wrap items-center gap-x-10 gap-y-8 md:mt-12 md:gap-x-16">
        {investorLogos.map((logo) => (
          <li
            key={logo.alt}
            className="relative h-7 w-24 shrink-0 md:h-9 md:w-32"
          >
            <Image
              src={logo.src}
              alt={logo.alt}
              fill
              className="object-contain object-left brightness-0 invert"
              sizes="(max-width: 768px) 96px, 128px"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
