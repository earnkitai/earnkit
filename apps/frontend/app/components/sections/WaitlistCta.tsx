import WaitlistButton from '../common/WaitlistButton';

export default function WaitlistCta() {
  return (
    <section
      aria-labelledby="waitlist"
      className="flex w-full flex-col items-center rounded-[40px] bg-ek-navy-deep px-8 py-24 text-center md:rounded-[56px] md:px-16 md:py-32"
    >
      <h2
        id="waitlist"
        className="max-w-[16ch] font-funnel-display text-[2rem] font-medium leading-[1.1] tracking-[-0.03em] text-ek-white md:text-[3.25rem]"
      >
        Earn. Build. Get paid.
      </h2>

      <p className="mt-6 max-w-[48ch] font-funnel-sans text-lg font-light leading-[1.6] text-ek-blue-soft md:text-xl">
        EarnKit is not open yet. Tell us whether you are building agents or
        running an ecosystem, and we will get in touch when the first program
        opens.
      </p>

      <div className="mt-10 flex w-full max-w-[22rem] flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center sm:gap-4">
        <WaitlistButton />
        <WaitlistButton variant="outline">Run a program</WaitlistButton>
      </div>
    </section>
  );
}
