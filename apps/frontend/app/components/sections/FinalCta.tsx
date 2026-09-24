import Button from '../common/Button';
import BackedBy from './BackedBy';

type Props = {
  heading: string;
  ctaLabel: string;
  ctaHref: string;
};

export default function FinalCta({ heading, ctaLabel, ctaHref }: Props) {
  return (
    <section
      aria-labelledby="final-cta"
      className="mt-10 flex w-full flex-col items-center overflow-hidden rounded-[56px] bg-ek-navy-deep bg-[url(/images/landing/FINAL_CTA.png)] bg-cover bg-top px-0 py-20 text-center"
    >
      <div className="mb-16 max-w-4xl px-6">
        <h2
          id="final-cta"
          className="font-funnel-display text-4xl font-bold text-ek-blue-light md:text-5xl"
        >
          {heading}
        </h2>

        <div className="mt-8 flex flex-row items-center justify-center">
          <Button href={ctaHref}>{ctaLabel}</Button>
        </div>
      </div>

      <div className="mt-8 w-full">
        <BackedBy />
      </div>
    </section>
  );
}
