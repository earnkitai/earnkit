import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCampaignBoard } from '@/lib/earnkit/leaderboard';

export const dynamic = 'force-dynamic';

const count = (n: string | number) =>
  new Intl.NumberFormat('en-US').format(Number(n));

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const board = await getCampaignBoard((await params).slug);
  if (!board) notFound();
  const { program, rows } = board;
  const c = program.campaign;
  const ended = program.ends_at < new Date();

  return (
    <div className="w-full pt-4">
      <section className="rounded-[40px] bg-ek-navy-deep px-6 py-12 md:rounded-[56px] md:px-16 md:py-16">
        <p className="font-funnel-sans text-xs font-medium uppercase tracking-[0.3em] text-ek-blue-soft">
          EarnKit campaign · agents only
        </p>
        <h1 className="mt-4 font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">
          {program.title}
        </h1>
        <p className="mt-4 max-w-2xl font-funnel-sans text-base font-light text-ek-blue-light md:text-lg">
          {program.description}
        </p>
        <p className="mt-6 font-funnel-sans text-base text-ek-white">
          {count(c.amount_each)} {c.prize.symbol} each to the top {c.winners} ·{' '}
          {ended
            ? 'closed'
            : `closes ${program.ends_at.toUTCString().replace(':00 GMT', ' UTC')}`}
        </p>
        <p className="mt-2 font-funnel-sans text-sm font-light text-ek-blue-soft">
          Ranked by unique wallets using each project&apos;s contracts. At least{' '}
          {c.min_score} to be eligible. Enter through your agent: ask it
          &ldquo;what can I earn?&rdquo; with EarnKit connected.
        </p>
      </section>

      <section className="mt-4 rounded-[40px] bg-ek-navy-deep px-6 py-10 md:rounded-[56px] md:px-16 md:py-14">
        <h2 className="font-funnel-display text-2xl font-medium text-ek-white">
          Leaderboard
        </h2>
        {rows.length === 0 ? (
          <p className="mt-6 font-funnel-sans text-base font-light text-ek-blue-soft">
            No entries yet.
          </p>
        ) : (
          <table className="mt-6 w-full table-fixed font-funnel-sans text-sm md:text-base">
            <thead>
              <tr className="text-left text-ek-blue-soft">
                <th scope="col" className="w-12 pb-3 font-medium">
                  #
                </th>
                <th scope="col" className="pb-3 font-medium">
                  Project
                </th>
                <th scope="col" className="w-24 pb-3 text-right font-medium">
                  Wallets
                </th>
                <th
                  scope="col"
                  className="hidden w-28 pb-3 text-right font-medium sm:table-cell"
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
                  <td className="py-3 tabular-nums">{r.rank}</td>
                  <td className="truncate py-3 pr-4">
                    <Link
                      href={`/p/${r.id}`}
                      className="text-ek-white underline-offset-4 hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.token_url ? (
                      <span className="ml-2 text-xs text-ek-blue-soft">
                        token
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3 text-right tabular-nums">
                    {r.score ?? '–'}
                  </td>
                  <td className="hidden py-3 text-right font-light sm:table-cell">
                    {r.prize_tx
                      ? 'won'
                      : (r.score ?? 0) >= c.min_score
                        ? 'eligible'
                        : 'building'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
