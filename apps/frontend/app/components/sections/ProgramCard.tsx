import Link from 'next/link';
import ProgramLogo from './ProgramLogo';
import BonusPill from '../ui/BonusPill';
import type { Tile } from '../../../lib/earnkit/landing';
import { NO_CELL } from '../../../lib/earnkit/no-cell';

/** `ek-chip` marks the card's chips (days left, difficulty) apart from the bonus pill. */
const CHIP = 'ek-chip inline-flex h-7 items-center rounded-full bg-ek-navy-deep px-3 font-funnel-sans text-xs font-medium text-ek-blue-light';

/**
 * v2.8 Ruling 21 (plan): one slim card. Logo and name, the big line (the pool, else the per-winner
 * amount), the per-winner line when it differs, then the days-left chip, the difficulty chip (the
 * level word only; none for NO_CELL) and the builder bonus pill. The whole card is one link to its
 * guide; there are no buttons.
 */
export default function ProgramCard({ tile: t }: { tile: Tile }) {
  return (
    <Link
      href={`/programs/${t.id}`}
      aria-label={`${t.title}, ${t.prize}`}
      className="group flex h-full flex-col rounded-[32px] bg-ek-navy p-6 ring-1 ring-inset ring-ek-blue-soft/10 transition-[box-shadow,background-color] duration-200 hover:bg-[#15307a] hover:ring-ek-blue-soft/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:rounded-[32px] focus-visible:outline-ek-blue-bright"
    >
      <div className="flex items-center gap-3">
        <ProgramLogo logo={t.logo} title={t.title} size={40} />
        <h3 className="line-clamp-2 min-w-0 font-funnel-display text-lg font-medium leading-tight text-ek-white">{t.title}</h3>
      </div>

      <p className="mt-6 font-funnel-display text-2xl font-medium leading-tight text-ek-white">{t.prize}</p>
      {t.prize_note && <p className="mt-1 font-funnel-sans text-sm text-ek-blue-soft">{t.prize_note}</p>}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
        <span className={CHIP}>{t.days_left}</span>
        {/* NO_CELL: no difficulty, no chip. no-cell.ts has no imports, so this stays client-safe. */}
        {t.difficulty !== NO_CELL && <span className={CHIP}>{t.difficulty}</span>}
        {t.has_bonus && <BonusPill size="sm" amount={t.bonus_amount} />}
      </div>
    </Link>
  );
}
