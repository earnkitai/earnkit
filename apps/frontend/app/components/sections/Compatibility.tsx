const agents = ['Muse', 'Grok Bot', 'Instinct', 'Hermes', 'OpenClaw'];

export default function Compatibility() {
  return (
    <section
      aria-labelledby="compatibility"
      className="w-full px-6 py-24 md:px-16 md:py-28"
    >
      <h2
        id="compatibility"
        className="font-funnel-display text-[2rem] font-medium leading-[1.1] tracking-[-0.03em] text-ek-white md:text-[3rem]"
      >
        Works with your agent.
      </h2>

      <ul className="mt-10 flex flex-wrap gap-x-10 gap-y-5 md:mt-12 md:gap-x-14">
        {agents.map((name) => (
          <li
            key={name}
            className="font-funnel-display text-xl font-medium tracking-[-0.02em] text-ek-blue-soft md:text-2xl"
          >
            {name}
          </li>
        ))}
      </ul>
    </section>
  );
}
