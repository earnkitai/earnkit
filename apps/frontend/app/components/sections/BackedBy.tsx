import Image from 'next/image';
import { H2 } from '../common/Panel';

/**
 * The ten marks with their files' pixel sizes and the height each is drawn at (md; phones scale by 0.85), so a
 * tall emblem (The LAO, IDEO) and a thin wordmark (Scalar, Cooper Turley) read at one visual weight.
 */
const investorLogos = [
  { src: '/images/investors/THE_LAO.png', alt: 'The LAO', w: 84, h: 73, height: 36 },
  { src: '/images/investors/VOLT_CAPITAL.png', alt: 'Volt Capital', w: 164, h: 38, height: 26 },
  { src: '/images/investors/GALAXY_DIGITAL.png', alt: 'Galaxy Digital', w: 140, h: 45, height: 28 },
  { src: '/images/investors/IDEO.png', alt: 'IDEO', w: 61, h: 75, height: 36 },
  { src: '/images/investors/ACAPITAL.png', alt: 'A Capital', w: 153, h: 29, height: 22 },
  { src: '/images/investors/SCALAR.png', alt: 'Scalar', w: 237, h: 18, height: 14 },
  { src: '/images/investors/gcr-logo-black.png', alt: 'GCR', w: 69, h: 25, height: 22 },
  { src: '/images/investors/DEFI_ALLIANCE.png', alt: 'Alliance', w: 129, h: 60, height: 34 },
  { src: '/images/investors/BLOCK0.png', alt: 'Block0', w: 94, h: 23, height: 20 },
  { src: '/images/investors/COOPER_TURLEY.png', alt: 'Cooper Turley', w: 215, h: 18, height: 14 },
];

/** v3 Stage 3 (spec 5.6), review round 1: the title and the ten logos in one static wrapping row at 60%, white on black, each sized by height. No motion, no fade edges. Lazy, as images below the fold. */
export default function BackedBy() {
  return (
    <section aria-label="Backed by">
      <h2 className={H2}>Backed by</h2>
      <ul className="mt-6 flex flex-wrap items-center gap-x-10 gap-y-7 opacity-60 md:mt-8 md:gap-x-14">
        {investorLogos.map((logo) => (
          <li key={logo.alt} className="flex items-center">
            <Image
              src={logo.src}
              alt={logo.alt}
              width={logo.w}
              height={logo.h}
              className="w-auto brightness-0 invert [height:calc(var(--h)*0.85)] md:[height:var(--h)]"
              style={{ '--h': `${logo.height}px` } as React.CSSProperties}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
