import Image from 'next/image';

/**
 * The ember banner from the Figma landing: amber headline left, glowing
 * builder-at-laptop graphic right.
 */
export default function BuilderBanner() {
  return (
    <section
      aria-labelledby="builder-banner"
      className="w-full px-4 py-12 md:px-6"
    >
      <div className="flex flex-col items-center gap-10 overflow-hidden rounded-[40px] bg-ek-ember px-10 py-16 md:flex-row md:justify-between md:rounded-[15rem] md:px-24 md:py-10">
        <h2
          id="builder-banner"
          className="max-w-[16ch] text-center font-funnel-display text-[2rem] font-semibold leading-[1.2] text-ek-amber md:text-left md:text-[3rem]"
        >
          Build something useful. Get paid.
        </h2>

        <Image
          src="/images/graphics/builder.png"
          alt=""
          width={467}
          height={700}
          className="h-auto w-[260px] md:w-[320px]"
          sizes="(max-width: 768px) 260px, 320px"
        />
      </div>
    </section>
  );
}
