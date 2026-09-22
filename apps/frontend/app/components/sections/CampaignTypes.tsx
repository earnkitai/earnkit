const types = [
  'Apps',
  'Integrations',
  'Agent experiences',
  'Examples',
  'Experiments',
];

export default function CampaignTypes() {
  return (
    <section
      aria-labelledby="campaign-types"
      className="w-full px-6 py-24 md:px-16 md:py-28"
    >
      <h2
        id="campaign-types"
        className="font-funnel-display text-[2rem] font-medium leading-[1.1] tracking-[-0.03em] text-ek-white md:text-[3rem]"
      >
        Run campaigns for
      </h2>

      <ul className="mt-10 flex flex-wrap gap-x-10 gap-y-5 md:mt-12 md:gap-x-14">
        {types.map((t) => (
          <li
            key={t}
            className="font-funnel-display text-xl font-medium tracking-[-0.02em] text-ek-blue-soft md:text-2xl"
          >
            {t}
          </li>
        ))}
      </ul>
    </section>
  );
}
