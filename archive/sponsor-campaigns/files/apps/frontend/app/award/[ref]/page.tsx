import { notFound } from 'next/navigation';
import { parseUnits } from 'viem';
import { awardTx, escrowEnabled } from '@/lib/earnkit/escrow';
import { formatDeadline } from '@/lib/earnkit/dates';
import { formatExact } from '@/lib/earnkit/format-units';
import { entryNames } from '@/lib/earnkit/leaderboard';
import { checkChain, loadCampaign } from '@/lib/earnkit/sponsor';
import { splitUnits } from '@/lib/earnkit/sponsor-rules';
import { sponsorLabel } from '@/lib/earnkit/sponsor-identity';
import { AWARD_PROVENANCE, awardWarnings } from '@/lib/earnkit/sponsor-text';
import { sponsorIdentity } from '@/lib/earnkit/sponsor-verify';
import { SCREEN_UNAVAILABLE, planScreenProblem } from '@/lib/earnkit/sanctions';
import AwardClient from './AwardClient';

export const dynamic = 'force-dynamic';
// Pages anyone's agent can create: never in search results (v2.2 audit L2).
export const metadata = { robots: { index: false, follow: false } };

export default async function AwardPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  // No escrow configured on this deployment (sponsor campaigns not open yet): nothing to award.
  if (!escrowEnabled()) notFound();
  if (!/^0x[0-9a-f]{64}$/.test(ref)) notFound();
  const found = await loadCampaign(ref).catch(() => null);
  if (!found) notFound();
  // The award may already be onchain: record it before rendering.
  await checkChain(found).catch((err) =>
    console.error('[award] chain check failed:', err),
  );
  const row = await loadCampaign(ref);
  if (!row.award_plan || !row.escrow_address || !row.sponsor_wallet) notFound();
  const identity = await sponsorIdentity(row);
  // Computed once: the amount shown for each winner must be the exact amount signed, not a
  // separately-rounded display of the same decimal string (see format-units.ts).
  const amountsUnits = row.award_plan.map((p) =>
    parseUnits(p.amount, row.token_decimals),
  );
  const names = await entryNames(row.award_plan.map((p) => p.entry_id));
  const warnings = awardWarnings(row.award_plan, row.sponsor_wallet);
  // EarnKit's 10%, released to EarnKit by this same transaction.
  const { fee } = splitUnits(parseUnits(row.amount, row.token_decimals));
  // Screened again now: the screen at plan time may be days old (re-audit M7).
  const blocked =
    row.state === 'live'
      ? await planScreenProblem(row.award_plan, row.chain_id)
      : null;
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
          by &ldquo;{row.sponsor_name}&rdquo; · {sponsorLabel(identity)} · Ended{' '}
          {formatDeadline(row.draft.ends_at)}
        </p>
        <p className="mt-8 rounded-2xl border border-ek-blue-soft px-5 py-4 font-funnel-sans text-base font-medium text-ek-white">
          {AWARD_PROVENANCE}
        </p>
        <ul className="mt-6 space-y-3 font-funnel-sans text-ek-blue-light">
          {row.award_plan.map((p, i) => (
            <li key={p.entry_id}>
              <span className="text-ek-white">
                {formatExact(amountsUnits[i], row.token_decimals)}{' '}
                {row.token_symbol}
              </span>{' '}
              to{' '}
              {/* EarnKit's own entry page only; never a link the builder wrote. */}
              <a className="text-ek-white underline" href={`/p/${p.entry_id}`}>
                {names.get(p.entry_id) ?? 'unknown project'}
              </a>{' '}
              (entry #{p.entry_id}, {p.wallet}): {p.reason}
              {warnings[i] ? (
                <span className="mt-1 block font-medium text-red-400">
                  {warnings[i]}
                </span>
              ) : null}
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
          Sign with the campaign&apos;s wallet: {row.sponsor_wallet}.
        </p>
        {blocked ? (
          <p
            role="alert"
            className="mt-8 rounded-2xl border border-red-400 px-5 py-4 font-funnel-sans text-base font-medium text-red-400"
          >
            Don&apos;t sign this award yet. {blocked}{' '}
            {blocked === SCREEN_UNAVAILABLE
              ? 'Reload this page in a minute.'
              : 'Ask your agent to award again with other winners.'}
          </p>
        ) : row.state === 'live' ? (
          <AwardClient ref_={ref} tx={tx} sponsorWallet={row.sponsor_wallet} />
        ) : (
          <p className="mt-8 text-ek-white">This campaign is {row.state}.</p>
        )}
      </section>
    </div>
  );
}
