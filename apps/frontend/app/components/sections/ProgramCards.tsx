import ProgramRow from './ProgramRow';
import { H1, H2, LEDE, ROWS, SUB } from '../common/Panel';
import type { Tile } from '../../../lib/earnkit/landing';

/** v3 Stage 3: the Money section with no open program. */
export const PROGRAMS_EMPTY = 'No programs are open right now.';

/**
 * v2.8 Rulings 20, 21 (plan), R18, v3 Stage 3 (spec 5.6): the title, the money line ("$115K in grants and prizes
 * open", v3 Stage 2) and what it leaves out, then every open curated program as a hairline row (ProgramRow; each
 * opens its guide, where the agent is one tap away), Base first (landing.ts byRelevance). The landing (`bench`)
 * titles it "Money open now" (O5 P10); /programs keeps "Open programs" as its h1 until Task 4. No carousel, no grid.
 */
export default function ProgramCards({
  tiles,
  figure = null,
  more = null,
  heading = 'h2',
  bench = false,
}: {
  tiles: Tile[];
  /** The money line ("$115K in grants and prizes open", landing.open_text), shown under the title; null hides the line. */
  figure?: string | null;
  /** v3 Stage 2: what the total leaves out ("Plus 2 accelerators and 1 hackathon.", landing.open_more), a second muted line. */
  more?: string | null;
  /** v2.7 /programs: the rows are the page, so their heading is its h1. */
  heading?: 'h1' | 'h2';
  /** v2.13: the landing (its title). */
  bench?: boolean;
}) {
  const Heading = heading;
  // v2.13.1 O5 (P10): the list includes investments (a16z speedrun), so "Money", not "Grants".
  const title = bench ? 'Money open now' : 'Open programs';
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
