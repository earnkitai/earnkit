import type { ProfileData } from '../../lib/earnkit/bench-data';
import { mondayOfWeek, weekLabel } from '../../lib/earnkit/weeks';
import { PART_COLORS } from './score-colors';

/**
 * Beside the grid: how many of its weeks had code shipped. v2.13.1 O3 fix round 1 (controller
 * ruling): "Code in", never "Shipped", so it never contradicts the score part "Shipped". Pure.
 */
export const shippedWords = (n: number, of = 52): string =>
  `Code in ${n} of the last ${of} weeks`;

/**
 * profile-whoop v2: a filled week in the weeks hue, its intensity rising toward the newest week
 * (recent weeks weigh more in Shipping). Pure.
 */
const onStyle = (i: number, n: number) => {
  const t = n > 1 ? i / (n - 1) : 1;
  const c = PART_COLORS.weeks;
  return {
    backgroundImage: `linear-gradient(180deg, ${c.to}, ${c.from})`,
    opacity: 0.4 + 0.6 * t,
  };
};

/**
 * v2.13 spec "Shipping grid": 52 squares, one per ISO week, oldest first; filled for a week that
 * shipped, in the weeks hue (profile-whoop v2: brighter toward the newest week). 13 by 4 on a phone, 26 by 2 from md. Each square's tooltip is its week ("Week of Oct 12":
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
        {grid.map((g, i) => {
          const monday = mondayOfWeek(g.week);
          return (
            <span
              key={g.week}
              data-week={g.week}
              data-on={g.on}
              title={monday ? weekLabel(monday) : undefined}
              className={`block aspect-square rounded-[3px] ${g.on ? '' : 'bg-ek-chip'}`}
              style={g.on ? onStyle(i, grid.length) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
