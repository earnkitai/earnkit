import Link from 'next/link';
import { Panel } from '../common/Panel';

/**
 * v2.7.1: the builder bonus in three pills, one line each (the policy page has the rules). Review
 * #6: "on every program" only while every open program has the bonus.
 */
export const bonusPills = (every: boolean) => [every ? 'Top 10 on every program' : 'Top 10 per program', 'Paid in ETH', 'Ranked on real users'];
export const BONUS_PILLS = bonusPills(true);
/** v2.7.1: the figure while every open round's pool is empty (never "0 ETH"). */
export const BONUS_EMPTY = 'Pools start with the first entry';

/**
 * v2.7.1: the homepage's builder bonus section (#builder-bonus, the hero pill's target), between
 * the open programs and how it works. `pools` is landing.ts bonusPoolsText ("0.60 ETH in pools so
 * far"), null while every pool is empty. Review #2: `known` is false when the read failed, and
 * then no figure shows (never "Pools start…", which could be false).
 */
export default function BuilderBonus({ pools, known, every = true }: { pools: string | null; known: boolean; every?: boolean }) {
  return (
    <Panel id="builder-bonus" label="Builder bonus" className="scroll-mt-4 py-12 md:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">Win twice.</h2>
        <Link
          href="/programs"
          className="inline-flex min-h-11 items-center px-2 font-funnel-sans text-base font-medium text-ek-blue-bright underline-offset-4 transition-colors hover:text-ek-white hover:underline"
        >
          See programs
        </Link>
      </div>
      {known && (
        <p className="mt-6 font-funnel-display text-2xl font-medium text-ek-blue-bright md:text-4xl">{pools ?? BONUS_EMPTY}</p>
      )}
      <ul className="mt-6 flex flex-wrap gap-2 font-funnel-sans text-base text-ek-white md:mt-8 md:text-lg">
        {bonusPills(every).map((p) => (
          <li key={p} className="rounded-full bg-ek-navy px-5 py-2.5">
            {p}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
