import Link from 'next/link';
import ProgramLogo from './ProgramLogo';
import { SURFACE } from '../common/Panel';
import type { Tile } from '../../../lib/earnkit/landing';
import { NO_CELL } from '../../../lib/earnkit/no-cell';

/** `ek-chip` marks the card's chips (days left or "Not open yet", "In person", difficulty). */
const CHIP = 'ek-chip inline-flex h-7 items-center rounded-full bg-ek-chip px-3 font-funnel-sans text-xs font-medium text-ek-body';

/**
 * v2.8 Ruling 21 (plan): one slim card. Logo and name, the big line (the pool, else the per-winner
 * amount), the per-winner line when it differs, then the days-left chip, the difficulty chip (the
 * level word only; none for NO_CELL). The whole card is one link to its
 * guide; there are no buttons.
 */
export default function ProgramCard({ tile: t }: { tile: Tile }) {
  return (
    <Link
      href={`/programs/${t.id}`}
      aria-label={`${t.title}, ${t.prize}`}
      className={`${SURFACE} group flex h-full flex-col p-6 transition-colors duration-200 hover:border-ek-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ek-accent`}
    >
      <div className="flex items-center gap-3">
        <ProgramLogo logo={t.logo} title={t.title} size={40} />
        <h3 className="line-clamp-2 min-w-0 font-funnel-display text-lg font-medium leading-tight text-ek-text">{t.title}</h3>
      </div>

      <p className="mt-5 font-funnel-display text-2xl font-medium leading-tight text-ek-text">{t.prize}</p>
      {t.prize_note && <p className="mt-1 font-funnel-sans text-sm text-ek-muted">{t.prize_note}</p>}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
        {/* Launch ready L10: chips start with a capital, as the difficulty chip does ("Rolling", "12 days left"). */}
        <span className={CHIP}>{t.days_left.charAt(0).toUpperCase() + t.days_left.slice(1)}</span>
        {/* v3 Stage 2: an in-person program (an ETHGlobal hackathon) says so. */}
        {t.in_person && <span className={CHIP}>In person</span>}
        {/* NO_CELL: no difficulty, no chip. no-cell.ts has no imports, so this stays client-safe. */}
        {t.difficulty !== NO_CELL && <span className={CHIP}>{t.difficulty}</span>}
      </div>
    </Link>
  );
}
