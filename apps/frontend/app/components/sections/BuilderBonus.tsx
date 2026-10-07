import Link from 'next/link';
import { Panel } from '../common/Panel';

/** v2.7.1: the builder bonus in three pills, one line each (the policy page has the rules). */
export const BONUS_PILLS = ['Top 10 on every program', 'Paid in ETH', 'Ranked on real users'];
/** v2.7.1: the figure while every open round's pool is empty (never "0 ETH"). */
export const BONUS_EMPTY = 'Starts with the first entry';

/**
 * v2.7.1: the homepage's builder bonus section (#builder-bonus, the hero pill's target), between
 * the open programs and how it works. `pools` is landing.ts bonusPoolsText ("0.60 ETH in pools so
 * far"), null while every pool is empty or the read failed.
 */
export default function BuilderBonus({ pools }: { pools: string | null }) {
  return (
    <Panel id="builder-bonus" label="Builder bonus" className="scroll-mt-4 py-12 md:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">Win twice.</h2>
        <Link
          href="/programs"
          className="inline-flex min-h-11 items-center px-2 font-funnel-sans text-base font-medium text-ek-blue-bright underline-offset-4 transition-colors hover:text-ek-white hover:underline"
        >
          Leaderboards
        </Link>
      </div>
      <p className="mt-6 font-funnel-display text-2xl font-medium text-ek-blue-bright md:text-4xl">{pools ?? BONUS_EMPTY}</p>
      <ul className="mt-6 flex flex-wrap gap-2 font-funnel-sans text-base text-ek-white md:mt-8 md:text-lg">
        {BONUS_PILLS.map((p) => (
          <li key={p} className="rounded-full bg-ek-navy px-5 py-2.5">
            {p}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
