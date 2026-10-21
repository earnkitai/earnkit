import Footer from '../components/common/Footer';
import { dollars, streakWords, type ProfileData } from '../../lib/earnkit/bench-data';
import { PRIVATE_NAME, type PageHead } from '../../lib/earnkit/page-data';
import { rankSplit } from '../../lib/earnkit/rank';
import { pagePath } from '../../lib/earnkit/reserved-routes';
import type { ProfileSite } from '../../lib/earnkit/site-data';
import { PAGE_COL, phoneRadius, CARD_BLUE } from '../components/site/ui';
import Avatar from './Avatar';
import { DASH } from './ScoreRing';
import ActivityCard from './site/ActivityCard';
import HeroCard from './site/HeroCard';
import HighlightsCard from './site/HighlightsCard';
import ScoreCard from './site/ScoreCard';
import StreakCard from './site/StreakCard';
import TokenCard from './site/TokenCard';

/**
 * v2.13.1 O3: the one calm line while the one project is Confirming. Pages are public and the owner
 * can't be told from a visitor, so one neutral line for everyone.
 */
export const confirmingCardLine = (name: string, project: string) =>
  // Launch ready L10: a hidden repo's name is PRIVATE_NAME, never put in the sentence as a name.
  `${name} is getting ${project === PRIVATE_NAME ? 'a private project' : project} on the leaderboard.`;
/** Launch ready L10: a page with no project yet: one calm line in place of the project. */
export const noProjectLine = (name: string) => `${name} has no project on the leaderboard yet.`;
export { DASH, streakWords, rankSplit, dollars };

/** The 12 squares of the Streak card: the grid's last 12 weeks (padded with off weeks on a short grid). Pure. */
const last12 = (grid: ProfileData['grid']): boolean[] => {
  const on = grid.slice(-12).map((g) => g.on);
  return [...Array<boolean>(12 - on.length).fill(false), ...on];
};

/**
 * The Streak card's numbers. The 12th square is this week: the stored grid and streak (weeks.ts streakOf) leave an
 * unlit current week out, so commits read this week (site.thisWeek) light it and add it to the streak. Quiet
 * (confirming, no project): 0 weeks, all off. Pure.
 */
export function streakOf(d: ProfileData, site: ProfileSite, quiet: boolean): { streak: number; weeks: boolean[]; thisWeek: number } {
  if (quiet) return { streak: 0, weeks: last12([]), thisWeek: 0 };
  const weeks = last12(d.grid);
  if (site.thisWeek > 0 && !weeks[11]) return { streak: d.streak + 1, weeks: [...weeks.slice(0, 11), true], thisWeek: site.thisWeek };
  return { streak: d.streak, weeks, thisWeek: site.thisWeek };
}

/** While the page's sources refresh: the photo, name and @handle at once on a flat hero, the other cards as flat shapes. */
export function BenchProfileSkeleton({
  head,
}: {
  head: Pick<PageHead, 'name' | 'handle' | 'avatar'>;
}) {
  const flat = phoneRadius(CARD_BLUE).replace('bg-s-blue text-s-on-blue', 'bg-s-panel text-s-text');
  return (
    <div className={`${PAGE_COL} flex flex-col gap-4 pb-6 pt-2`} aria-busy="true">
      <section aria-label="Profile" className="flex flex-wrap items-stretch gap-4">
        <div className={`${flat} flex min-h-[320px] min-w-0 flex-[3_1_460px] flex-col p-6 md:p-9`}>
          <div className="flex flex-wrap items-center gap-[18px]">
            <Avatar src={head.avatar} handle={head.handle} tone="blue" className="h-16 w-16 text-[34px] md:h-[76px] md:w-[76px] md:text-[40px]" />
            <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1">
              <h1 className="ek-serif min-w-0 break-words text-[44px] leading-none tracking-[-0.01em] md:text-[60px]">{head.name}</h1>
              <span className="break-words text-[15px] text-s-muted">@{head.handle}</span>
            </div>
          </div>
        </div>
        <div aria-hidden="true" className="flex min-w-0 flex-[2_1_320px] flex-col gap-4">
          <span className={`${flat} block h-[188px]`} />
          <span className={`${flat} block h-[150px]`} />
        </div>
      </section>
      <span aria-hidden="true" className={`${flat} block h-[360px]`} />
    </div>
  );
}

/**
 * v3.1 site Task 7 (Profile, BackedBuilder and NewBuilder boards; plan S15): two wrapping rows of cards. The blue hero
 * (photo, name, the standing pill from RANK_MIN_POOL ranked builders, @handle, X, GitHub, Share, the project panel)
 * beside the navy Shipping score and the rust Streak; the white Activity card (three weeks a page) beside the Token
 * card (only from site.token) and Highlights. Then the minimal footer. No points, Originality, 52-week grid, rank
 * number, Earned, tabs or badge. While the one project is Confirming, or with no project: one calm line in the
 * panel, no score, a 0-week streak and only the next-update line. Server-rendered per request.
 */
export default function BenchProfileView({ data, site, page }: { data: ProfileData; site: ProfileSite; page: number }) {
  const d = data;
  const now = new Date();
  const confirming = d.project !== null && !d.project.confirmed;
  const quiet = confirming || d.project === null;
  const line = d.project === null ? noProjectLine(d.name) : confirming ? confirmingCardLine(d.name, d.project.name) : null;
  return (
    <>
      {/* No bottom padding from md: the minimal footer's 72px is the whole gap under the cards (Profile board). */}
      <div className={`${PAGE_COL} flex flex-col gap-4 pb-6 pt-2 md:pb-0`}>
        <section aria-label="Profile" className="flex flex-wrap items-stretch gap-4">
          <HeroCard data={d} site={site} line={line} />
          <div className="flex min-w-0 flex-[2_1_320px] flex-col gap-4">
            <ScoreCard score={quiet ? null : d.score} first={site.first} />
            <StreakCard {...streakOf(d, site, quiet)} />
          </div>
        </section>
        <section aria-label="Activity and highlights" className="flex flex-wrap items-start gap-4">
          <ActivityCard log={d.log} lastShippedAt={site.lastShippedAt} page={page} path={pagePath(d.handle)} quiet={quiet} now={now} />
          <aside className="flex min-w-0 flex-[2_1_320px] flex-col gap-4">
            {site.token ? <TokenCard token={site.token} first={site.first} project={site.project} /> : null}
            <HighlightsCard items={site.highlights} />
          </aside>
        </section>
      </div>
      <Footer variant="minimal" />
    </>
  );
}
