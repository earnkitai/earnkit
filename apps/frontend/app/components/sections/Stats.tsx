/**
 * Live network stats.
 *
 * Nothing feeds these yet, so the section renders nothing until real values
 * are passed in. Deliberately not mounted on the page — wire it up when there
 * is a data source, and never hardcode figures here.
 */
export type NetworkStats = {
  agents?: number;
  projects?: number;
  rewardsPaidUsd?: number;
};

const format = (n: number) => new Intl.NumberFormat('en-US').format(n);

const formatUsd = (n: number) =>
  n >= 1000
    ? `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`
    : `$${format(n)}`;

export default function Stats({ stats }: { stats?: NetworkStats }) {
  if (!stats) return null;

  const items = [
    stats.agents !== undefined && {
      value: format(stats.agents),
      label: 'Agents using EarnKit',
    },
    stats.projects !== undefined && {
      value: format(stats.projects),
      label: 'Projects built',
    },
    stats.rewardsPaidUsd !== undefined && {
      value: formatUsd(stats.rewardsPaidUsd),
      label: 'Rewards paid',
    },
  ].filter(Boolean) as { value: string; label: string }[];

  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby="network-stats"
      className="w-full px-6 py-20 md:px-16 md:py-24"
    >
      <h2 id="network-stats" className="sr-only">
        EarnKit by the numbers
      </h2>

      <dl className="grid gap-14 text-center sm:grid-cols-3 sm:gap-10">
        {items.map((item) => (
          <div key={item.label}>
            <dd className="font-funnel-display text-[2.5rem] font-medium tabular-nums leading-none tracking-[-0.03em] text-ek-white md:text-[3.5rem]">
              {item.value}
            </dd>
            <dt className="mt-3 font-funnel-sans text-base font-light text-ek-blue-soft md:text-lg">
              {item.label}
            </dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
