import { Panel } from '../common/Panel';

/** v2.8 Part A: the section's title and its three steps. */
export const HOW_TITLE = 'How you earn';
export const STEPS = [
  { title: 'Add EarnKit', body: 'One link, free.' },
  { title: 'Ask “What can I earn?”', body: 'Your agent finds programs you qualify for.' },
  { title: 'Submit and earn', body: "Launch your entry's token to compete for the builder bonus." },
];

/**
 * v2.8 Part A: How you earn, a navy panel with a visible title and the three steps as cards. Step 3
 * (#how-you-earn-3) is the hero pill's target.
 */
export default function HowItWorks() {
  return (
    <Panel label={HOW_TITLE} className="py-12 md:py-16">
      <h2 id="how-it-works" className="font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">
        {HOW_TITLE}
      </h2>
      <ol className="mt-8 grid gap-4 md:mt-10 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            id={`how-you-earn-${i + 1}`}
            className="scroll-mt-4 rounded-[32px] bg-ek-navy px-7 py-8 md:px-8 md:py-10"
          >
            <p className="font-funnel-display text-4xl font-medium text-ek-blue-bright md:text-5xl">{i + 1}</p>
            <h3 className="mt-6 font-funnel-display text-xl font-medium leading-tight text-ek-white md:text-2xl">
              {step.title}
            </h3>
            <p className="mt-3 text-pretty font-funnel-sans text-base font-light leading-[1.5] text-ek-blue-light">{step.body}</p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
