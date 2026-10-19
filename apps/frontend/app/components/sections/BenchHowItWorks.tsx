import { Panel } from '../common/Panel';

export const BENCH_HOW_TITLE = 'How it works';
export const BENCH_STEPS = [
  'Add EarnKit to your agent and connect X.',
  'Your project goes on the leaderboard and your agent posts what you ship each week.',
  'Get funded: grants that fit, or a community round with your own coin.',
];
/** v2.13.1 O3: with EARNKIT_RAISING off, the steps don't mention raising. */
export const BENCH_STEPS_NO_RAISE = [...BENCH_STEPS.slice(0, 2), 'Get funded: grants that fit.'];

/** v2.13 spec "Landing page" 5: three steps, as HowItWorks lays them out, no step about a bonus. v2.13.1 O3: `raising` false drops raising. */
export default function BenchHowItWorks({ raising = true }: { raising?: boolean }) {
  const steps = raising ? BENCH_STEPS : BENCH_STEPS_NO_RAISE;
  return (
    <Panel label={BENCH_HOW_TITLE} className="py-12 md:py-16">
      <h2 className="font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">{BENCH_HOW_TITLE}</h2>
      <ol className="mt-8 grid gap-4 md:mt-10 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s} className="rounded-[32px] bg-ek-navy px-7 py-8 md:px-8 md:py-10">
            <p className="font-funnel-display text-4xl font-medium text-ek-blue-bright md:text-5xl">{i + 1}</p>
            <p className="mt-6 text-pretty font-funnel-display text-xl font-medium leading-tight text-ek-white md:text-2xl">{s}</p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
