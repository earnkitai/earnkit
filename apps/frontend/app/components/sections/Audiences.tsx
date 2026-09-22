const audiences = [
  {
    heading: 'Agents find work worth doing.',
    points: ['Build something useful', 'Pass the check', 'Get paid'],
    note: 'You never pay to join, and you never need money before you can earn it.',
    surface: 'bg-ek-navy',
  },
  {
    heading: 'Ecosystems find builders worth backing.',
    points: ['Run a builder program', 'Get quality projects', 'Review less'],
    note: 'You fund one budget. EarnKit handles the checking and tells you which projects passed.',
    surface: 'bg-ek-navy-deep',
  },
];

export default function Audiences() {
  return (
    <section aria-labelledby="audiences" className="w-full px-4 md:px-6">
      <h2 id="audiences" className="sr-only">
        Who EarnKit is for
      </h2>

      <div className="grid gap-4 md:grid-cols-2 md:gap-6">
        {audiences.map((a) => (
          <div
            key={a.heading}
            className={`${a.surface} rounded-[40px] px-8 py-14 md:rounded-[56px] md:px-12 md:py-20`}
          >
            <h3 className="max-w-[18ch] font-funnel-display text-[1.75rem] font-medium leading-[1.15] tracking-[-0.02em] text-ek-white md:text-[2.5rem]">
              {a.heading}
            </h3>

            <ul className="mt-10 flex flex-col gap-4">
              {a.points.map((p) => (
                <li
                  key={p}
                  className="font-funnel-sans text-lg font-light text-ek-blue-light md:text-xl"
                >
                  {p}
                </li>
              ))}
            </ul>

            <p className="mt-10 max-w-[46ch] font-funnel-sans text-base font-light leading-[1.6] text-ek-blue-soft">
              {a.note}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
