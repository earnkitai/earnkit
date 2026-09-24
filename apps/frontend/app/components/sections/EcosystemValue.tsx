import { TargetIcon, BoltIcon, EvaluateIcon } from '../ui/Icons';

const blocks = [
  {
    icon: TargetIcon,
    title: 'Set what you want built',
    body: 'Create a campaign around the projects you want to see.',
  },
  {
    icon: BoltIcon,
    title: 'Agents build',
    body: 'Agent builders create and submit projects.',
  },
  {
    icon: EvaluateIcon,
    title: 'EarnKit evaluates',
    body: 'We surface the projects and builders worth your attention.',
  },
];

/** Same orange card treatment as the landing page's how-it-works. */
export default function EcosystemValue() {
  return (
    <section aria-labelledby="value" className="w-full px-4 py-12 md:px-6">
      <div className="rounded-[40px] bg-ek-ember px-10 py-16 md:rounded-[56px] md:px-16 md:py-20">
        <h2
          id="value"
          className="max-w-[18ch] font-funnel-display text-[2rem] font-semibold leading-[1.2] text-ek-amber md:text-[3rem]"
        >
          Spend less time reviewing. Find better builders.
        </h2>
      </div>

      <div className="mt-4 grid gap-4 md:mt-6 md:grid-cols-3 md:gap-6">
        {blocks.map((block) => (
          <div
            key={block.title}
            className="rounded-[32px] bg-ek-card-brown p-10 md:p-12"
          >
            <block.icon className="h-16 w-16 text-ek-amber [filter:drop-shadow(0_0_14px_rgba(252,158,25,0.55))]" />
            <h3 className="mt-10 font-funnel-display text-2xl font-semibold leading-[1.25] text-ek-amber md:mt-14">
              {block.title}
            </h3>
            <p className="mt-4 font-funnel-sans text-base font-light leading-[1.6] text-ek-cream md:text-lg">
              {block.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
