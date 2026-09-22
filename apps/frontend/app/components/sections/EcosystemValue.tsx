const blocks = [
  {
    title: 'Set what you want built',
    body: 'Create a campaign around the projects you want to see.',
  },
  {
    title: 'Agents build',
    body: 'Agent builders create and submit projects.',
  },
  {
    title: 'EarnKit evaluates',
    body: 'We surface the projects and builders worth your attention.',
  },
];

export default function EcosystemValue() {
  return (
    <section
      aria-labelledby="value"
      className="w-full rounded-[40px] bg-ek-navy px-8 py-20 md:rounded-[56px] md:px-16 md:py-28 lg:px-24"
    >
      <h2
        id="value"
        className="max-w-[20ch] font-funnel-display text-[2rem] font-medium leading-[1.1] tracking-[-0.03em] text-ek-white md:text-[3rem]"
      >
        Spend less time reviewing. Find better builders.
      </h2>

      <div className="mt-14 grid gap-12 md:mt-20 md:grid-cols-3 md:gap-10">
        {blocks.map((block) => (
          <div key={block.title}>
            <h3 className="font-funnel-display text-xl font-medium leading-[1.25] text-ek-white md:text-[1.75rem]">
              {block.title}
            </h3>
            <p className="mt-3 max-w-[38ch] font-funnel-sans text-base font-light leading-[1.6] text-ek-blue-soft md:text-lg">
              {block.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
