import Image from 'next/image';
import Button from '../common/Button';

type Props = {
  heading: string;
  ctaLabel: string;
  ctaHref: string;
  image?: { src: string; alt: string };
};

/**
 * The closing split from the Figma landing: navy panel with heading + CTA on
 * the left, LED-matrix artwork on the right.
 */
export default function FinalCta({ heading, ctaLabel, ctaHref, image }: Props) {
  return (
    <section aria-labelledby="final-cta" className="w-full px-4 py-12 md:px-6">
      <div className="grid gap-4 md:grid-cols-2 md:gap-6">
        <div className="flex min-h-[420px] flex-col justify-between gap-14 rounded-[40px] bg-ek-navy-deep px-10 py-14 md:min-h-[560px] md:rounded-[56px] md:px-16 md:py-20">
          <h2
            id="final-cta"
            className="max-w-[12ch] font-funnel-display text-[2.25rem] font-semibold leading-[1.15] text-ek-white md:text-[3.5rem]"
          >
            {heading}
          </h2>

          <div>
            <Button href={ctaHref}>{ctaLabel}</Button>
          </div>
        </div>

        {image && (
          <div className="relative min-h-[320px] overflow-hidden rounded-[40px] bg-ek-navy-deep md:min-h-[560px] md:rounded-[56px]">
            <Image
              src={image.src}
              alt={image.alt}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 50vw"
            />
          </div>
        )}
      </div>
    </section>
  );
}
