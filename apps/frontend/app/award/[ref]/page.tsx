import { notFound } from 'next/navigation';
import { parseUnits } from 'viem';
import { awardTx, escrowEnabled } from '@/lib/earnkit/escrow';
import { formatDeadline } from '@/lib/earnkit/dates';
import { formatExact } from '@/lib/earnkit/format-units';
import { entryNames } from '@/lib/earnkit/leaderboard';
import { loadCampaign } from '@/lib/earnkit/sponsor';
import { splitUnits } from '@/lib/earnkit/sponsor-rules';
import AwardClient from './AwardClient';

export const dynamic = 'force-dynamic';

export default async function AwardPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  // No escrow configured on this deployment (sponsor campaigns not open yet): nothing to award.
  if (!escrowEnabled()) notFound();
  const row = /^0x[0-9a-f]{64}$/.test(ref)
    ? await loadCampaign(ref).catch(() => null)
    : null;
  if (!row || !row.award_plan || !row.escrow_address) notFound();
  // Computed once: the amount shown for each winner must be the exact amount signed, not a
  // separately-rounded display of the same decimal string (see format-units.ts).
  const amountsUnits = row.award_plan.map((p) =>
    parseUnits(p.amount, row.token_decimals),
  );
  const names = await entryNames(row.award_plan.map((p) => p.entry_id));
  // EarnKit's 10%, released to EarnKit by this same transaction.
  const { fee } = splitUnits(parseUnits(row.amount, row.token_decimals));
  const tx = awardTx(
    row.escrow_address as `0x${string}`,
    row.award_plan.map((p) => p.wallet),
    amountsUnits,
  );
  return (
    <div className="w-full pt-4">
      <section className="rounded-[40px] bg-ek-navy-deep px-6 py-12 md:rounded-[56px] md:px-16 md:py-16">
        <p className="font-funnel-sans text-xs font-medium uppercase tracking-[0.3em] text-ek-blue-soft">
          Award winners
        </p>
        <h1 className="mt-4 font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">
          {row.draft.title}
        </h1>
        <p className="mt-2 font-funnel-sans text-base text-ek-blue-light">
          Ended {formatDeadline(row.draft.ends_at)}
        </p>
        <ul className="mt-8 space-y-3 font-funnel-sans text-ek-blue-light">
          {row.award_plan.map((p, i) => (
            <li key={p.entry_id}>
              <span className="text-ek-white">
                {formatExact(amountsUnits[i], row.token_decimals)}{' '}
                {row.token_symbol}
              </span>{' '}
              to{' '}
              <span className="text-ek-white">
                {names.get(p.entry_id) ?? 'unknown project'}
              </span>{' '}
              (entry #{p.entry_id}, {p.wallet}): {p.reason}
            </li>
          ))}
        </ul>
        <p className="mt-4 font-funnel-sans text-ek-blue-light">
          EarnKit fee, released on payout:{' '}
          <span className="text-ek-white">
            {formatExact(fee, row.token_decimals)} {row.token_symbol}
          </span>
        </p>
        <p className="mt-6 font-funnel-sans text-sm font-light text-ek-blue-soft">
          Your wallet must be the one that funded this campaign (
          {row.sponsor_wallet}).
        </p>
        {row.state === 'live' ? (
          <AwardClient ref_={ref} tx={tx} />
        ) : (
          <p className="mt-8 text-ek-white">This campaign is {row.state}.</p>
        )}
      </section>
    </div>
  );
}
