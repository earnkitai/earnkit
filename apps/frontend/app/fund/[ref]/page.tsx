import { notFound } from 'next/navigation';
import { parseUnits } from 'viem';
import { escrowConfig, escrowEnabled, fundTxs } from '@/lib/earnkit/escrow';
import { formatExact } from '@/lib/earnkit/format-units';
import { loadCampaign } from '@/lib/earnkit/sponsor';
import { splitUnits } from '@/lib/earnkit/sponsor-rules';
import FundClient from './FundClient';

export const dynamic = 'force-dynamic';

export default async function FundPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  // No escrow configured on this deployment (sponsor campaigns not open yet): nothing to fund.
  if (!escrowEnabled()) notFound();
  const row = /^0x[0-9a-f]{64}$/.test(ref)
    ? await loadCampaign(ref).catch(() => null)
    : null;
  if (!row) notFound();
  // Sign exactly the token the draft stored (and that confirmFunding verifies against), never a
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
          by {row.sponsor_name}
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
          winners after {new Date(row.draft.ends_at).toUTCString()}. If you
          don&apos;t within 7 days, EarnKit pays the top entries. If nobody
          qualifies, everything comes back to you, fee included.
        </p>
        {row.state === 'draft' && !sameChain ? (
          <p className="mt-8 font-funnel-sans text-base text-ek-white">
            This draft was made for another network; ask your agent to create a
            new one.
          </p>
        ) : row.state === 'draft' ? (
          <FundClient
            ref_={ref}
            txs={fundTxs(
              ref as `0x${string}`,
              token,
              units,
              Math.floor(Date.parse(row.draft.ends_at) / 1000),
            )}
          />
        ) : row.state === 'expired' ? (
          <p className="mt-8 font-funnel-sans text-base text-ek-white">
            This draft expired; ask your agent to create a new one.
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
