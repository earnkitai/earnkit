import { NONE_CONFIRMED, NOTHING_YET, NOT_CONFIRMED, NOT_TRACKED, type PageCard } from '../../lib/earnkit/page-data';

const CARD = 'flex min-w-0 flex-col rounded-[28px] bg-ek-navy/40 p-6 ring-1 ring-inset ring-ek-blue-soft/10 md:p-7';
const GRID = 'grid gap-3 md:grid-cols-2 md:gap-4';

/** The link as people read it: the host and any path, no scheme, no www, no trailing slash. Pure. */
const shown = (url: string) => {
  const u = new URL(url);
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');
  return `${u.host.replace(/^www\./, '')}${path}`;
};

function Arrow() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false" className="h-3 w-3 shrink-0 transition-transform group-hover:-translate-y-px group-hover:translate-x-px">
      <path d="M3.5 8.5 8.5 3.5M4.5 3.5h4v4" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Card({ c, label }: { c: PageCard; label: boolean }) {
  const numbers = c.people !== null || c.money !== null;
  return (
    <li data-project={c.key} className={CARD}>
      <h3 className="break-words font-funnel-display text-xl font-medium leading-snug text-ek-white md:text-2xl">{c.name}</h3>
      {c.what ? <p className="mt-1.5 line-clamp-3 break-words font-funnel-sans text-[15px] font-light leading-relaxed text-ek-blue-light">{c.what}</p> : null}
      {numbers ? (
        <p className="mt-5 flex flex-wrap gap-x-5 gap-y-1 font-funnel-sans text-[15px] text-ek-blue-light">
          {c.people !== null ? (
            <span>
              <span className="font-funnel-display text-lg font-medium tabular-nums text-ek-white">{c.people.toLocaleString('en-US')}</span>{' '}
              {c.people === 1 ? 'person uses it' : 'people use it'}
            </span>
          ) : null}
          {c.money !== null ? (
            <span>
              <span className="font-funnel-display text-lg font-medium tabular-nums text-ek-white">{c.money}</span> earned
            </span>
          ) : null}
        </p>
      ) : null}
      {c.programs.length > 0 ? (
        <ul className="mt-4 space-y-1 font-funnel-sans text-sm">
          {c.programs.map((p) => (
            <li key={p.title} className={`break-words ${p.won ? 'font-medium text-ek-score-orange' : 'text-ek-blue-light'}`}>
              {p.won ? 'Won' : 'Entered'} {p.title}
            </li>
          ))}
        </ul>
      ) : null}
      {c.link || (label && !c.confirmed) || !c.tracked ? (
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-6 font-funnel-sans text-sm">
          {c.link ? (
            <a href={c.link} target="_blank" rel="noopener noreferrer" className="group inline-flex min-h-11 min-w-0 max-w-full items-center gap-1.5 text-ek-blue-soft underline-offset-4 transition-colors hover:text-ek-white hover:underline">
              <span className="truncate">{shown(c.link)}</span>
              <Arrow />
            </a>
          ) : (
            <span />
          )}
          <span className="flex flex-col items-end gap-0.5 text-ek-blue-soft">
            {label && !c.confirmed ? <span>{NOT_CONFIRMED}</span> : null}
            {!c.tracked ? <span>{NOT_TRACKED}</span> : null}
          </span>
        </div>
      ) : null}
    </li>
  );
}

/** A card's shape while the readings finish: the same box, no words. */
function Skeleton() {
  return (
    <li data-skeleton="card" aria-hidden="true" className={`${CARD} min-h-[184px] animate-pulse motion-reduce:animate-none`}>
      <span className="block h-6 w-2/5 rounded-full bg-ek-blue-deep/70" />
      <span className="mt-3 block h-4 w-4/5 rounded-full bg-ek-blue-deep/50" />
      <span className="mt-6 block h-5 w-1/3 rounded-full bg-ek-blue-deep/50" />
      <span className="mt-auto block h-4 w-1/4 rounded-full bg-ek-blue-deep/40" />
    </li>
  );
}

/**
 * v2.12.1 spec "Profile": the projects as plain cards (name, a few words, the link, people using it
 * and money earned when measured, programs entered and won), "Not yet confirmed" and "Not tracked
 * right now" quietly. `null` while the readings finish: three skeleton cards. Pure.
 */
export default function ProjectCards({ cards }: { cards: PageCard[] | null }) {
  if (cards === null)
    return (
      <ul className={GRID} aria-busy="true" aria-label="Loading projects">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </ul>
    );
  if (cards.length === 0) return <p className="font-funnel-sans text-base font-light text-ek-blue-light">{NOTHING_YET}</p>;
  // Every card not yet confirmed: one quiet line for all of them, not the same label on each.
  const none = cards.every((c) => !c.confirmed);
  return (
    <>
      {none ? <p className="-mt-2 mb-5 font-funnel-sans text-sm font-light text-ek-blue-soft md:mb-6 md:text-base">{NONE_CONFIRMED}</p> : null}
      <ul className={GRID}>
        {cards.map((c) => (
          <Card key={c.key} c={c} label={!none} />
        ))}
      </ul>
    </>
  );
}
