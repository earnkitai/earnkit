import Link from 'next/link';
import Footer from '../../components/common/Footer';
import { Eyebrow, Panel } from '../../components/common/Panel';
import { formatDeadline } from '../../../lib/earnkit/dates';
import type { Board } from '../../../lib/earnkit/bonus-board';
import { WEIGHTS } from '../../../lib/earnkit/traction';
import { shownUrl } from '../../../lib/earnkit/untrusted-text';

/**
 * A stored builder link, styled as v2.4's entry links. It defends itself: only the canonical https
 * form (shownUrl) becomes a link, whatever the caller passed; anything else renders nothing.
 */
const Ext = ({ href, label }: { href: string | null; label: string }) => {
  const url = shownUrl(href);
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="ml-2 text-xs text-ek-blue-soft underline underline-offset-4 hover:text-ek-white"
    >
      {label}
    </a>
  ) : null;
};

const HEADINGS: Record<Board['state'], string> = {
  open: 'Leaderboard',
  frozen: 'Final scores',
  review: 'In review',
  paying: 'Paying winners',
  paid: 'Winners',
  empty: 'Leaderboard',
};

const STATUS: Record<Board['state'], string> = {
  open: 'Final scores',
  frozen: 'Final scores',
  review: 'In review',
  paying: 'Paying',
  paid: 'Paid',
  empty: 'No eligible entry',
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-ek-blue-soft">{label}</dt>
      <dd className="mt-1 font-funnel-display text-2xl font-medium text-ek-white md:text-3xl">{value}</dd>
    </div>
  );
}

/**
 * The public builder bonus leaderboard (/bonus/<round>): the program's factual name, the
 * disclaimer, the pool and time left, and the ranking (bonus-board.ts: public data only). Built
 * from the campaign page's panels, type and table.
 */
export default function BoardView({ board: b }: { board: Board }) {
  const frozen = b.state === 'review' || b.state === 'paying' || b.state === 'paid' || b.state === 'empty';
  const ended = b.days_left === 0;
  const day = (d: Date) => formatDeadline(d).replace(/, \d\d:\d\d UTC$/, '');
  // Open: the time left. Ended: when it ended, then where the round is (review, paying, paid).
  // Ruling 29: the round's end is the day the first message and the entry reply show.
  const second = ended ? { label: 'Ended', value: b.ends_label } : { label: 'Days left', value: String(b.days_left) };
  const third = !ended
    ? { label: 'Ends', value: b.ends_label }
    : b.state === 'review' && b.review_until
      ? { label: 'Review until', value: day(b.review_until) }
      : { label: 'Status', value: STATUS[b.state] };

  return (
    <div className="w-full pt-4">
      <Panel className="py-12 md:py-16">
        <Eyebrow>EarnKit builder bonus</Eyebrow>
        <h1 className="mt-4 font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">{b.title}</h1>
        <p className="mt-4 max-w-2xl font-funnel-sans text-base font-light text-ek-blue-light md:text-lg">
          EarnKit isn&apos;t affiliated with or endorsed by the organizer. The builder bonus is paid by EarnKit from
          the fees of coins entered in this program.
        </p>
        <dl className="mt-8 grid gap-6 font-funnel-sans sm:grid-cols-3">
          <Fact label={frozen ? 'Pool' : 'Pool so far'} value={`${b.pool} ETH`} />
          <Fact label={second.label} value={second.value} />
          <Fact label={third.label} value={third.value} />
        </dl>
        <p className="mt-8 max-w-2xl font-funnel-sans text-sm font-light text-ek-blue-soft">
          Ranked by real traction; trading volume never counts. When the round ends, the top 10 are public for a
          48-hour review, then the pool is paid automatically in WETH on Base.{' '}
          <Link href="/policy" className="text-ek-white underline underline-offset-4 hover:text-ek-blue-soft">
            How it works
          </Link>
        </p>
      </Panel>

      <Panel className="mt-4 py-10 md:py-14">
        <h2 className="font-funnel-display text-2xl font-medium text-ek-white">{HEADINGS[b.state]}</h2>
        {b.state === 'review' && b.review_until ? (
          <p className="mt-2 font-funnel-sans text-sm font-light text-ek-blue-soft">
            Public until {formatDeadline(b.review_until)}; then the pool is paid automatically. Farmed activity
            removes an entry, and the next one moves up.
          </p>
        ) : null}
        {b.rows.length === 0 ? (
          <p className="mt-6 font-funnel-sans text-base font-light text-ek-blue-soft">
            {b.state === 'empty'
              ? 'The round ended with no eligible entry, so its pool went to EarnKit.'
              : 'No entries yet.'}
          </p>
        ) : (
          <table className="mt-6 w-full table-fixed font-funnel-sans text-sm md:text-base">
            <thead>
              <tr className="text-left text-ek-blue-soft">
                <th scope="col" className="w-10 pb-3 font-medium md:w-12">#</th>
                <th scope="col" className="pb-3 font-medium">Project</th>
                <th scope="col" className="w-16 pb-3 text-right font-medium md:w-24">Score</th>
                {frozen ? (
                  <th scope="col" className="w-24 pb-3 text-right font-medium md:w-32">Prize</th>
                ) : null}
                {frozen ? null : (
                  <th scope="col" className="w-14 pb-3 pl-4 text-right font-medium sm:w-64">
                    Eligible
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={`${r.rank ?? 'x'}-${i}`} className="border-t border-ek-navy align-top text-ek-blue-light">
                  <td className="py-3 tabular-nums">{r.rank ?? '–'}</td>
                  <td className="py-3 pr-2">
                    <span className="break-words text-ek-white">{r.name}</span>
                    <Ext href={r.live_url} label="live" />
                    <Ext href={r.repo_url} label="code" />
                    {!frozen && r.note !== 'Yes' ? (
                      <span className="mt-1 block text-xs font-light text-ek-blue-soft sm:hidden">
                        {r.note.replace(/^(No: |Yes, )/, '')}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3 text-right tabular-nums">{r.score ?? '–'}</td>
                  {frozen ? (
                    <td className="py-3 text-right tabular-nums">
                      {r.amount ? `${r.amount} ETH` : '–'}
                      {r.tx && /^0x[0-9a-fA-F]{64}$/.test(r.tx) ? (
                        <a
                          href={`https://basescan.org/tx/${r.tx}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-xs text-ek-blue-soft underline underline-offset-4 hover:text-ek-white"
                        >
                          paid
                        </a>
                      ) : null}
                    </td>
                  ) : null}
                  {frozen ? null : (
                    <td className={`py-3 pl-4 text-right font-light ${r.eligible ? '' : 'text-ek-blue-soft'}`}>
                      <span className="sm:hidden">{r.eligible ? 'Yes' : 'No'}</span>
                      <span className="hidden sm:inline">{r.note}</span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {b.removed > 0 ? (
          <p className="mt-4 font-funnel-sans text-sm font-light text-ek-blue-soft">
            {b.removed === 1 ? '1 entry was' : `${b.removed} entries were`} removed in review.
          </p>
        ) : null}
        <p className="mt-4 font-funnel-sans text-xs font-light text-ek-blue-soft">
          Score: traction out of 100 (onchain users {WEIGHTS.users}, live product {WEIGHTS.live}, shipping{' '}
          {WEIGHTS.shipping}, repo interest {WEIGHTS.interest}, coin holders {WEIGHTS.holders}). Market cap only
          breaks ties.
        </p>
      </Panel>

      <Footer />
    </div>
  );
}
