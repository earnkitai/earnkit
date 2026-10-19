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
import ShippingScore from './ShippingScore';
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

/** The photo in its orange to purple ring. */
function Photo({ src, handle }: { src: string | null; handle: string }) {
  return (
    <span className="inline-flex shrink-0 rounded-full bg-gradient-to-br from-ek-score-orange to-ek-score-purple p-[5px]">
      <Avatar
        src={src}
        handle={handle}
        className="h-16 w-16 text-2xl ring-2 ring-ek-navy-deep md:h-20 md:w-20 md:text-3xl"
      />
    </span>
  );
}

/** Name and @handle (the handle alone when there is no X name). */
function Who({ name, handle }: { name: string; handle: string }) {
  return (
    <div className="min-w-0 flex-1">
      <h1 className="truncate font-funnel-display text-2xl font-medium leading-tight tracking-tight text-ek-white md:text-4xl">
        {name}
      </h1>
      {name !== `@${handle}` ? (
        <p className="mt-0.5 truncate font-funnel-sans text-base text-ek-blue-soft md:text-lg">
          @{handle}
        </p>
      ) : null}
    </div>
  );
}

/** The panel's soft purple and orange light. */
function Glow() {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 -top-48 h-[28rem] w-[28rem] rounded-full bg-ek-score-purple/[0.10] blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-56 -left-32 h-[24rem] w-[24rem] rounded-full bg-ek-score-orange/[0.06] blur-3xl"
      />
    </>
  );
}

/** While the page's sources refresh: the photo, name and @handle at once, the rest as quiet shapes. */
export function BenchProfileSkeleton({
  head,
}: {
  head: Pick<PageHead, 'name' | 'handle' | 'avatar'>;
}) {
  const bar =
    'block rounded-full bg-ek-navy animate-pulse motion-reduce:animate-none';
  return (
    <div className="w-full pt-4" aria-busy="true">
      <Panel className="relative overflow-hidden py-8 md:py-14" label="Profile">
        <Glow />
        <div className="relative">
          <div className="flex min-w-0 items-center gap-x-5">
            <Photo src={head.avatar} handle={head.handle} />
            <Who name={head.name} handle={head.handle} />
          </div>
          <span className={`${bar} mt-6 h-5 w-48`} />
          <div className="mt-8 grid gap-8 border-t border-ek-blue-soft/10 pt-8 md:mt-10 md:grid-cols-2 md:gap-12 md:pt-10">
            <span className={`${bar} h-28 w-full !rounded-[28px]`} />
            <span className={`${bar} h-28 w-full !rounded-[28px]`} />
          </div>
        </div>
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
      <div className="flex items-start gap-4 rounded-[28px] bg-ek-navy px-6 py-5 md:items-center md:px-8 md:py-6">
        <span aria-hidden="true" className="relative mt-2 flex h-2.5 w-2.5 shrink-0 md:mt-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ek-score-orange/60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ek-score-orange" />
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
const TAB_OFF = 'text-ek-blue-light hover:bg-ek-navy hover:text-ek-white';

/**
 * v2.13 spec "Profile" (R10, R11, R12): the header (photo, name, @handle, the Raising pill, the
 * Bench line then each chain's line with its logo), the Shipping score with why, the 52-week
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
      <Panel className="relative overflow-hidden py-8 md:py-14" label="Profile">
        <Glow />
        <div className="relative">
          <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-4">
            <Photo src={d.avatar} handle={d.handle} />
            <Who name={d.name} handle={d.handle} />
            {d.raising ? (
              <div className="w-full sm:ml-auto sm:w-auto">
                <RaisingPill symbol={d.raising.symbol} url={d.raising.url} />
              </div>
            ) : null}
          </div>
          {d.line ? (
            <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 font-funnel-sans text-base text-ek-white md:mt-6 md:text-lg">
              <span className="font-medium">{d.line}</span>
              {d.chainLines.map((c) => (
                <span key={c.chain} className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="text-ek-blue-soft/60">
                    ·
                  </span>
                  <ChainLogo chain={c.chain} size={20} />
                  <span>{c.line}</span>
                </span>
              ))}
            </p>
          ) : null}

          {confirming ? (
            <ConfirmingCard line={confirmingCardLine(d.name, d.project!.name)} />
          ) : (
          <div className="mt-8 grid gap-8 border-t border-ek-blue-soft/10 pt-8 md:mt-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:gap-12 md:pt-10">
            {d.score !== null ? (
              <div className="flex min-w-0 items-center gap-6">
                <ScoreRing
                  score={d.score}
                  className="h-[6.5rem] w-[6.5rem] md:h-32 md:w-32"
                  numberClassName="text-[2rem] md:text-[2.5rem]"
                />
                <ShippingScore why={d.why} />
              </div>
            ) : null}
            <div
              className={`min-w-0 ${d.score === null ? 'md:col-span-2' : ''}`}
            >
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
          )}
        </div>
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
