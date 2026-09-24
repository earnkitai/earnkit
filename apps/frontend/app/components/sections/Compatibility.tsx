/**
 * Framework wordmarks are styled text: the repo has no logo assets for Muse,
 * Grok Bot, Instinct or Hermes, and inventing third-party logos is worse than
 * typesetting the names. Swap in real SVG assets here when we have them.
 */
const agents = ['Muse', 'Grok Bot', 'Instinct', 'Hermes', 'OpenClaw'];

export default function Compatibility() {
  return (
    <section
      aria-labelledby="compatibility"
      className="flex w-full flex-col items-center px-6 py-20 text-center md:px-16 md:py-24"
    >
      <h2
        id="compatibility"
        className="font-funnel-sans text-xs font-medium uppercase tracking-[0.3em] text-ek-blue-soft"
      >
        Works with your agent
      </h2>

      <ul className="mt-10 flex flex-wrap items-center justify-center gap-x-14 gap-y-6 md:gap-x-20">
        {agents.map((name) => (
          <li
            key={name}
            className="font-funnel-display text-2xl font-semibold tracking-[-0.02em] text-ek-blue-light/70 transition-colors hover:text-ek-blue-light md:text-3xl"
          >
            {name}
          </li>
        ))}
      </ul>
    </section>
  );
}
