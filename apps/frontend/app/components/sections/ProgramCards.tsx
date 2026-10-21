import Opportunities from '../landing/Opportunities';
import type { Tile } from '../../../lib/earnkit/landing';

/**
 * v3.1 site Task 6: the old programs list left with /programs (W10: it redirects to /#earn) and the landing's
 * rows became cards (Opportunities). This path stays only because copy-review.test.ts (P0-owned, read only) imports
 * it to scan the programs copy; it renders the money line and the landing's cards, so that scan reads today's
 * markup. Nothing under app/ imports it. Delete it once copy-review.test.ts moves to Opportunities.
 */
export default function ProgramCards({ tiles, figure = null }: { tiles: Tile[]; figure?: string | null; more?: string | null; heading?: 'h1' | 'h2' }) {
  return (
    <>
      {figure ? <p>{figure}</p> : null}
      <Opportunities tiles={tiles} />
    </>
  );
}
