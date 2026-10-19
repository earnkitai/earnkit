import Link from 'next/link';
import Footer from '../components/common/Footer';
import { Panel } from '../components/common/Panel';
import ChainLogo from '../components/ui/ChainLogo';
import RaisingPill from '../components/ui/RaisingPill';
import UpdateCard from '../components/ui/UpdateCard';
import { streakWords, type ProfileData } from '../../lib/earnkit/bench-data';
import type { PageHead } from '../../lib/earnkit/page-data';
import { pagePath } from '../../lib/earnkit/reserved-routes';
import Avatar from './Avatar';
import ProjectTab from './ProjectTab';
import ScoreParts from './ScoreParts';
import ScoreRing from './ScoreRing';
import ShipGrid, { shippedWords } from './ShipGrid';

export const TAB_LOG = 'Ship log';
export const TAB_PROJECT = 'Project';
export const BENCH_SOURCES_LINE =
  'Facts come from public data EarnKit checks: GitHub, the live site, packages and public transactions.';
export const LOG_EMPTY = 'Updates show here every week.';
/**
 * v2.13.1 O3: the one calm card while the one project is Confirming. Pages are public and the owner
 * can't be told from a visitor, so one neutral line for everyone.
 */
export const confirmingCardLine = (name: string, project: string) =>
  `${name} is getting ${project} on the Bench.`;
export { streakWords };

/** The photo, plain: a hairline ring, nothing else. */
function Photo({ src, handle }: { src: string | null; handle: string }) {
  return (
    <Avatar
      src={src}
      handle={handle}
      className="h-14 w-14 text-xl md:h-16 md:w-16 md:text-2xl"
    />
  );
}

/** Name and @handle (the handle alone when there is no X name). */
function Who({ name, handle }: { name: string; handle: string }) {
  return (
    <div className="min-w-0 flex-1">
      <h1 className="truncate font-funnel-display text-2xl font-medium leading-tight tracking-tight text-ek-white md:text-3xl">
        {name}
      </h1>
      {name !== `@${handle}` ? (
        <p className="mt-0.5 truncate font-funnel-sans text-base text-ek-blue-soft">
          @{handle}
        </p>
      ) : null}
    </div>
  );
}

/** "Top 4% on the Bench" as its number and its words; any other line whole. Pure. */
export const rankSplit = (
  line: string,
): { lead: string; rest: string | null } => {
  const m = /^(Top [\d.]+%|#\d+ of \d+) (on .+)$/.exec(line);
  return m ? { lead: m[1], rest: m[2] } : { lead: line, rest: null };
};

/** The rank, large: the percentile (or "#3 of 12") as the number, then each chain's line. */
function Rank({
  line,
  chains,
}: {
  line: string;
  chains: ProfileData['chainLines'];
}) {
  const { lead, rest } = rankSplit(line);
  return (
    <div className="min-w-0">
      <p className="sr-only">{line}</p>
      <p
        aria-hidden="true"
        className="font-funnel-display text-4xl font-medium leading-none tracking-tight text-ek-white tabular-nums md:text-7xl"
      >
        {lead}
      </p>
      {rest ? (
        <p
          aria-hidden="true"
          className="mt-3 font-funnel-sans text-base text-ek-blue-soft md:text-lg"
        >
          {rest}
        </p>
      ) : null}
      {chains.length > 0 ? (
        <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 font-funnel-sans text-sm text-ek-blue-light md:text-base">
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

/** While the page's sources refresh: the photo, name and @handle at once, the rest as quiet shapes. */
export function BenchProfileSkeleton({
  head,
}: {
  head: Pick<PageHead, 'name' | 'handle' | 'avatar'>;
}) {
  const bar =
    'block rounded-full bg-ek-blue-soft/10 animate-pulse motion-reduce:animate-none';
  return (
    <div className="w-full pt-4" aria-busy="true">
      <Panel className="py-8 md:py-14" label="Profile">
        <div className="flex min-w-0 items-center gap-x-4">
          <Photo src={head.avatar} handle={head.handle} />
          <Who name={head.name} handle={head.handle} />
        </div>
        <div className="mt-8 flex items-center gap-8 border-t border-ek-blue-soft/10 pt-8 md:mt-10 md:gap-12 md:pt-10">
          <span className={`${bar} h-36 w-36 shrink-0 md:h-48 md:w-48`} />
          <span className={`${bar} h-14 w-48`} />
        </div>
        <span className={`${bar} mt-8 h-40 w-full !rounded-[28px]`} />
      </Panel>
      <Panel className="mt-4 py-6 md:py-10" label={TAB_LOG}>
        <span className={`${bar} h-28 w-full !rounded-[28px]`} />
      </Panel>
    </div>
  );
}

/**
 * v2.13.1 O3: while the one project is Confirming, this card stands in for the score ring and the
 * shipping grid (no "Shipped 0" before anything could count). A soft pulse says it is under way.
 */
function ConfirmingCard({ line }: { line: string }) {
  return (
    <div className="mt-8 border-t border-ek-blue-soft/10 pt-8 md:mt-10 md:pt-10">
      <div className="flex items-start gap-4 rounded-[28px] border border-ek-blue-soft/10 px-6 py-5 md:items-center md:px-8 md:py-6">
        <span
          aria-hidden="true"
          className="relative mt-2 flex h-2.5 w-2.5 shrink-0 md:mt-0"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ek-blue-bright/50 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ek-blue-bright" />
        </span>
        <p className="min-w-0 break-words font-funnel-display text-lg font-medium leading-snug text-ek-white md:text-2xl">
          {line}
        </p>
      </div>
    </div>
  );
}

const TAB =
  'inline-flex h-10 items-center rounded-full px-5 font-funnel-sans text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ek-blue-soft';
const TAB_ON = 'bg-ek-blue-light text-ek-navy-deep';
const TAB_OFF =
  'text-ek-blue-light hover:bg-ek-blue-soft/10 hover:text-ek-white';

/**
 * v2.13 spec "Profile" (R10, R11, R12), profile-whoop layout: the header (photo, name, @handle, the
 * Raising pill), the score ring beside the rank (the percentile large, then each chain's line with
 * its logo), the four parts as rings, each in its own color (score-colors.ts), the 52-week
 * shipping grid with the streak, then two tabs as plain links: the Ship log (default; long cards,
 * newest first, the Started card last) and the Project. A quiet sources line at the end.
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
  return (
    <div className="w-full pt-4">
      <Panel className="py-8 md:py-14" label="Profile">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-4">
          <Photo src={d.avatar} handle={d.handle} />
          <Who name={d.name} handle={d.handle} />
          {d.raising ? (
            <div className="w-full sm:ml-auto sm:w-auto">
              <RaisingPill symbol={d.raising.symbol} url={d.raising.url} />
            </div>
          ) : null}
        </div>

        {confirming ? (
          <>
            {d.bench ? (
              <div className="mt-8 border-t border-ek-blue-soft/10 pt-8 md:mt-10 md:pt-10">
                <Rank line={d.bench} chains={d.chainLines} />
              </div>
            ) : null}
            <ConfirmingCard
              line={confirmingCardLine(d.name, d.project!.name)}
            />
          </>
        ) : (
          <>
            {d.bench || d.score !== null ? (
              <div className="mt-8 flex items-center gap-6 border-t border-ek-blue-soft/10 pt-8 md:mt-10 md:gap-14 md:pt-10">
                {d.score !== null ? (
                  <ScoreRing
                    score={d.score}
                    stroke={7}
                    className="h-32 w-32 md:h-52 md:w-52"
                    numberClassName="text-[2.5rem] md:text-[4.25rem]"
                  />
                ) : null}
                {d.bench ? <Rank line={d.bench} chains={d.chainLines} /> : null}
              </div>
            ) : null}
            {d.score !== null ? (
              <div className="mt-8 md:mt-10">
                <ScoreParts parts={d.parts} />
              </div>
            ) : null}
            <div className="mt-8 border-t border-ek-blue-soft/10 pt-8 md:mt-10 md:pt-10">
              <div className="max-w-3xl">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="font-funnel-display text-xl font-medium text-ek-white md:text-2xl">
                    {streak ??
                      shippedWords(
                        d.grid.filter((g) => g.on).length,
                        d.grid.length,
                      )}
                  </p>
                  {streak ? (
                    <p className="font-funnel-sans text-sm text-ek-blue-soft">
                      {shippedWords(
                        d.grid.filter((g) => g.on).length,
                        d.grid.length,
                      )}
                    </p>
                  ) : null}
                </div>
                <ShipGrid grid={d.grid} />
              </div>
            </div>
          </>
        )}
      </Panel>

      <Panel
        className="mt-4 py-6 md:py-10"
        label={tab === 'project' ? TAB_PROJECT : TAB_LOG}
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
        <div className="mt-6 md:mt-8">
          {tab === 'project' ? (
            <ProjectTab project={d.project} />
          ) : confirming || d.log.length === 0 ? (
            <p className="font-funnel-sans text-base font-light text-ek-blue-light">
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
        <p className="mt-8 max-w-3xl font-funnel-sans text-xs leading-relaxed text-ek-blue-soft md:mt-10 md:text-sm">
          {BENCH_SOURCES_LINE}
        </p>
      </Panel>
      <Footer />
    </div>
  );
}
