import Link from 'next/link';
import Footer from '../components/common/Footer';
import Pager from '../components/site/Pager';
import SegTabs from '../components/site/SegTabs';
import { CARD_PANEL, H1_SITE, PAGE_COL, PILL_WHITE, phoneRadius } from '../components/site/ui';
import { filterHref, type BenchFilter, type BenchRow } from '../../lib/earnkit/bench-data';
import { raisingEnabled } from '../../lib/earnkit/builder-score-flag';
import { CHAIN_LABEL, RANK_MIN_POOL, type BenchChain } from '../../lib/earnkit/rank';
import { BENCH_TOP_EMPTY, BENCH_VERIFIED, leaderboardLine } from '../../lib/earnkit/site-copy';
import BenchRowItem from './BenchRowItem';
import Podium from './Podium';

export const BENCH_TITLE = 'Leaderboard';
export const BENCH_EMPTY = 'No builder matches this filter yet.';
export const BENCH_SHOW_ALL = 'Show everyone';
/** The filter tabs' words (plan W3: All, Base, Backed). */
export const FILTER_ALL = 'All';
/** v3 Stage 2: builders with backing open (`?backed=1`), only while EARNKIT_RAISING is on. */
export const FILTER_BACKED = 'Backed';
/** v2.13: an old `?weekly=1` link still filters (a streak of WEEKLY_STREAK weeks) but has no tab (plan W3). */
export const FILTER_WEEKLY = 'Shipping every week';
/** Rows per page; the podium is rows 1 to 3 of page 1 (plan W3). */
export const LEADERBOARD_PAGE = 20;

/** Pure. A page of a filter variant: the filter's URL, plus `page=N` from page 2. */
export function pageHref(f: BenchFilter, n: number): string {
  const href = filterHref(f);
  return n <= 1 ? href : `${href}${href.includes('?') ? '&' : '?'}page=${n}`;
}

/**
 * Pure. The tabs: All, Base (with a ranked Base project), Backed (only while EARNKIT_RAISING is on). A tab is marked only
 * for its exact filter, so an old `?chain=arc` or `?weekly=1` link filters the rows and marks none (plan W3).
 */
export function filterTabs(filter: BenchFilter, chips: BenchChain[], raising: boolean): { label: string; href: string; on: boolean }[] {
  const { chain, weekly } = filter;
  const backed = Boolean(filter.backed);
  const tabs = [{ label: FILTER_ALL, href: filterHref({ chain: null, weekly: false }), on: !chain && !weekly && !backed }];
  if (chips.includes('base')) tabs.push({ label: CHAIN_LABEL.base, href: filterHref({ chain: 'base', weekly: false }), on: chain === 'base' && !weekly && !backed });
  if (raising) tabs.push({ label: FILTER_BACKED, href: filterHref({ chain: null, weekly: false, backed: true }), on: backed && !chain && !weekly });
  return tabs;
}

/**
 * Pure. The count under the title: the whole pool on the plain view, the filter's rows on a filtered one (QA item 2), so
 * "Base" never shows the pool's number. Null on a filter with no rows (its panel says BENCH_EMPTY), BENCH_TOP_EMPTY
 * with nobody ranked. The 10-ranked rule keeps reading the pool (`count`), never this line. A count is followed by
 * BENCH_VERIFIED on the same line (clarity batch): the score is read from GitHub daily, never self-reported.
 */
export function countLine(filter: BenchFilter, rows: number, count: number): string | null {
  if (count === 0) return BENCH_TOP_EMPTY;
  const filtered = Boolean(filter.chain || filter.weekly || filter.backed);
  const n = filtered ? rows : count;
  return n > 0 ? `${leaderboardLine(n)}. ${BENCH_VERIFIED}` : null;
}

/**
 * v3.1 site Task 8 (Leaderboard board): the title and its count line, the filter rail, the podium (page 1's first three
 * rows), then the rest of the page's rows on one panel with quiet pagination, LEADERBOARD_PAGE rows a page. Under
 * RANK_MIN_POOL ranked builders no "#N" and no metal pill anywhere (plan S14); the count line never says "of N".
 */
export default function BenchView({ rows, count, chips, filter, page }: { rows: BenchRow[]; count: number; chips: BenchChain[]; filter: BenchFilter; page: number }) {
  const ranked = count >= RANK_MIN_POOL;
  const pages = Math.max(1, Math.ceil(rows.length / LEADERBOARD_PAGE));
  // A hand-edited ?page= reads as the nearest page (as Pager clamps its links).
  const at = Math.min(Math.max(Math.trunc(page) || 1, 1), pages);
  const shown = rows.slice((at - 1) * LEADERBOARD_PAGE, at * LEADERBOARD_PAGE);
  const podium = at === 1 ? shown.slice(0, 3) : [];
  const list = shown.slice(podium.length);
  const line = countLine(filter, rows.length, count);
  return (
    <>
      <div className={`${PAGE_COL} flex flex-col gap-4 pb-6 pt-2 md:pb-0`}>
        <section aria-label={BENCH_TITLE} className="flex flex-wrap items-end justify-between gap-4 px-2 pb-2 pt-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className={H1_SITE}>{BENCH_TITLE}</h1>
            {line && <p className="text-[15px] text-s-muted">{line}</p>}
          </div>
          {count > 0 && <SegTabs label="Filters" items={filterTabs(filter, chips, raisingEnabled())} />}
        </section>
        {/* Nobody ranked: the header's empty line is the only one; a filtered view with no rows says BENCH_EMPTY. */}
        {count > 0 &&
          (rows.length === 0 ? (
            <div className={`${phoneRadius(CARD_PANEL)} flex flex-wrap items-center justify-between gap-3 p-6`}>
              <p className="text-[15px] text-s-muted">{BENCH_EMPTY}</p>
              <Link href={filterHref({ chain: null, weekly: false })} className={PILL_WHITE}>
                {BENCH_SHOW_ALL}
              </Link>
            </div>
          ) : (
            <>
              <Podium rows={podium} ranked={ranked} />
              {(list.length > 0 || pages > 1) && (
                <section aria-label="Builders" className={`${phoneRadius(CARD_PANEL)} flex flex-col p-3`}>
                  {list.length > 0 && (
                    <ol start={(at - 1) * LEADERBOARD_PAGE + podium.length + 1} className="flex flex-col">
                      {list.map((r) => (
                        <BenchRowItem key={r.handle} r={r} ranked={ranked} />
                      ))}
                    </ol>
                  )}
                  <Pager page={at} pages={pages} href={(n) => pageHref(filter, n)} tone="dark" className="px-3.5 pb-1.5 pt-2.5" />
                </section>
              )}
            </>
          ))}
      </div>
      <Footer />
    </>
  );
}
