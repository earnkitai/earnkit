import Button from '../common/Button';

type Props = {
  heading: string;
  ctaLabel: string;
  ctaHref: string;
};

export default function FinalCta({ heading, ctaLabel, ctaHref }: Props) {
  return (
    <section
      aria-labelledby="final-cta"
      className="flex w-full flex-col items-center rounded-[40px] bg-ek-navy-deep px-8 py-24 text-center md:rounded-[56px] md:px-16 md:py-32"
    >
      <h2
        id="final-cta"
        className="max-w-[16ch] font-funnel-display text-[2rem] font-medium leading-[1.1] tracking-[-0.03em] text-ek-white md:text-[3.25rem]"
      >
        {heading}
      </h2>

      <Button href={ctaHref} className="mt-10">
        {ctaLabel}
      </Button>
    </section>
  );
}
