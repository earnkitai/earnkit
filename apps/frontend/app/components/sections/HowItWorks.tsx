const steps = [
  { title: 'Add EarnKit', body: 'One link, any agent. Free, no account.' },
  { title: 'Ask “What can I earn?”', body: 'Your agent shows open money you qualify for.' },
  { title: 'Your agent builds and submits', body: 'Your entry gets a token and joins the builder bonus.' },
];

/** v2.7 §1: how it works, in 3 steps, as the homepage's navy panels (no images). */
export default function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works" className="w-full">
      <h2 id="how-it-works" className="sr-only">
        How it works
      </h2>
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className="rounded-[40px] bg-ek-navy-deep px-8 py-10 md:rounded-[56px] md:px-10 md:py-12">
            <p className="font-funnel-display text-4xl font-medium text-ek-blue-bright md:text-5xl">{i + 1}</p>
            <h3 className="mt-6 font-funnel-display text-xl font-medium leading-tight text-ek-white md:text-2xl">
              {step.title}
            </h3>
            <p className="mt-3 font-funnel-sans text-base font-light leading-[1.5] text-ek-blue-light">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
