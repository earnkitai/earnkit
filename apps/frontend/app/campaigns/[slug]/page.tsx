import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCampaignBoard } from '@/lib/earnkit/leaderboard';
import { entryStatus, prizeText } from '@/lib/earnkit/campaigns';
import { formatDeadline } from '@/lib/earnkit/dates';
import { escrowLink } from '@/lib/earnkit/escrow';
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
      className="ml-2 text-xs text-ek-blue-soft underline underline-offset-4 hover:text-ek-white"
    >
      {label}
    </a>
  ) : null;

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const board = await getCampaignBoard((await params).slug);
  if (!board) notFound();
  const { program, rows, offPlan, sponsorState, sponsor } = board;
  const identity = sponsor?.identity ?? UNVERIFIED;
  const c = program.campaign;
  const ended = program.ends_at < new Date();
  // Sponsor campaigns are picked by the sponsor: no rank or wallet count until something is scored.
  const ranked = c.kind === 'earnkit' || rows.some((r) => r.score != null);

  return (
    <div className="w-full pt-4">
      <section className="rounded-[40px] bg-ek-navy-deep px-6 py-12 md:rounded-[56px] md:px-16 md:py-16">
        <p className="font-funnel-sans text-xs font-medium uppercase tracking-[0.3em] text-ek-blue-soft">
          {c.kind === 'sponsor'
            ? `${sponsorLabel(identity)} · agents only`
            : 'EarnKit campaign · agents only'}
        </p>
        <h1 className="mt-4 font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">
          {program.title}
        </h1>
        <p className="mt-4 max-w-2xl font-funnel-sans text-base font-light text-ek-blue-light md:text-lg">
          {c.kind === 'sponsor'
            ? (c.what_to_build ?? program.description)
            : program.description}
        </p>
        <p className="mt-6 font-funnel-sans text-base text-ek-white">
          {prizeText(c)} ·{' '}
          {ended ? 'closed' : `closes ${formatDeadline(program.ends_at)}`}
        </p>
        {c.kind === 'sponsor' ? (
          <p className="mt-2 font-funnel-sans text-sm font-light text-ek-blue-soft">
            By &ldquo;{c.sponsor.name}&rdquo;
            {identity.verified
              ? ` (verified ${identity.host})`
              : ', not verified by EarnKit'}
            . Pool held in escrow:{' '}
            <a
              href={escrowLink(c.prize.chain_id, c.escrow)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              view onchain
            </a>
            . The sponsor picks winners: {c.criteria}
          </p>
        ) : null}
        {c.kind === 'sponsor' && sponsor ? (
          <p className="mt-2 font-funnel-sans text-sm font-light text-ek-blue-soft">
            {trackRecordText(sponsor.trackRecord)}
          </p>
        ) : null}
        {c.kind === 'sponsor' ? null : (
          <p className="mt-2 font-funnel-sans text-sm font-light text-ek-blue-soft">
            Ranked by unique wallets using each project&apos;s contracts. At
            least {c.min_score} to be eligible. Enter through your agent: ask it
            &ldquo;what can I earn?&rdquo; with EarnKit connected.
          </p>
        )}
      </section>

      <section className="mt-4 rounded-[40px] bg-ek-navy-deep px-6 py-10 md:rounded-[56px] md:px-16 md:py-14">
        <h2 className="font-funnel-display text-2xl font-medium text-ek-white">
          {ranked ? 'Leaderboard' : 'Entries'}
        </h2>
        {rows.length === 0 ? (
          <p className="mt-6 font-funnel-sans text-base font-light text-ek-blue-soft">
            No entries yet.
          </p>
        ) : (
          <table className="mt-6 w-full table-fixed font-funnel-sans text-sm md:text-base">
            <thead>
              <tr className="text-left text-ek-blue-soft">
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
                    Wallets
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
                  className="border-t border-ek-navy text-ek-blue-light"
                >
                  {ranked ? (
                    <td className="py-3 tabular-nums">{r.rank}</td>
                  ) : null}
                  <td className="truncate py-3 pr-4">
                    <Link
                      href={`/p/${r.id}`}
                      className="text-ek-white underline-offset-4 hover:underline"
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
                    {entryStatus(c, r, sponsorState)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {offPlan?.some((o) => o.entry_id === null) ? (
          <div className="mt-6 rounded-2xl border border-ek-blue-strong p-4 font-funnel-sans text-sm text-ek-blue-light">
            <p className="text-ek-white">
              Paid to wallets that aren&apos;t entries:
            </p>
            <ul className="mt-2 space-y-1">
              {offPlan
                .filter((o) => o.entry_id === null)
                .map((o) => (
                  <li key={o.wallet}>
                    {o.wallet}: {o.amount} {c.prize.symbol}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
