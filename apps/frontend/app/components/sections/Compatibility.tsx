import Image from 'next/image';

/**
 * Agent logos live in public/images/agents/<slug>.svg. Entries without a
 * logo yet render as a styled wordmark until the asset is exported from
 * the Figma AGENTS set (Graphics page, frame 663:1369).
 */
const agents: { name: string; logo?: string }[] = [
  { name: 'Muse' },
  { name: 'Grok Bot' },
  { name: 'Instinct' },
  { name: 'Hermes' },
  { name: 'OpenClaw', logo: '/images/agents/openclaw.svg' },
];

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

      <ul className="mt-10 flex flex-wrap items-center justify-center gap-x-12 gap-y-6 md:gap-x-16">
        {agents.map((agent) => (
          <li key={agent.name} className="flex items-center gap-3">
            {agent.logo && (
              <Image
                src={agent.logo}
                alt=""
                width={40}
                height={40}
                className="h-8 w-8 md:h-10 md:w-10"
              />
            )}
            <span className="font-funnel-display text-2xl font-semibold tracking-[-0.02em] text-ek-blue-light/70 md:text-3xl">
              {agent.name}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
