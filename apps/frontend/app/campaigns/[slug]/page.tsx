import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { COLUMN, H1, H2, SURFACE } from '../../components/common/Panel';
import { notFound } from 'next/navigation';
import { getCampaignBoard as readCampaignBoard } from '@/lib/earnkit/leaderboard';
import { NOT_FOUND_METADATA } from '../../not-found';
import { entryStatus, payoutBy, prizeText, prizeUsdEach, usd } from '@/lib/earnkit/campaigns';
import { formatDeadline } from '@/lib/earnkit/dates';
import { escrowLink } from '@/lib/earnkit/escrow';
import {
  CAPPED_READ_SUFFIX,
  ENTRIES_HEADING,
  LEADERBOARD_HEADING,
  NO_ENTRIES_TEXT,
  NO_MINIMUM_TEXT,
  OFF_PLAN_HEADING,
  PRIZE_WALLET_PREFIX,
  PRIZE_WALLET_UNSET,
  REVIEW_FOOTNOTE,
  REVIEW_HEADING_PAID,
  REVIEW_HEADING_PAYING,
  REVIEW_HEADING_REVIEW,
  campaignEyebrow,
  closesText,
  earnkitCampaignBlurb,
  fundsHoldsSuffix,
  offPlanLine,
  removedLine,
  reviewUntilText,
  sponsorDisclosureParts,
} from '@/lib/earnkit/campaign-page-text';
import {
  UNVERIFIED,
  sponsorLabel,
  trackRecordText,
} from '@/lib/earnkit/sponsor-identity';

export const dynamic = 'force-dynamic';

/** Builder-supplied links: only http(s) becomes a link (same rule as /p/[id]). */
const Ext = ({ href, label }: { href: string; label: string }) =>
  /^https?:\/\//i.test(href) ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="ml-2 text-xs text-ek-muted underline underline-offset-4 hover:text-ek-text"
    >
      {label}
    </a>
  ) : null;

/** One read per request, shared by generateMetadata and the page. */
const getCampaignBoard = cache(readCampaignBoard);

/** Only a missing campaign sets a title (the 404's, which the browser would otherwise replace with the layout's); a real one keeps the layout's. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return (await getCampaignBoard((await params).slug)) ? {} : NOT_FOUND_METADATA;
}

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const slug = (await params).slug;
  const board = await getCampaignBoard(slug);
  if (!board) notFound();
  const { program, rows, offPlan, sponsorState, sponsor, run, review, funds } = board;
  const identity = sponsor?.identity ?? UNVERIFIED;
  const c = program.campaign;
  const ended = program.ends_at < new Date();
  // Sponsor campaigns are picked by the sponsor: no rank or wallet count until something is scored.
  const ranked = c.kind === 'earnkit' || rows.some((r) => r.score != null);
  const disclosure = c.kind === 'sponsor' ? sponsorDisclosureParts(c.sponsor.name, identity, c.criteria) : null;

  return (
    <div className={`${COLUMN} pt-8 md:pt-12`}>
      <section className={`${SURFACE} px-5 py-10 md:px-10 md:py-12`}>
        <h1 className={H1}>{program.title}</h1>
        <p className="mt-2 font-funnel-sans text-sm text-ek-muted">
          {campaignEyebrow(c.kind === 'sponsor', sponsorLabel(identity))}
        </p>
        <p className="mt-4 max-w-2xl font-funnel-sans text-base font-light text-ek-body md:text-lg">
          {c.kind === 'sponsor'
            ? (c.what_to_build ?? program.description)
            : program.description}
        </p>
        <p className="mt-6 font-funnel-sans text-base text-ek-text">
          {prizeText(c)} ·{' '}
          {closesText(ended, formatDeadline(program.ends_at))}
        </p>
        {c.kind === 'sponsor' ? (
          <p className="mt-2 font-funnel-sans text-sm font-light text-ek-muted">
            {disclosure!.prefix}
            <a
              href={escrowLink(c.prize.chain_id, c.escrow)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              view onchain
            </a>
            {disclosure!.suffix}
          </p>
        ) : null}
        {c.kind === 'sponsor' && sponsor ? (
          <p className="mt-2 font-funnel-sans text-sm font-light text-ek-muted">
            {trackRecordText(sponsor.trackRecord)}
          </p>
        ) : null}
        {c.kind === 'sponsor' ? null : (
          <>
            <p className="mt-2 font-funnel-sans text-sm font-light text-ek-muted">
              {earnkitCampaignBlurb(usd(prizeUsdEach(c)), c.winners, formatDeadline(payoutBy(program.ends_at)), c.min_score)}
            </p>
            <p className="mt-2 break-all font-funnel-sans text-sm font-light text-ek-muted">
              {funds ? (
                <>
                  {PRIZE_WALLET_PREFIX}
                  <a
                    href={`https://basescan.org/address/${funds.wallet}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4"
                  >
                    {funds.wallet}
                  </a>
                  {fundsHoldsSuffix(funds.balance, funds.symbol)}
                </>
              ) : (
                PRIZE_WALLET_UNSET
              )}
              {run?.note ? ` ${run.note}` : ''}
            </p>
          </>
        )}
      </section>

      <section className={`${SURFACE} mt-4 px-5 py-10 md:px-10 md:py-12`}>
        <h2 className={H2}>
          {ranked ? LEADERBOARD_HEADING : ENTRIES_HEADING}
        </h2>
        {rows.length === 0 ? (
          <p className="mt-6 font-funnel-sans text-base font-light text-ek-muted">
            {NO_ENTRIES_TEXT}
          </p>
        ) : (
          <table className="mt-6 w-full table-fixed font-funnel-sans text-sm md:text-base">
            <thead>
              <tr className="text-left text-ek-muted">
                {ranked ? (
                  <th scope="col" className="w-12 pb-3 font-medium">
                    #
                  </th>
                ) : null}
                <th scope="col" className="pb-3 font-medium">
                  Project
                </th>
                {ranked ? (
                  <th scope="col" className="w-24 pb-3 text-right font-medium">
                    {c.kind === 'earnkit' ? 'Users' : 'Wallets'}
                  </th>
                ) : null}
                <th
                  scope="col"
                  className={`pb-3 text-right font-medium ${ranked ? 'hidden w-28 sm:table-cell' : 'w-40 sm:w-56'}`}
                >
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-ek-line text-ek-body"
                >
                  {ranked ? (
                    <td className="py-3 tabular-nums">{r.rank ?? '–'}</td>
                  ) : null}
                  <td className="truncate py-3 pr-4">
                    <Link
                      href={`/p/${r.id}`}
                      className="text-ek-text underline-offset-4 hover:underline"
                    >
                      {r.name}
                    </Link>
                    {!ranked && r.live_url ? (
                      <Ext href={r.live_url} label="live" />
                    ) : null}
                    {!ranked && r.repo_url ? (
                      <Ext href={r.repo_url} label="code" />
                    ) : null}
                  </td>
                  {ranked ? (
                    <td className="py-3 text-right tabular-nums">
                      {r.score ?? '–'}
                    </td>
                  ) : null}
                  <td
                    className={`py-3 text-right font-light ${ranked ? 'hidden sm:table-cell' : ''}`}
                  >
                    {r.standing ?? entryStatus(c, r, sponsorState)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {offPlan?.some((o) => o.entry_id === null) ? (
          <div className="mt-6 rounded-2xl border border-ek-line-strong p-4 font-funnel-sans text-sm text-ek-body">
            <p className="text-ek-text">
              {OFF_PLAN_HEADING}
            </p>
            <ul className="mt-2 space-y-1">
              {offPlan
                .filter((o) => o.entry_id === null)
                .map((o) => (
                  <li key={o.wallet}>
                    {offPlanLine(o.wallet, o.amount, c.prize.symbol)}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </section>

      {review && run ? (
        <section className={`${SURFACE} mt-4 px-5 py-10 md:px-10 md:py-12`}>
          <h2 className={H2}>
            {run.state === 'review' ? REVIEW_HEADING_REVIEW : run.state === 'paid' ? REVIEW_HEADING_PAID : REVIEW_HEADING_PAYING}
          </h2>
          {run.state === 'review' && run.review_until ? (
            <p className="mt-2 font-funnel-sans text-sm font-light text-ek-muted">
              {reviewUntilText(formatDeadline(run.review_until))}
            </p>
          ) : null}
          {review.picks.length === 0 ? (
            <p className="mt-6 font-funnel-sans text-base font-light text-ek-muted">
              {NO_MINIMUM_TEXT}
            </p>
          ) : (
            <table className="mt-6 w-full table-fixed font-funnel-sans text-sm">
              <thead>
                <tr className="text-left text-ek-muted">
                  <th scope="col" className="w-12 pb-3 font-medium">#</th>
                  <th scope="col" className="pb-3 font-medium">Project</th>
                  <th scope="col" className="w-28 pb-3 text-right font-medium">Users</th>
                  <th scope="col" className="hidden w-24 pb-3 text-right font-medium sm:table-cell">Shared</th>
                  <th scope="col" className="hidden w-28 pb-3 text-right font-medium sm:table-cell">Builder Code</th>
                </tr>
              </thead>
              <tbody>
                {review.picks.map((r) => (
                  <tr key={r.id} className="border-t border-ek-line text-ek-body">
                    <td className="py-3 tabular-nums">{r.rank}</td>
                    <td className="truncate py-3 pr-4">
                      <Link href={`/p/${r.id}`} className="text-ek-text underline-offset-4 hover:underline">
                        {r.name}
                      </Link>
                      {r.prize_tx ? (
                        <a
                          href={`https://basescan.org/tx/${r.prize_tx}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-xs text-ek-muted underline"
                        >
                          paid
                        </a>
                      ) : null}
                    </td>
                    <td className="py-3 text-right tabular-nums">
                      {r.counted} ({r.smart} smart)
                      {r.score_partial ? <span className="block text-xs text-ek-muted">capped read</span> : null}
                    </td>
                    <td className="hidden py-3 text-right tabular-nums sm:table-cell">{r.shared}</td>
                    <td className="hidden py-3 text-right tabular-nums sm:table-cell">
                      {r.code_share === null ? '–' : `${Math.round(r.code_share * 100)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-4 font-funnel-sans text-xs font-light text-ek-muted">
            {REVIEW_FOOTNOTE}
            {review.picks.some((r) => r.score_partial) ? CAPPED_READ_SUFFIX : ''}
          </p>
          {review.ranked.some((r) => r.vetoed_at) ? (
            <ul className="mt-4 space-y-1 font-funnel-sans text-sm text-ek-muted">
              {review.ranked
                .filter((r) => r.vetoed_at)
                .map((r) => (
                  <li key={r.id}>
                    {removedLine(r.name, r.veto_reason)}
                  </li>
                ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
