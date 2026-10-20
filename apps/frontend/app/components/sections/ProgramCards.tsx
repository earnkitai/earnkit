import ProgramRow from './ProgramRow';
import { H1, H2, LEDE, ROWS, SUB } from '../common/Panel';
import type { Tile } from '../../../lib/earnkit/landing';

/** v2.13.1 O5 (P10), v3 Stage 3 Task 4: the one title, on the landing (h2) and /programs (h1): the list includes investments, so "Money". */
export const PROGRAMS_TITLE = 'Money open now';
/** v3 Stage 3: the Money section with no open program. */
export const PROGRAMS_EMPTY = 'No programs are open right now.';

/**
 * v2.8 Rulings 20, 21 (plan), R18, v3 Stage 3 (spec 5.6): the title, the money line ("$115K in grants and prizes
 * open", v3 Stage 2) and what it leaves out, then every open curated program as a hairline row (ProgramRow; each
 * opens its guide, where the agent is one tap away), Base first (landing.ts byRelevance). No carousel, no grid.
 */
export default function ProgramCards({
  tiles,
  figure = null,
  more = null,
  heading = 'h2',
}: {
  tiles: Tile[];
  /** The money line ("$115K in grants and prizes open", landing.open_text), shown under the title; null hides the line. */
  figure?: string | null;
  /** v3 Stage 2: what the total leaves out ("Plus 2 accelerators and 1 hackathon.", landing.open_more), a second muted line. */
  more?: string | null;
  /** v2.7 /programs: the rows are the page, so their heading is its h1. */
  heading?: 'h1' | 'h2';
  /** Kept for callers: the landing and /programs now share PROGRAMS_TITLE, so this changes nothing. */
  bench?: boolean;
}) {
  const Heading = heading;
  const title = PROGRAMS_TITLE;
  return (
    <section id="open-programs" aria-label={title}>
      <Heading className={heading === 'h1' ? H1 : H2}>{title}</Heading>
      {figure ? <p className={heading === 'h1' ? LEDE : SUB}>{figure}</p> : null}
      {figure && more ? <p className="mt-1 font-funnel-sans text-sm text-ek-muted">{more}</p> : null}
      {tiles.length > 0 ? (
        <ul aria-label={title} className={`${ROWS} mt-6 md:mt-8`}>
          {tiles.map((t) => (
            <li key={t.id}>
              <ProgramRow tile={t} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={SUB}>{PROGRAMS_EMPTY}</p>
      )}
    </section>
  );
}
