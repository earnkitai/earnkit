import Link from 'next/link';
import Footer from '../components/common/Footer';
import ChainLogo from '../components/ui/ChainLogo';
import RaisingPill from '../components/ui/RaisingPill';
import UpdateCard from '../components/ui/UpdateCard';
import { streakWords, type ProfileData } from '../../lib/earnkit/bench-data';
import { PRIVATE_NAME, type PageHead } from '../../lib/earnkit/page-data';
import { rankSplit } from '../../lib/earnkit/rank';
import { pagePath } from '../../lib/earnkit/reserved-routes';
import Avatar from './Avatar';
import BadgeCopy from './BadgeCopy';
import { badgeMarkdown } from '../../lib/earnkit/badge';
import ProjectTab from './ProjectTab';
import ScoreRing from './ScoreRing';
import { COLUMN, SURFACE } from '../components/common/Panel';
import ShipGrid, { shippedWords } from './ShipGrid';
import InstallButton from '../components/common/InstallButton';
import { BTN_PRIMARY } from '../components/common/Button';

export const TAB_LOG = 'Ship log';
export const TAB_PROJECT = 'Project';
/** Launch ready L10: not "public data" (the App reads private repos too; a private repo shows facts only). */
export const BENCH_SOURCES_LINE = 'Every fact is checked: GitHub, the live site, packages and transactions.';
export const LOG_EMPTY = 'Updates show here every week.';
/**
 * v2.13.1 O3: the one calm card while the one project is Confirming. Pages are public and the owner
 * can't be told from a visitor, so one neutral line for everyone.
 */
export const confirmingCardLine = (name: string, project: string) =>
  // Launch ready L10: a hidden repo's name is PRIVATE_NAME, never put in the sentence as a name.
  `${name} is getting ${project === PRIVATE_NAME ? 'a private project' : project} on the leaderboard.`;
/** Launch ready L10: a page with no project yet: one calm line in place of an empty score and a 0-week grid. */
export const noProjectLine = (name: string) => `${name} has no project on the leaderboard yet.`;
/** Launch ready L7: the visitor's call to action. */
export const VISITOR_CTA = 'Want a page like this? Add EarnKit to your agent.';
export { streakWords };


/** The photo, plain: a hairline ring, nothing else. */
function Photo({ src, handle }: { src: string | null; handle: string }) {
  return (
    <Avatar
      src={src}
      handle={handle}
      className="h-11 w-11 text-base md:h-12 md:w-12 md:text-lg"
    />
  );
}

/** Name and @handle (the handle alone when there is no X name). */
function Who({ name, handle }: { name: string; handle: string }) {
  return (
    <div className="min-w-0 flex-1">
      <h1 className="break-words font-funnel-display text-xl font-medium leading-tight tracking-tight text-ek-text md:text-2xl">
        {name}
      </h1>
      {name !== `@${handle}` ? (
        <p className="mt-0.5 break-words font-funnel-sans text-sm text-ek-muted md:text-base">
          @{handle}
        </p>
      ) : null}
    </div>
  );
}

export { rankSplit };

/**
 * The rank, large: the percentile (or "#3") as the number, then its words, the why sentence, the weekly
 * target (launch ready L5) and each chain's line. Screen readers get the one score line (R16c) and the why.
 */
function Rank({
  line,
  scoreLine,
  why,
  target,
  chains,
}: {
  line: string;
  scoreLine: string | null;
  why: string | null;
  target: string | null;
  chains: ProfileData['chainLines'];
}) {
  const { lead, rest } = rankSplit(line);
  return (
    <div className="min-w-0">
      <p className="sr-only">{scoreLine ?? line}</p>
      <p
        aria-hidden="true"
        className="whitespace-nowrap font-funnel-display text-[2.25rem] font-medium leading-none tracking-[-0.04em] text-ek-text tabular-nums md:text-[5.5rem]"
      >
        {lead}
      </p>
      {rest ? (
        <p
          aria-hidden="true"
          className="mt-2 font-funnel-sans text-sm text-ek-muted md:mt-3 md:text-base"
        >
          {rest}
        </p>
      ) : null}
      {why ? (
        <p className="mt-4 max-w-md font-funnel-sans text-sm leading-relaxed text-ek-body md:mt-5 md:text-base">
          {why}
        </p>
      ) : null}
      {target ? (
        <p className="mt-2 max-w-md font-funnel-sans text-sm font-medium leading-relaxed text-ek-text md:text-base">
          {target}
        </p>
      ) : null}
      {chains.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 font-funnel-sans text-sm text-ek-body md:mt-6">
          {chains.map((c) => (
            <li key={c.chain} className="inline-flex items-center gap-2">
              <ChainLogo chain={c.chain} size={18} />
              <span>{c.line}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Scoring and clarity R3: Originality, one small line under the Shipping ring (never a second ring, never ranked). */
function Originality({ value }: { value: number }) {
  return (
    <p className="whitespace-nowrap font-funnel-sans text-sm text-ek-muted md:text-base">
      Originality <span className="font-medium tabular-nums text-ek-text">{value}</span>
    </p>
  );
}

/** While the page's sources refresh: the photo, name and @handle at once, the rest as quiet shapes. */
export function BenchProfileSkeleton({
  head,
}: {
  head: Pick<PageHead, 'name' | 'handle' | 'avatar'>;
}) {
  const bar =
    'block rounded-full bg-ek-chip animate-pulse motion-reduce:animate-none';
  return (
    <div className={`${COLUMN} pt-5 md:pt-8`} aria-busy="true">
      <section aria-label="Profile">
        <div className="flex min-w-0 items-center gap-x-3">
          <Photo src={head.avatar} handle={head.handle} />
          <Who name={head.name} handle={head.handle} />
        </div>
        <div
          className={`mt-5 flex items-center gap-8 p-6 md:mt-6 md:gap-14 md:p-10 ${SURFACE}`}
        >
          <span className={`${bar} h-36 w-36 shrink-0 md:h-56 md:w-56`} />
          <span className={`${bar} h-16 w-48`} />
        </div>
        <span className={`${bar} mt-3 h-44 w-full !rounded-[24px] md:mt-4`} />
      </section>
      <section aria-label={TAB_LOG} className="mt-3 md:mt-4">
        <span className={`${bar} h-28 w-full !rounded-[24px]`} />
      </section>
    </div>
  );
}

/**
 * v2.13.1 O3: while the one project is Confirming, this card stands in for the score ring and the
 * shipping grid (no "Shipped 0" before anything could count). A soft pulse says it is under way.
 */
function ConfirmingCard({ line, pulse = true }: { line: string; pulse?: boolean }) {
  return (
    <div
      className={`mt-3 flex items-start gap-4 px-6 py-5 md:mt-4 md:items-center md:px-8 md:py-6 ${SURFACE}`}
    >
      {pulse ? (
        <span
          aria-hidden="true"
          className="relative mt-2 flex h-2.5 w-2.5 shrink-0 md:mt-0"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/40 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ek-text" />
        </span>
      ) : null}
      <p className="min-w-0 break-words font-funnel-display text-lg font-medium leading-snug text-ek-text md:text-2xl">
        {line}
      </p>
    </div>
  );
}

const TAB =
  'inline-flex h-11 items-center rounded-full px-4 font-funnel-sans text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ek-blue-soft md:h-9';
const TAB_ON = 'bg-ek-chip-hover text-ek-text';
const TAB_OFF = 'text-ek-muted hover:bg-ek-chip hover:text-ek-text';

/**
 * v2.13 spec "Profile" (R10, R11, R12), profile-whoop v2 layout on the near-black page: the header
 * (photo, name, @handle, the Raising pill); the hero card, the one Shipping ring (0 to 100) beside
 * the rank (the percentile or "#N" large, its words, the why sentence, then each chain's line with
 * its logo; scoring and clarity: no per-part rings, one score); the 52-week shipping grid with the streak;
 * then two tabs as plain links: the Ship log (default; long cards, newest first, the Started card
 * last) and the Project. A quiet sources line at the end.
 * v2.13.1 O3: while the one project is Confirming, one calm card in place of the score and the grid,
 * and an empty Ship log. Pure.
 */
export default function BenchProfileView({
  data,
  tab,
}: {
  data: ProfileData;
  tab: 'log' | 'project';
}) {
  const d = data;
  const path = pagePath(d.handle);
  const streak = streakWords(d.streak);
  const confirming = d.project !== null && !d.project.confirmed;
  // Launch ready L10: no project and no week with code: nothing to chart yet.
  const empty = d.project === null && d.score === null && !d.grid.some((g) => g.on);
  const codeIn = shippedWords(d.grid.filter((g) => g.on).length, d.grid.length);
  return (
    <>
    <div className={`${COLUMN} pt-5 md:pt-8`}>
      <section aria-label="Profile">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-3">
          <Photo src={d.avatar} handle={d.handle} />
          <Who name={d.name} handle={d.handle} />
          {d.raising ? (
            <div className="w-full sm:ml-auto sm:w-auto">
              <RaisingPill symbol={d.raising.symbol} url={d.raising.url} />
            </div>
          ) : null}
        </div>

        {confirming ? (
          // R10: never a rank while the project isn't counted yet (rankLines is empty then too).
          <ConfirmingCard line={confirmingCardLine(d.name, d.project!.name)} />
        ) : empty ? (
          <ConfirmingCard line={noProjectLine(d.name)} pulse={false} />
        ) : (
          <>
            {d.bench || d.score !== null ? (
              <div
                className={`mt-5 flex items-center gap-6 p-6 md:mt-6 md:gap-14 md:p-10 ${SURFACE}`}
              >
                {d.score !== null ? (
                  <div className="flex shrink-0 flex-col items-center gap-3 md:gap-4">
                    <ScoreRing
                      score={d.score}
                      label={`Shipping ${d.score} of 100`}
                      caption="Shipping"
                      stroke={10}
                      track={4}
                      className="h-32 w-32 md:h-56 md:w-56"
                      numberClassName="text-[2.75rem] md:text-[5rem]"
                    />
                    {d.originality !== null ? <Originality value={d.originality} /> : null}
                  </div>
                ) : null}
                {d.bench ? <Rank line={d.bench} scoreLine={d.line} why={d.why} target={d.target} chains={d.chainLines} /> : null}
              </div>
            ) : null}
            <div className={`mt-3 p-6 md:mt-4 md:p-8 ${SURFACE}`}>
              <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="font-funnel-display text-2xl font-medium tracking-[-0.02em] text-ek-text md:text-3xl">
                  {streak ?? codeIn}
                </p>
                {streak ? (
                  <p className="font-funnel-sans text-sm text-ek-muted">
                    {codeIn}
                  </p>
                ) : null}
              </div>
              <div className="max-w-3xl">
                <ShipGrid grid={d.grid} />
              </div>
            </div>
          </>
        )}
      </section>

      <section
        aria-label={tab === 'project' ? TAB_PROJECT : TAB_LOG}
        className="mt-8 md:mt-10"
      >
        <nav aria-label="Tabs" className="-mx-1 flex gap-1">
          <Link
            href={path}
            aria-current={tab === 'log' ? 'page' : undefined}
            className={`${TAB} ${tab === 'log' ? TAB_ON : TAB_OFF}`}
          >
            {TAB_LOG}
          </Link>
          <Link
            href={`${path}?tab=project`}
            aria-current={tab === 'project' ? 'page' : undefined}
            className={`${TAB} ${tab === 'project' ? TAB_ON : TAB_OFF}`}
          >
            {TAB_PROJECT}
          </Link>
        </nav>
        <div className="mt-4">
          {tab === 'project' ? (
            <div className={`p-5 md:p-8 ${SURFACE}`}>
              <ProjectTab project={d.project} />
            </div>
          ) : confirming || d.log.length === 0 ? (
            <p className={`p-5 font-funnel-sans text-base text-ek-body md:p-8 ${SURFACE}`}>
              {LOG_EMPTY}
            </p>
          ) : (
            <ol className="space-y-3">
              {d.log.map((c) => (
                <li key={`${c.week}-${c.started ? 's' : 'u'}`}>
                  <UpdateCard card={c} shape="long" showPerson={false} />
                </li>
              ))}
            </ol>
          )}
        </div>
        {/* Launch ready L7: a visitor's first call to action on a builder's page. */}
        <div className={`mt-8 flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between md:p-8 ${SURFACE}`}>
          <p className="font-funnel-display text-lg font-medium leading-snug text-ek-text md:text-xl">{VISITOR_CTA}</p>
          <InstallButton className={BTN_PRIMARY} />
        </div>
        <p className="mt-4 max-w-3xl font-funnel-sans text-xs leading-relaxed text-ek-muted md:text-sm">
          {BENCH_SOURCES_LINE}
        </p>
        {/* Launch ready L10: the badge only once there is a rank to show (else it reads "not ranked"). */}
        {d.bench && !confirming ? <BadgeCopy markdown={badgeMarkdown(d.handle)} /> : null}
      </section>
    </div>
    <Footer />
    </>
  );
}
