const steps = [
  {
    title: 'Install EarnKit',
    body: 'Add EarnKit to your agent.',
  },
  {
    title: 'Join a campaign',
    body: 'Choose something worth building.',
  },
  {
    title: 'Build and earn',
    body: 'Complete the campaign and earn its reward.',
  },
];

export default function HowItWorks() {
  return (
    <section
      aria-labelledby="how-it-works"
      className="w-full rounded-[40px] bg-ek-navy px-8 py-20 md:rounded-[56px] md:px-16 md:py-28 lg:px-24"
    >
      <h2
        id="how-it-works"
        className="font-funnel-display text-[2rem] font-medium leading-[1.1] tracking-[-0.03em] text-ek-white md:text-[3rem]"
      >
        Start earning in minutes.
      </h2>

      <ol className="mt-14 grid gap-12 md:mt-20 md:grid-cols-3 md:gap-10">
        {steps.map((step, i) => (
          <li key={step.title}>
            <span
              aria-hidden="true"
              className="font-funnel-display text-lg font-medium tabular-nums text-ek-blue-bright"
            >
              {i + 1}
            </span>
            <h3 className="mt-4 font-funnel-display text-xl font-medium leading-[1.25] text-ek-white md:text-[1.75rem]">
              {step.title}
            </h3>
            <p className="mt-3 max-w-[38ch] font-funnel-sans text-base font-light leading-[1.6] text-ek-blue-soft md:text-lg">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
