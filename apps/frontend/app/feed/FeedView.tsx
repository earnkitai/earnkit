import Link from 'next/link';
import Footer from '../components/common/Footer';
import Pager from '../components/site/Pager';
import SegTabs from '../components/site/SegTabs';
import { CARD_NEUTRAL, H1_SITE, PAGE_COL_WIDE, PILL_WHITE } from '../components/site/ui';
import type { FeedCard } from '../../lib/earnkit/feed';
import type { FeedWeekStats } from '../../lib/earnkit/site-data';
import { ACTIVITY_MORE, feedShowingLine } from '../../lib/earnkit/site-copy';
import FeedRow from './FeedRow';
import FeedStats from './FeedStats';

export const FEED_TITLE = 'Feed';
/** The page's description (metadata); the Feed board shows no line under the title. */
export const FEED_LINE = 'What builders on the leaderboard shipped, week by week. Every fact is checked.';
export const FEED_EMPTY = 'No updates yet. New ones post every Monday.';
/** The newest weeks shown as tabs (plan W4); an older week is reachable by its `?week=` URL. */
export const FEED_TABS = 3;
/** Rows per page (plan W4). */
export const FEED_PAGE = 10;

type FeedWeek = { monday: string; label: string; cards: FeedCard[] };

/** Pure. The week a `?week=<monday>` names, else the newest; null with no weeks. page.tsx reads its stats. */
export function pickWeek<W extends { monday: string }>(weeks: W[], week: string | null): W | null {
  return weeks.find((w) => w.monday === week) ?? weeks[0] ?? null;
}

/** Pure. A week's page: `/feed?week=<monday>`, plus `&page=N` from page 2. */
export const feedHref = (monday: string, n = 1): string => `/feed?week=${monday}${n > 1 ? `&page=${n}` : ''}`;

/**
 * v3.1 site Task 9 (Feed board) on the deep page colour: the title with the week tabs (the newest FEED_TABS), the
 * selected week's four numbers (hidden when the read failed), its cards as full-width dark rows, FEED_PAGE a page,
 * with quiet pagination (Newer, the numbers, Older). No weeks: the empty card and the way to the leaderboard. Pure.
 */
export default function FeedView({ weeks, week, page, stats }: { weeks: FeedWeek[]; week: string | null; page: number; stats: FeedWeekStats | null }) {
  const sel = pickWeek(weeks, week);
  const cards = sel?.cards ?? [];
  const pages = Math.max(1, Math.ceil(cards.length / FEED_PAGE));
  // A hand-edited ?page= reads as the nearest page (as Pager clamps its links).
  const at = Math.min(Math.max(Math.trunc(page) || 1, 1), pages);
  const shown = cards.slice((at - 1) * FEED_PAGE, at * FEED_PAGE);
  return (
    <div data-ek-deep="" className="w-full">
      <div className={`${PAGE_COL_WIDE} flex flex-col gap-7 pb-6 pt-6 md:pb-0`}>
        <section aria-label={FEED_TITLE} className="flex flex-wrap items-end justify-between gap-4 px-2">
          <h1 className={H1_SITE}>{FEED_TITLE}</h1>
          {weeks.length > 0 && (
            <SegTabs label="Weeks" tone="step" items={weeks.slice(0, FEED_TABS).map((w) => ({ label: w.label, href: feedHref(w.monday), on: w.monday === sel?.monday }))} />
          )}
        </section>
        {sel === null ? (
          <div className={`${CARD_NEUTRAL} flex flex-wrap items-center justify-between gap-4 p-[26px]`}>
            <p className="text-[15px] text-s-card-body">{FEED_EMPTY}</p>
            <Link href="/leaderboard" className={PILL_WHITE}>
              {ACTIVITY_MORE}
            </Link>
          </div>
        ) : (
          <>
            {stats && <FeedStats stats={stats} label={`${sel.label} in numbers`} />}
            <section aria-label={sel.label}>
              <ul className="flex flex-col gap-3">
                {shown.map((c) => (
                  <li key={c.id}>
                    <FeedRow c={c} />
                  </li>
                ))}
              </ul>
            </section>
            {/* The week has more builders than the feed shows (FEED_WEEK_MAX): say so, with both real numbers. */}
            {stats && stats.builders > cards.length && <p className="px-2 text-center text-[13px] text-s-muted">{feedShowingLine(cards.length, stats.builders)}</p>}
            {/* Centred as on the board: the nav shrinks to its links. One page: none. */}
            {pages > 1 && (
              <div className="flex justify-center py-2">
                <Pager page={at} pages={pages} href={(n) => feedHref(sel.monday, n)} labels={['Newer', 'Older']} numbers tone="deep" label="Feed pages" />
              </div>
            )}
          </>
        )}
      </div>
      <Footer />
    </div>
  );
}
