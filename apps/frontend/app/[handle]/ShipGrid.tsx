import type { ProfileData } from '../../lib/earnkit/bench-data';
import { mondayOfWeek, weekLabel } from '../../lib/earnkit/weeks';

/**
 * Beside the grid: how many of its weeks had code shipped. v2.13.1 O3 fix round 1 (controller
 * ruling): "Code in", never "Shipped", so it never contradicts the score part "Shipped". Pure.
 */
export const shippedWords = (n: number, of = 52): string =>
  `Code in ${n} of the last ${of} weeks`;

/**
 * v2.13 spec "Shipping grid", v3 Stage 3 (spec 5.8): 52 squares, one per ISO week, oldest first: a hairline cell,
 * filled brand blue for a week that shipped. 13 by 4 on a phone, 26 by 2 from md. Each square's tooltip is its week
 * ("Week of Oct 12": the key goes through mondayOfWeek first, F21). Pure.
 */
export default function ShipGrid({ grid }: { grid: ProfileData['grid'] }) {
  const shipped = grid.filter((g) => g.on).length;
  return (
    <div
      role="img"
      aria-label={shippedWords(shipped, grid.length)}
      className="w-full"
    >
      <div className="grid grid-cols-[repeat(13,minmax(0,1fr))] gap-1 md:grid-cols-[repeat(26,minmax(0,1fr))] md:gap-1.5">
        {grid.map((g) => {
          const monday = mondayOfWeek(g.week);
          return (
            <span
              key={g.week}
              data-week={g.week}
              data-on={g.on}
              title={monday ? weekLabel(monday) : undefined}
              className={`block aspect-square border ${g.on ? 'border-ek-brand bg-ek-brand' : 'border-ek-line'}`}
            />
          );
        })}
      </div>
    </div>
  );
}
