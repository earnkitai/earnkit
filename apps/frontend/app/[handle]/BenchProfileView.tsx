import Footer from '../components/common/Footer';
import { dollars, streakWords, type ProfileData } from '../../lib/earnkit/bench-data';
import { PRIVATE_NAME, type PageHead } from '../../lib/earnkit/page-data';
import { rankSplit } from '../../lib/earnkit/rank';
import { pagePath } from '../../lib/earnkit/reserved-routes';
import type { ProfileSite } from '../../lib/earnkit/site-data';
import { PROFILE_CTA_TEXT, PROFILE_CTA_TITLE } from '../../lib/earnkit/site-copy';
import InviteRow from '../components/site/InviteRow';
import { PAGE_COL, phoneRadius, CARD_BLUE, CARD_PANEL, PILL_WHITE } from '../components/site/ui';
import Avatar from './Avatar';
import RefMark from './RefMark';
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
/** 2026-10-23 Base onboarding: in its place once the builder said yes to the Base walk-through. */
export const startingLine = (name: string) => `${name} is getting started on Base.`;
export { streakWords, rankSplit, dollars };

/**
 * QA item 3: both card rows are one column template, so the hero | score seam and the Activity | Highlights seam line
 * up (the left column 1.45 to 1). One column on a phone and up to 843px, where the old flex rows also stacked.
 */
const ROWS = 'grid grid-cols-1 gap-4 min-[844px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]';

/** The 12 squares of the Streak card: the grid's last 12 weeks (padded with off weeks on a short grid). Pure. */
const last12 = (grid: ProfileData['grid']): boolean[] => {
  const on = grid.slice(-12).map((g) => g.on);
  return [...Array<boolean>(12 - on.length).fill(false), ...on];
};

/** While the page's sources refresh: the photo, name and @handle at once on a flat hero, the other cards as flat shapes. */
export function BenchProfileSkeleton({
  head,
}: {
  head: Pick<PageHead, 'name' | 'handle' | 'avatar'>;
}) {
  const flat = phoneRadius(CARD_BLUE).replace('bg-s-blue text-s-on-blue', 'bg-s-panel text-s-text');
  return (
    <div className={`${PAGE_COL} flex flex-col gap-4 pb-6 pt-2`} aria-busy="true">
      <section aria-label="Profile" className={ROWS}>
        <div className={`${flat} flex min-h-[320px] min-w-0 flex-col p-6 md:p-9`}>
          <div className="flex flex-wrap items-center gap-[18px]">
            <Avatar src={head.avatar} handle={head.handle} tone="blue" className="h-16 w-16 text-[34px] md:h-[76px] md:w-[76px] md:text-[40px]" />
            <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1">
              <h1 className="ek-serif min-w-0 break-words text-[44px] leading-none tracking-[-0.01em] md:text-[60px]">{head.name}</h1>
              <span className="break-words text-[15px] text-s-muted">@{head.handle}</span>
            </div>
          </div>
        </div>
        <div aria-hidden="true" className="flex min-w-0 flex-col gap-4">
          <span className={`${flat} block h-[188px]`} />
          <span className={`${flat} block h-[150px]`} />
        </div>
      </section>
      <span aria-hidden="true" className={`${flat} block h-[360px]`} />
    </div>
  );
}

/**
 * v3.1 site Task 7 (Profile, BackedBuilder and NewBuilder boards; plan S15): two rows of cards on one column template. The blue hero
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
  // The page's own streak and grid (profileData, streak.ts); a quiet page never shows a run.
  const streak = quiet ? { streak: 0, grid: d.grid.map((g) => ({ ...g, on: false })) } : d;
  const line = d.project === null ? (site.starting ? startingLine(d.name) : noProjectLine(d.name)) : confirming ? confirmingCardLine(d.name, d.project.name) : null;
  return (
    <>
      {/* No bottom padding from md: the minimal footer's 72px is the whole gap under the cards (Profile board). */}
      <div className={`${PAGE_COL} flex flex-col gap-4 pb-6 pt-2 md:pb-0`}>
        <section aria-label="Profile" className={ROWS}>
          <HeroCard data={d} site={site} line={line} />
          <div className="flex min-w-0 flex-col gap-4">
            <ScoreCard score={quiet ? null : d.score} first={site.first} />
            {/* profileData's streak and grid (streak.ts streaksFor): the one value every surface reads. */}
            <StreakCard streak={streak.streak} weeks={last12(streak.grid)} thisWeek={quiet ? 0 : site.thisWeek} />
          </div>
        </section>
        <section aria-label="Activity and highlights" className={`${ROWS} items-start`}>
          <ActivityCard log={d.log} lastShippedAt={site.lastShippedAt} page={page} path={pagePath(d.handle)} quiet={quiet} now={now} />
          <aside className="flex min-w-0 flex-col gap-4">
            {site.token ? <TokenCard token={site.token} first={site.first} /> : null}
            <HighlightsCard items={site.highlights} />
          </aside>
        </section>
        {/* v3.1 GTM W1: every page is an install ad. One calm panel for every visitor (the owner can't be told apart),
            its pill the header's install sheet; RefMark remembers this page for counting an install that follows. */}
        <section aria-label={PROFILE_CTA_TITLE} data-ek-get-page="" className={`${phoneRadius(CARD_PANEL)} p-6 md:px-9 md:py-8`}>
          <InviteRow title={PROFILE_CTA_TITLE} text={PROFILE_CTA_TEXT} sub="text-s-muted" pill={PILL_WHITE.replace(' duration-200', ' motion-safe:duration-200')} />
        </section>
        <RefMark handle={d.handle} />
      </div>
      <Footer variant="minimal" />
    </>
  );
}
