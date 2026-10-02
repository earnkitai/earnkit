import { notFound } from 'next/navigation';
import { parseUnits } from 'viem';
import { formatDeadline } from '@/lib/earnkit/dates';
import { escrowConfig, escrowEnabled, fundTxs } from '@/lib/earnkit/escrow';
import { formatExact } from '@/lib/earnkit/format-units';
import { checkChain, expiredText, loadCampaign } from '@/lib/earnkit/sponsor';
import { splitUnits } from '@/lib/earnkit/sponsor-rules';
import { sponsorLabel } from '@/lib/earnkit/sponsor-identity';
import { FUND_WARNING } from '@/lib/earnkit/sponsor-text';
import { sponsorIdentity } from '@/lib/earnkit/sponsor-verify';
import FundClient from './FundClient';

export const dynamic = 'force-dynamic';
// Pages anyone's agent can create: never in search results (v2.2 audit L2).
export const metadata = { robots: { index: false, follow: false } };

export default async function FundPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  // No escrow configured on this deployment (sponsor campaigns not open yet): nothing to fund.
  if (!escrowEnabled()) notFound();
  if (!/^0x[0-9a-f]{64}$/.test(ref)) notFound();
  const found = await loadCampaign(ref).catch(() => null);
  if (!found) notFound();
  // A deposit from the bound wallet may already be onchain: publish it before rendering.
  const { fundingProblem } = await checkChain(found).catch((err) => {
    console.error('[fund] chain check failed:', err);
    return { fundingProblem: null };
  });
  const row = await loadCampaign(ref);
  const identity = await sponsorIdentity(row);
  // Sign exactly the token the draft stored (and that findFunding matches), never a
  // token looked up from the current config.
  const token = {
    symbol: row.token_symbol,
    address: row.token as `0x${string}`,
    decimals: row.token_decimals,
  };
  // A draft made for another chain than the one this deployment's escrow is on can't be funded here.
  const sameChain = escrowConfig().chainId === row.chain_id;
  const units = parseUnits(row.amount, row.token_decimals);
  const { prize, fee } = splitUnits(units);
  // Exact — not Number(u).toLocaleString(), which rounds to 3 fraction digits and can show a
  // different amount than the one actually signed onchain.
  const f = (u: bigint) => formatExact(u, row.token_decimals);

  return (
    <div className="w-full pt-4">
      <section className="rounded-[40px] bg-ek-navy-deep px-6 py-12 md:rounded-[56px] md:px-16 md:py-16">
        <p className="font-funnel-sans text-xs font-medium uppercase tracking-[0.3em] text-ek-blue-soft">
          Fund a campaign
        </p>
        <h1 className="mt-4 font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">
          {row.draft.title}
        </h1>
        <p className="mt-2 font-funnel-sans text-base text-ek-blue-light">
          by &ldquo;{row.sponsor_name}&rdquo; · {sponsorLabel(identity)}
        </p>
        <dl className="mt-8 grid gap-4 font-funnel-sans text-ek-white sm:grid-cols-3">
          <div>
            <dt className="text-sm text-ek-blue-soft">You deposit</dt>
            <dd className="text-2xl">
              {f(units)} {row.token_symbol}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ek-blue-soft">Winners get</dt>
            <dd className="text-2xl">
              {f(prize)} {row.token_symbol}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ek-blue-soft">
              EarnKit fee, only on payout
            </dt>
            <dd className="text-2xl">
              {f(fee)} {row.token_symbol}
            </dd>
          </div>
        </dl>
        <p className="mt-6 max-w-2xl font-funnel-sans text-sm font-light text-ek-blue-soft">
          The pool goes into its own escrow contract on Base. You pick the
          winners after {formatDeadline(row.draft.ends_at)}. If you haven&apos;t
          picked winners 7 days after the deadline, EarnKit may propose the top
          entries; they can be paid 3 days later unless you award first. If
          nobody qualifies, everything comes back to you, fee included.
        </p>
        {row.sponsor_wallet ? (
          <p className="mt-4 font-funnel-sans text-sm text-ek-blue-soft">
            This campaign can only be funded from{' '}
            <span className="text-ek-white">{row.sponsor_wallet}</span>.
          </p>
        ) : null}
        {row.state === 'draft' ? (
          <p
            className="mt-8 rounded-2xl border border-red-400 px-5 py-4 font-funnel-sans text-base font-medium text-ek-white"
            role="alert"
          >
            {FUND_WARNING}
          </p>
        ) : null}
        {fundingProblem ? (
          <p className="mt-8 font-funnel-sans text-base text-ek-white">
            {fundingProblem[0].toUpperCase()}
            {fundingProblem.slice(1)} Contact EarnKit to have it refunded, then
            ask your agent to create a new campaign.
          </p>
        ) : row.state === 'draft' && !row.sponsor_wallet ? (
          <p className="mt-8 font-funnel-sans text-base text-ek-white">
            This draft predates wallet binding; ask your agent to create a new
            one.
          </p>
        ) : row.state === 'draft' && !sameChain ? (
          <p className="mt-8 font-funnel-sans text-base text-ek-white">
            This draft was made for another network; ask your agent to create a
            new one.
          </p>
        ) : row.state === 'draft' && row.sponsor_wallet ? (
          <FundClient
            ref_={ref}
            sponsorWallet={row.sponsor_wallet}
            endsAt={Date.parse(row.draft.ends_at)}
            txs={fundTxs(
              ref as `0x${string}`,
              token,
              units,
              Math.floor(Date.parse(row.draft.ends_at) / 1000),
            )}
          />
        ) : row.state === 'expired' ? (
          <p className="mt-8 font-funnel-sans text-base text-ek-white">
            {expiredText(row, new Date())}
          </p>
        ) : (
          <p className="mt-8 font-funnel-sans text-base text-ek-white">
            This campaign is {row.state}.{' '}
            {row.program_id ? (
              <a className="underline" href={`/campaigns/${row.program_id}`}>
                See it
              </a>
            ) : null}
          </p>
        )}
      </section>
    </div>
  );
}
