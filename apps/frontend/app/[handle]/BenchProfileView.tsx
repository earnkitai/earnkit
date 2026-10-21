import Link from 'next/link';
import Footer from '../components/common/Footer';
import ChainLogo from '../components/ui/ChainLogo';
import UpdateCard from '../components/ui/UpdateCard';
import { dollars, streakWords, type ProfileData } from '../../lib/earnkit/bench-data';
import { PRIVATE_NAME, type PageHead } from '../../lib/earnkit/page-data';
import { rankSplit } from '../../lib/earnkit/rank';
import { POINTS_PAGE_LINE } from '../../lib/earnkit/points';
import { pagePath } from '../../lib/earnkit/reserved-routes';
import Avatar from './Avatar';
import BadgeCopy from './BadgeCopy';
import { badgeMarkdown } from '../../lib/earnkit/badge';
import MoneyTab from './MoneyTab';
import ProjectTab from './ProjectTab';
import ScoreRing from './ScoreRing';
import ShareButton from './ShareButton';
import { COLUMN, LEDE, NUM, ROWS } from '../components/common/Panel';
import ShipGrid, { shippedWords } from './ShipGrid';
import InstallButton from '../components/common/InstallButton';
import { BTN_PRIMARY, BTN_SECONDARY } from '../components/common/Button';

export const TAB_LOG = 'Ship log';
export const TAB_PROJECT = 'Project';
/** v3 Stage 3 (spec 5.6): the Money tab, at ?tab=money. */
export const TAB_MONEY = 'Money';
export type ProfileTab = 'log' | 'project' | 'money';
/** Launch ready L10: not "public data" (the App reads private repos too; a private repo shows facts only). */
export const BENCH_SOURCES_LINE = 'Every fact is checked: GitHub, the live site, packages and transactions.';
export const LOG_EMPTY = 'Updates show here every week.';
/**
 * v2.13.1 O3: the one calm line while the one project is Confirming. Pages are public and the owner
 * can't be told from a visitor, so one neutral line for everyone.
 */
export const confirmingCardLine = (name: string, project: string) =>
  // Launch ready L10: a hidden repo's name is PRIVATE_NAME, never put in the sentence as a name.
  `${name} is getting ${project === PRIVATE_NAME ? 'a private project' : project} on the leaderboard.`;
/** Launch ready L10: a page with no project yet: one calm line in place of an empty score and a 0-week grid. */
export const noProjectLine = (name: string) => `${name} has no project on the leaderboard yet.`;
/** Launch ready L7: the visitor's call to action. */
export const VISITOR_CTA = 'Want your own page? It is free.';
/** The three captions; the rank's is its own words ("of 40 builders") when it has them. */
export const CAPTION_SHIPPING = 'Shipping';
export const CAPTION_RANK = 'Rank';
export const CAPTION_EARNED = 'Earned';
/** A number not there yet (confirming, no project, unranked). */
export const DASH = '–';
export { streakWords, rankSplit, dollars };

/** v3 Stage 2: the small line under Earned, the fees still in the FeeLocker (never summed into Earned). Pure. */
export const waitingLine = (usd: number) => `and ${dollars(usd)} waiting`;

/** The name: the H1 shape at 40px (32px on a phone), so it sits with a 56px photo. */
const NAME = 'min-w-0 break-words font-funnel-display text-[2rem] font-medium leading-[1.05] tracking-[-0.03em] text-ek-text md:text-[2.5rem]';
/** A big number in the row: 32px on a phone (three in a 390px column), 48px from md. */
const BIG = `${NUM} whitespace-nowrap text-[2rem] font-medium leading-none text-ek-text md:text-[3rem]`;
const BIG_MUTED = `${NUM} text-[2rem] font-medium leading-none text-ek-muted md:text-[3rem]`;
const CAPTION = 'mt-2 font-funnel-sans text-sm text-ek-muted md:text-base';
const CELL = 'flex min-w-0 flex-col justify-end';
const NUMBERS = 'mt-8 grid grid-cols-3 gap-4 border-b border-t border-ek-line py-6 md:mt-10 md:gap-8 md:py-8';
const QUIET = 'font-funnel-sans text-sm text-ek-muted md:text-base';

/** The photo: 56px, a hairline ring, nothing else. */
function Photo({ src, handle }: { src: string | null; handle: string }) {
  return <Avatar src={src} handle={handle} className="h-14 w-14 text-xl" />;
}

/** Name and @handle (the handle alone when there is no X name). */
function Who({ name, handle }: { name: string; handle: string }) {
  return (
    <div className="min-w-0 flex-1">
      <h1 className={NAME}>{name}</h1>
      {name !== `@${handle}` ? (
        <p className="mt-1 break-words font-funnel-sans text-base text-ek-muted md:text-lg">@{handle}</p>
      ) : null}
    </div>
  );
}

/** A cell of the row whose number is not there yet: a muted dash and its caption. */
function Dash({ caption }: { caption: string }) {
  return (
    <li className={CELL}>
      <p aria-hidden="true" className={BIG_MUTED}>{DASH}</p>
      <p className={CAPTION}>{caption}</p>
    </li>
  );
}

/**
 * v3 Stage 3 (spec 5.6, 5.8): the three numbers: the Shipping ring (96px, the number inside), the rank (R16c: the
 * score line to screen readers; "#3" or "Top 4%" large, its words under) and Earned (v3 Stage 2: money that reached
 * the builder, "$0" when nothing yet, "and $X waiting" under it). A number not there yet is a dash; Earned's figure
 * only while ranked. v3.1 R16: a ranked page under RANK_MIN_POOL shows the dash for Rank (bench null, rankListed).
 */
function Numbers({ d }: { d: ProfileData }) {
  const ranked = d.rankListed;
  const rank = d.bench ? rankSplit(d.bench) : null;
  return (
    <ul data-ek-numbers="" className={NUMBERS}>
      {d.score !== null ? (
        <li className={CELL}>
          <ScoreRing
            score={d.score}
            label={`Shipping ${d.score} of 100`}
            caption={null}
            stroke={10}
            track={4}
            className="h-24 w-24"
            numberClassName="text-[1.75rem] md:text-[2rem]"
          />
          <p className={CAPTION}>{CAPTION_SHIPPING}</p>
        </li>
      ) : (
        <Dash caption={CAPTION_SHIPPING} />
      )}
      {rank ? (
        <li className={CELL}>
          <p className="sr-only">{d.line ?? d.bench}</p>
          <p aria-hidden="true" className={BIG}>{rank.lead}</p>
          <p aria-hidden="true" className={CAPTION}>{rank.rest ?? CAPTION_RANK}</p>
        </li>
      ) : (
        <Dash caption={CAPTION_RANK} />
      )}
      {ranked ? (
        <li className={CELL}>
          <p data-ek-earned="" className={BIG}>{dollars(d.earned.paid_usd)}</p>
          <p className={CAPTION}>{CAPTION_EARNED}</p>
          {d.earned.waiting_usd >= 1 ? <p className="mt-1 font-funnel-sans text-xs text-ek-muted md:text-sm">{waitingLine(d.earned.waiting_usd)}</p> : null}
        </li>
      ) : (
        <Dash caption={CAPTION_EARNED} />
      )}
    </ul>
  );
}

/**
 * Under the numbers, quiet: the why sentence and the weekly target (launch ready L5, in the page's voice) as one
 * line, each chain's line with its logo, Originality (scoring and clarity R3: never a ring, never ranked) and the
 * points with what they are (v3 Stage 1).
 */
function Under({ d, points }: { d: ProfileData; points: boolean }) {
  const line = [d.why, d.target].filter((x): x is string => Boolean(x)).join(' ');
  return (
    <div className="mt-5 md:mt-6">
      {line ? <p className="max-w-[36rem] font-funnel-sans text-base text-ek-muted md:text-lg">{line}</p> : null}
      {d.chainLines.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-funnel-sans text-sm text-ek-body md:text-base">
          {d.chainLines.map((c) => (
            <li key={c.chain} className="inline-flex items-center gap-2">
              <ChainLogo chain={c.chain} size={18} />
              <span>{c.line}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {d.originality !== null ? (
        <p className={`mt-3 ${QUIET}`}>
          Originality <span className="font-medium tabular-nums text-ek-text">{d.originality}</span>
        </p>
      ) : null}
      {points && d.points > 0 ? (
        <p className={`mt-1 max-w-[36rem] ${QUIET}`}>
          <span className="font-medium tabular-nums text-ek-text">{d.points.toLocaleString('en-US')} points.</span> {POINTS_PAGE_LINE}
        </p>
      ) : null}
    </div>
  );
}

/** While the page's sources refresh: the photo, name and @handle at once, the rest as quiet flat shapes. */
export function BenchProfileSkeleton({
  head,
}: {
  head: Pick<PageHead, 'name' | 'handle' | 'avatar'>;
}) {
  const bar = 'block bg-ek-chip';
  return (
    <div className={`${COLUMN} pt-6 md:pt-10`} aria-busy="true">
      <section aria-label="Profile">
        <div className="flex min-w-0 items-center gap-x-4">
          <Photo src={head.avatar} handle={head.handle} />
          <Who name={head.name} handle={head.handle} />
        </div>
        <ul aria-hidden="true" className={NUMBERS}>
          <li><span className={`${bar} h-24 w-24 rounded-full`} /></li>
          <li className={CELL}><span className={`${bar} h-10 w-20`} /></li>
          <li className={CELL}><span className={`${bar} h-10 w-24`} /></li>
        </ul>
        <span className={`${bar} mt-8 h-24 w-full md:mt-10 md:h-20`} />
      </section>
      <section aria-label={TAB_LOG} className="mt-10 md:mt-12">
        <span className={`${bar} h-28 w-full`} />
      </section>
    </div>
  );
}

const TAB =
  '-mb-px inline-flex min-h-11 items-center border-b-2 px-0.5 font-funnel-sans text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ek-accent';
const TAB_ON = 'border-ek-text text-ek-text';
const TAB_OFF = 'border-transparent text-ek-muted hover:text-ek-text';
/** The Ship log with no row yet: one line as a row under the tab rail (the rail is its top hairline). */
const EMPTY_ROW = 'border-b border-ek-line py-4 font-funnel-sans text-base text-ek-body md:py-5';

/**
 * v2.13 spec "Profile" (R10, R11, R12), v3 Stage 3 (spec 5.6, 5.8) on the flat black page: the header row (photo,
 * name, @handle, Share, and the Back button while backing is open); the three numbers (Shipping ring, rank, Earned)
 * between two hairlines; the why and target, chain lines, Originality and points as quiet lines; the 52-week grid
 * with the streak and "Code in N of the last 52 weeks" under it; then three tabs as plain links: the Ship log
 * (default; rows newest first, the Started row last), the Project and Money. The visitor's one action, the sources
 * line and the badge close the page. v2.13.1 O3: while the one project is Confirming (or there is no project), one
 * calm line, the numbers as dashes, no grid, an empty Ship log. Pure.
 */
export default function BenchProfileView({
  data,
  tab,
}: {
  data: ProfileData;
  tab: ProfileTab;
}) {
  const d = data;
  const path = pagePath(d.handle);
  const streak = streakWords(d.streak);
  const confirming = d.project !== null && !d.project.confirmed;
  // Launch ready L10: no project and no week with code: nothing to chart yet.
  const empty = d.project === null && d.score === null && !d.grid.some((g) => g.on);
  const codeIn = shippedWords(d.grid.filter((g) => g.on).length, d.grid.length);
  const quiet = confirming || empty;
  const tabs: [ProfileTab, string, string][] = [
    ['log', TAB_LOG, path],
    ['project', TAB_PROJECT, `${path}?tab=project`],
    ['money', TAB_MONEY, `${path}?tab=money`],
  ];
  return (
    <>
    <div className={`${COLUMN} pt-6 md:pt-10`}>
      <section aria-label="Profile">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-4">
          <Photo src={d.avatar} handle={d.handle} />
          <Who name={d.name} handle={d.handle} />
          <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
            <ShareButton handle={d.handle} />
            {/* v3 Stage 2 (spec 5.3 Route 2): backing open: the one secondary action beside Share, to the coin's tokens.fun page. */}
            {d.backing && d.project ? (
              <a href={d.backing.url} target="_blank" rel="noopener noreferrer" data-ek-back="" className={`${BTN_SECONDARY} !whitespace-normal text-left`}>
                {`Back ${d.project.name}`}
              </a>
            ) : null}
          </div>
        </div>

        {quiet ? (
          // R10: never a rank while the project isn't counted yet (rankLines is empty then too); nor a stale line.
          <>
            <p className={LEDE}>{confirming ? confirmingCardLine(d.name, d.project!.name) : noProjectLine(d.name)}</p>
            <Numbers d={{ ...d, bench: null, rankListed: false, line: null, score: null, chainLines: [] }} />
          </>
        ) : (
          <>
            <Numbers d={d} />
            {/* The Money tab carries the points line itself, so the page says it once per view. */}
            <Under d={d} points={tab !== 'money'} />
            <div className="mt-8 md:mt-10">
              <ShipGrid grid={d.grid} />
              <div className={`mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 ${QUIET}`}>
                {streak ? <p className="font-medium text-ek-text">{streak}</p> : null}
                <p>{codeIn}</p>
              </div>
            </div>
          </>
        )}
      </section>

      <section
        aria-label={tabs.find(([t]) => t === tab)?.[1] ?? TAB_LOG}
        className="mt-10 md:mt-12"
      >
        <nav aria-label="Tabs" className="flex gap-6 border-b border-ek-line">
          {tabs.map(([t, label, href]) => (
            <Link
              key={t}
              href={href}
              aria-current={tab === t ? 'page' : undefined}
              className={`${TAB} ${tab === t ? TAB_ON : TAB_OFF}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        {/* The log's rows hang off the tab rail (the rail is their first hairline); the other tabs open with a title. */}
        <div className={tab === 'log' ? '' : 'mt-6 md:mt-8'}>
          {tab === 'project' ? (
            <ProjectTab project={d.project} />
          ) : tab === 'money' ? (
            <MoneyTab money={d.money} />
          ) : confirming || d.log.length === 0 ? (
            <p className={EMPTY_ROW}>{LOG_EMPTY}</p>
          ) : (
            <ol className={`${ROWS} [&>li:first-child>article]:border-t-0`}>
              {d.log.map((c) => (
                <li key={`${c.week}-${c.started ? 's' : 'u'}`}>
                  <UpdateCard card={c} shape="long" showPerson={false} />
                </li>
              ))}
            </ol>
          )}
        </div>
        {/* Launch ready L7: a visitor's one action on a builder's page, as a row near the end (a section's distance after the tab). */}
        <div className="mt-14 flex flex-col items-start gap-4 border-b border-t border-ek-line py-6 sm:flex-row sm:items-center sm:justify-between md:mt-20 md:py-8">
          <p className="font-funnel-display text-xl font-medium leading-snug text-ek-text md:text-2xl">{VISITOR_CTA}</p>
          <InstallButton className={BTN_PRIMARY} />
        </div>
        <p className="mt-4 max-w-[36rem] font-funnel-sans text-xs leading-relaxed text-ek-muted md:text-sm">
          {BENCH_SOURCES_LINE}
        </p>
        {/* Launch ready L10: the badge only once there is a rank to show (else it reads "not ranked"). */}
        {d.bench && !confirming ? <BadgeCopy markdown={badgeMarkdown(d.handle)} handle={d.handle} /> : null}
      </section>
    </div>
    <Footer />
    </>
  );
}
