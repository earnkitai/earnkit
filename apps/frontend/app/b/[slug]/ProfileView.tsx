import { useId, type ReactNode } from 'react';
import Footer from '../../components/common/Footer';
import { Panel } from '../../components/common/Panel';
import ScoreRing from './ScoreRing';
import { SCORE_COLORS, type EmptyProfile, type ProfileData, type ProjectCard, type SourceKind } from '../../../lib/earnkit/profile-data';
import { shownUrl } from '../../../lib/earnkit/untrusted-text';

type Source = ProjectCard['sources'][number];

const NAME = 'break-words font-funnel-display text-3xl font-medium leading-tight text-ek-white md:text-5xl';

/** Small line icons per source kind (24px grid, the site's Icons.tsx stroke style). */
function KindIcon({ kind }: { kind: SourceKind }) {
  const paths: Record<SourceKind, ReactNode> = {
    github: (
      <>
        <path d="m8 8-4 4 4 4" />
        <path d="m16 8 4 4-4 4" />
      </>
    ),
    site: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5Z" />
      </>
    ),
    packages: (
      <>
        <path d="m12 3.5 7.5 4.25v8.5L12 20.5l-7.5-4.25v-8.5L12 3.5Z" />
        <path d="M4.5 7.75 12 12l7.5-4.25M12 12v8.5" />
      </>
    ),
    onchain: (
      <>
        <rect x="3.5" y="9" width="8" height="6" rx="3" />
        <rect x="12.5" y="9" width="8" height="6" rx="3" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="h-3.5 w-3.5 shrink-0 text-ek-blue-soft">
      {paths[kind]}
    </svg>
  );
}

const CHIP =
  'inline-flex h-9 max-w-full items-center gap-1.5 rounded-full bg-ek-navy-deep px-3 font-funnel-sans text-xs font-medium text-ek-blue-light ring-1 ring-inset ring-ek-blue-soft/15';

/** A verified source as a chip: a link only when shownUrl accepts its href (canonical https), else plain. */
function SourceChip({ s }: { s: Source }) {
  const url = shownUrl(s.href);
  const body = (
    <>
      <KindIcon kind={s.kind} />
      <span className="truncate">{s.label}</span>
    </>
  );
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className={`${CHIP} transition-colors hover:text-ek-white hover:ring-ek-blue-soft/40`}>
      {body}
    </a>
  ) : (
    <span className={CHIP}>{body}</span>
  );
}

function SourceChips({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="mt-5 flex flex-wrap gap-2" aria-label="Verified sources">
      {sources.map((s) => (
        <li key={`${s.kind}:${s.label}`} className="max-w-full">
          <SourceChip s={s} />
        </li>
      ))}
    </ul>
  );
}

/** An entry outcome: "won" in the score accent's gradient border, the others quiet. */
function EntryPill({ e }: { e: ProjectCard['entries'][number] }) {
  const won = e.outcome === 'won';
  return (
    <span
      className={`inline-flex min-h-8 items-center rounded-full border px-3 py-1 font-funnel-sans text-xs font-semibold ${won ? 'border-transparent text-ek-score-orange' : 'border-ek-blue-soft/20 text-ek-blue-light'}`}
      style={won ? { background: `linear-gradient(${SCORE_COLORS.panel}, ${SCORE_COLORS.panel}) padding-box, linear-gradient(90deg, ${SCORE_COLORS.from}, ${SCORE_COLORS.to}) border-box` } : undefined}
    >
      {e.program}: {e.outcome}
    </span>
  );
}

/** The 90-day trend: one line stroked with the score gradient over a faint fill. Needs two days or more. */
function Sparkline({ values }: { values: number[] }) {
  const id = `ek-spark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  if (values.length < 2) return null;
  const W = 360;
  const H = 64;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(4, hi - lo);
  const pad = 6;
  const pts = values.map((v, i) => [(W * i) / (values.length - 1), H - pad - ((v - lo) / span) * (H - 2 * pad)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `0,${H} ${line} ${W},${H}`;
  return (
    <figure className="mt-6 max-w-md">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Score over 90 days, from ${values[0]} to ${values[values.length - 1]}.`} className="block h-16 w-full overflow-visible">
        <defs>
          <linearGradient id={`${id}-line`} x1="0" y1="0" x2={W} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={SCORE_COLORS.to} />
            <stop offset="1" stopColor={SCORE_COLORS.from} />
          </linearGradient>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={SCORE_COLORS.from} stopOpacity="0.16" />
            <stop offset="1" stopColor={SCORE_COLORS.from} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${id}-fill)`} />
        <polyline points={line} fill="none" stroke={`url(#${id}-line)`} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="mt-2 font-funnel-sans text-xs text-ek-blue-soft">Last 90 days</figcaption>
    </figure>
  );
}

/** "up 6 this week" with a small arrow; nothing for no change or no week-old score. */
function Change({ n }: { n: number | null }) {
  if (!n) return null;
  const up = n > 0;
  return (
    <p className={`mt-3 inline-flex items-center gap-1.5 rounded-full bg-ek-navy px-3 py-1.5 font-funnel-sans text-sm font-medium ${up ? 'text-ek-score-orange' : 'text-ek-blue-soft'}`}>
      <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false" className={`h-3 w-3 ${up ? '' : 'rotate-180'}`}>
        <path d="M6 2 10 7.5H2L6 2Z" fill="currentColor" />
      </svg>
      {up ? 'up' : 'down'} {Math.abs(n)} this week
    </p>
  );
}

const KIND_WORDS: Record<SourceKind, string> = { github: 'GitHub', site: 'live sites', packages: 'packages', onchain: 'onchain use' };
const KIND_ORDER: SourceKind[] = ['github', 'site', 'packages', 'onchain'];
/** "Verified from GitHub, live sites and onchain use": the kinds behind the score, in plain words. */
const verifiedFrom = (sources: Source[]) => {
  const kinds = KIND_ORDER.filter((k) => sources.some((s) => s.kind === k)).map((k) => KIND_WORDS[k]);
  if (kinds.length === 0) return null;
  const list = kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}`;
  return `Verified from ${list}.`;
};

/**
 * v2.12 spec 7: the public builder profile (/b/<slug>). The hero: the name (X, else GitHub, never a
 * wallet), the score ring, the rank, the week's change and the 90-day trend, then the three
 * strongest parts with a plain meaning each. Then what they shipped: one card per verified project
 * with its numbers, announced outcomes and verified sources. Pure: everything comes from `data`.
 */
export default function ProfileView({ data }: { data: ProfileData | EmptyProfile }) {
  if (!('score' in data))
    return (
      <div className="w-full pt-4">
        <Panel className="py-12 md:py-16" label="Builder">
          <h1 className={NAME}>{data.name}</h1>
          <p className="mt-4 max-w-2xl font-funnel-sans text-base font-light text-ek-blue-light md:text-lg">{data.line}</p>
        </Panel>
        <Footer />
      </div>
    );

  const from = verifiedFrom(data.sources);
  return (
    <div className="w-full pt-4">
      <Panel className="relative overflow-hidden py-10 md:py-16" label="Score">
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full bg-ek-score-purple/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-24 h-80 w-80 rounded-full bg-ek-score-orange/[0.06] blur-3xl" />
        <div className="relative">
          <h1 className={NAME}>{data.name}</h1>
          <div className="mt-8 flex flex-col gap-8 md:mt-10 md:flex-row md:items-center md:gap-14">
            <ScoreRing score={data.score} className="h-44 w-44 md:h-56 md:w-56" />
            <div className="min-w-0 flex-1">
              {data.top_percent !== null ? (
                <p className="font-funnel-display text-2xl font-medium text-ek-white md:text-4xl">Top {data.top_percent}% of builders</p>
              ) : null}
              <Change n={data.change_7d} />
              {data.stricter_note ? <p className="mt-3 font-funnel-sans text-xs text-ek-blue-soft">{data.stricter_note}</p> : null}
              <Sparkline values={data.spark} />
            </div>
          </div>
          {data.stats.length > 0 ? (
            <dl className="mt-10 grid gap-6 border-t border-ek-blue-soft/10 pt-8 font-funnel-sans sm:grid-cols-3 md:mt-12">
              {data.stats.map((s) => (
                <div key={s.value} data-stat={s.value}>
                  <dt className="font-funnel-display text-2xl font-medium text-ek-white md:text-3xl">{s.value}</dt>
                  <dd className="mt-1 text-sm font-light text-ek-blue-soft">{s.meaning}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {from ? <p className="mt-8 font-funnel-sans text-xs text-ek-blue-soft">{from}</p> : null}
        </div>
      </Panel>

      {data.projects.length > 0 ? (
        <Panel className="mt-4 py-10 md:py-14" label="Projects">
          <h2 className="font-funnel-display text-2xl font-medium text-ek-white md:text-3xl">What they shipped</h2>
          <ul className="mt-6 grid gap-4 md:grid-cols-2">
            {data.projects.map((p) => (
              <li key={p.key} data-project={p.key} className="flex min-w-0 flex-col rounded-[32px] bg-ek-navy p-6 ring-1 ring-inset ring-ek-blue-soft/10">
                <h3 className="break-words font-funnel-display text-xl font-medium text-ek-white">{p.title}</h3>
                {p.numbers.length > 0 ? (
                  <p className="mt-2 font-funnel-display text-lg text-ek-blue-light">{p.numbers.join(' · ')}</p>
                ) : null}
                {p.entries.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {p.entries.map((e) => (
                      <EntryPill key={e.program} e={e} />
                    ))}
                  </div>
                ) : null}
                <SourceChips sources={p.sources} />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <Footer />
    </div>
  );
}
