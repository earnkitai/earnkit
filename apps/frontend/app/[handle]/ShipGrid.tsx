import type { ProfileData } from '../../lib/earnkit/bench-data';
import { mondayOfWeek, weekLabel } from '../../lib/earnkit/weeks';

/** Beside the grid: how many of its weeks shipped. Pure. */
export const shippedWords = (n: number, of = 52): string =>
  `Shipped ${n} of the last ${of} weeks`;

/**
 * v2.13 spec "Shipping grid": 52 squares, one per ISO week, oldest first; filled for a week that
 * shipped. 13 by 4 on a phone, 26 by 2 from md. Each square's tooltip is its week ("Week of Oct 12":
 * the key goes through mondayOfWeek first, F21). Pure.
 */
export default function ShipGrid({ grid }: { grid: ProfileData['grid'] }) {
  const shipped = grid.filter((g) => g.on).length;
  return (
    <div
      role="img"
      aria-label={shippedWords(shipped, grid.length)}
      className="w-full"
    >
      <div className="grid grid-cols-[repeat(13,minmax(0,1fr))] gap-1.5 md:grid-cols-[repeat(26,minmax(0,1fr))] md:gap-[5px]">
        {grid.map((g) => {
          const monday = mondayOfWeek(g.week);
          return (
            <span
              key={g.week}
              data-week={g.week}
              data-on={g.on}
              title={monday ? weekLabel(monday) : undefined}
              className={`block aspect-square rounded-[4px] ${g.on ? 'bg-ek-score-orange shadow-[0_0_8px_rgba(255,122,26,0.35)]' : 'bg-ek-navy'}`}
            />
          );
        })}
      </div>
    </div>
  );
}
