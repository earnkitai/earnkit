import Link from 'next/link';
import Footer from '../components/common/Footer';
import ChainLogo from '../components/ui/ChainLogo';
import RaisingPill from '../components/ui/RaisingPill';
import UpdateCard from '../components/ui/UpdateCard';
import { streakWords, type ProfileData } from '../../lib/earnkit/bench-data';
import type { PageHead } from '../../lib/earnkit/page-data';
import { pagePath } from '../../lib/earnkit/reserved-routes';
import Avatar from './Avatar';
import ProjectTab from './ProjectTab';
import ScoreParts, { SURFACE } from './ScoreParts';
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

/** profile-whoop v2: a small uppercase label with letter-spacing, muted grey. */
const EYEBROW =
  'font-funnel-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ek-p-muted)]';
/** The page column: content starts close to the slim top bar. */
const COLUMN = 'mx-auto w-full max-w-6xl px-4 md:px-8';

/** The photo, plain: a hairline ring, nothing else. */
function Photo({ src, handle }: { src: string | null; handle: string }) {
  return (
    <Avatar
      src={src}
      handle={handle}
      className="h-11 w-11 text-base !bg-[var(--ek-p-raised)] !text-[var(--ek-p-body)] !ring-[var(--ek-p-border-strong)] md:h-12 md:w-12 md:text-lg"
    />
  );
}

/** Name and @handle (the handle alone when there is no X name). */
function Who({ name, handle }: { name: string; handle: string }) {
  return (
    <div className="min-w-0 flex-1">
      <h1 className="truncate font-funnel-display text-xl font-medium leading-tight tracking-tight text-[var(--ek-p-text)] md:text-2xl">
        {name}
      </h1>
      {name !== `@${handle}` ? (
        <p className="mt-0.5 truncate font-funnel-sans text-sm text-[var(--ek-p-muted)] md:text-base">
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
      <p aria-hidden="true" className={EYEBROW}>
        Rank
      </p>
      <p className="sr-only">{line}</p>
      <p
        aria-hidden="true"
        className="mt-3 whitespace-nowrap font-funnel-display text-[2.25rem] font-medium leading-none tracking-[-0.04em] text-[var(--ek-p-text)] tabular-nums md:text-[5.5rem]"
      >
        {lead}
      </p>
      {rest ? (
        <p
          aria-hidden="true"
          className="mt-2 font-funnel-sans text-sm text-[var(--ek-p-muted)] md:mt-3 md:text-base"
        >
          {rest}
        </p>
      ) : null}
      {chains.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 font-funnel-sans text-sm text-[var(--ek-p-body)] md:mt-6">
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
    'block rounded-full bg-[var(--ek-p-chip)] animate-pulse motion-reduce:animate-none';
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
function ConfirmingCard({ line }: { line: string }) {
  return (
    <div
      className={`mt-3 flex items-start gap-4 px-6 py-5 md:mt-4 md:items-center md:px-8 md:py-6 ${SURFACE}`}
    >
      <span
        aria-hidden="true"
        className="relative mt-2 flex h-2.5 w-2.5 shrink-0 md:mt-0"
      >
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/40 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--ek-p-text)]" />
      </span>
      <p className="min-w-0 break-words font-funnel-display text-lg font-medium leading-snug text-[var(--ek-p-text)] md:text-2xl">
        {line}
      </p>
    </div>
  );
}

const TAB =
  'inline-flex h-9 items-center rounded-full px-4 font-funnel-sans text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40';
const TAB_ON = 'bg-[var(--ek-p-chip-hover)] text-[var(--ek-p-text)]';
const TAB_OFF = 'text-[var(--ek-p-muted)] hover:bg-[var(--ek-p-chip)] hover:text-[var(--ek-p-text)]';

/**
 * v2.13 spec "Profile" (R10, R11, R12), profile-whoop v2 layout on the near-black page: the header
 * (photo, name, @handle, the Raising pill); the hero card, the total ring beside the rank (the
 * percentile large, then each chain's line with its logo); the four parts as gradient rings on their
 * own cards, each in its hue family (score-colors.ts); the 52-week shipping grid with the streak;
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
  const codeIn = shippedWords(d.grid.filter((g) => g.on).length, d.grid.length);
  return (
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
          <>
            {d.bench ? (
              <div className={`mt-5 p-6 md:mt-6 md:p-10 ${SURFACE}`}>
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
              <div
                className={`mt-5 flex items-center gap-6 p-6 md:mt-6 md:gap-14 md:p-10 ${SURFACE}`}
              >
                {d.score !== null ? (
                  <ScoreRing
                    score={d.score}
                    stroke={10}
                    track={4}
                    className="h-32 w-32 md:h-56 md:w-56"
                    numberClassName="text-[2.75rem] md:text-[5rem]"
                  />
                ) : null}
                {d.bench ? <Rank line={d.bench} chains={d.chainLines} /> : null}
              </div>
            ) : null}
            {d.score !== null ? (
              <div className="mt-3 md:mt-4">
                <ScoreParts parts={d.parts} />
              </div>
            ) : null}
            <div className={`mt-3 p-6 md:mt-4 md:p-8 ${SURFACE}`}>
              <p aria-hidden="true" className={EYEBROW}>
                Shipping
              </p>
              <div className="mb-5 mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="font-funnel-display text-2xl font-medium tracking-[-0.02em] text-[var(--ek-p-text)] md:text-3xl">
                  {streak ?? codeIn}
                </p>
                {streak ? (
                  <p className="font-funnel-sans text-sm text-[var(--ek-p-muted)]">
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
        className={`mt-3 p-5 md:mt-4 md:p-8 ${SURFACE}`}
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
        <div className="mt-5 md:mt-6">
          {tab === 'project' ? (
            <ProjectTab project={d.project} />
          ) : confirming || d.log.length === 0 ? (
            <p className="font-funnel-sans text-base font-light text-[var(--ek-p-body)]">
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
        <p className="mt-6 max-w-3xl font-funnel-sans text-xs leading-relaxed text-[var(--ek-p-muted)] md:mt-8 md:text-sm">
          {BENCH_SOURCES_LINE}
        </p>
      </section>
      <Footer />
    </div>
  );
}
