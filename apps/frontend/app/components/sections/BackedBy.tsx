import Image from 'next/image';
import { H2 } from '../common/Panel';

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

/** v3 Stage 3 (spec 5.6): the title and the ten logos in one static wrapping row at 40%, white on black. No motion, no fade edges. */
export default function BackedBy() {
  return (
    <section aria-label="Backed by">
      <h2 className={H2}>Backed by</h2>
      <ul className="mt-6 flex flex-wrap items-center gap-x-10 gap-y-6 md:mt-8 md:gap-x-14">
        {investorLogos.map((logo) => (
          <li key={logo.alt} className="relative h-7 w-24 opacity-40 md:h-8 md:w-32">
            <Image src={logo.src} alt={logo.alt} fill className="object-contain object-left brightness-0 invert" sizes="(max-width: 768px) 96px, 128px" />
          </li>
        ))}
      </ul>
    </section>
  );
}
