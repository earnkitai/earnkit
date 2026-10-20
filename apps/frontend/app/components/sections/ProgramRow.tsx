import Link from 'next/link';
import ProgramLogo from './ProgramLogo';
import { NUM } from '../common/Panel';
import type { Tile } from '../../../lib/earnkit/landing';
import { NO_CELL } from '../../../lib/earnkit/no-cell';

/** `ek-chip` marks the row's chips (days left, "Not open yet", "In person", the difficulty word). */
const CHIP = 'ek-chip inline-flex h-7 items-center rounded-full bg-ek-chip px-3 font-funnel-sans text-xs font-medium text-ek-body';

/**
 * v2.8 Ruling 21 (plan), v3 Stage 3 (spec 5.6): one program as a hairline row: the logo, the title with its chips
 * under it (when it closes or "Rolling" or "Not open yet", "In person", the difficulty word; none for NO_CELL),
 * and the award (the pool, else the per-winner amount) with the per-winner line when it differs, on the right from
 * md and under the title on a phone. The whole row is one link to the guide; there are no buttons.
 */
export default function ProgramRow({ tile: t }: { tile: Tile }) {
  return (
    <Link
      href={`/programs/${t.id}`}
      aria-label={`${t.title}, ${t.prize}`}
      className="group grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 border-t border-ek-line py-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-x-6 md:py-5"
    >
      <ProgramLogo logo={t.logo} title={t.title} size={40} />
      <div className="min-w-0">
        <h3 className="font-funnel-display text-lg font-medium leading-tight text-ek-text underline-offset-4 [overflow-wrap:break-word] group-hover:underline">{t.title}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Launch ready L10: chips start with a capital, as the difficulty chip does ("Rolling", "12 days left"). */}
          <span className={CHIP}>{t.days_left.charAt(0).toUpperCase() + t.days_left.slice(1)}</span>
          {/* v3 Stage 2: an in-person program (an ETHGlobal hackathon) says so. */}
          {t.in_person ? <span className={CHIP}>In person</span> : null}
          {/* NO_CELL: no difficulty, no chip. no-cell.ts has no imports, so this stays client-safe. */}
          {t.difficulty !== NO_CELL ? <span className={CHIP}>{t.difficulty}</span> : null}
        </div>
      </div>
      <div className="col-start-2 min-w-0 md:col-start-3 md:text-right">
        <p className={`${NUM} text-lg font-medium leading-tight text-ek-text md:text-xl`}>{t.prize}</p>
        {t.prize_note ? <p className="mt-0.5 font-funnel-sans text-sm text-ek-muted">{t.prize_note}</p> : null}
      </div>
    </Link>
  );
}
