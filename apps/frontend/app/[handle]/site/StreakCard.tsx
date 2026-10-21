import { STREAK_TITLE, streakNote, weekLine } from '../../../lib/earnkit/site-copy';
import { CARD_RUST, phoneRadius } from '../../components/site/ui';

/** "5 weeks", "1 week", "0 weeks". Pure. */
export const streakCount = (n: number): string => `${n} ${n === 1 ? 'week' : 'weeks'}`;

/**
 * The rust Streak card (Profile board): the streak in Kaftan Serif, the last 12 weeks as squares (code that week or
 * not), the note ("Code in 7 of 12 weeks", or "Week 2 starts Monday" in the first week) and this week's commits.
 */
export default function StreakCard({ streak, weeks, thisWeek }: { streak: number; weeks: boolean[]; thisWeek: number }) {
  const on = weeks.filter(Boolean).length;
  return (
    <div data-ek-streak="" className={`${phoneRadius(CARD_RUST)} flex flex-col gap-3.5 p-7`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-semibold text-s-rust-soft">{STREAK_TITLE}</span>
        <span className="ek-serif text-[40px] leading-none">{streakCount(streak)}</span>
      </div>
      <div role="img" aria-label={`Code in ${on} of the last 12 weeks`} className="grid grid-cols-12 gap-1.5">
        {weeks.map((w, i) => (
          <span key={i} className={`block aspect-square rounded-[6px] ${w ? 'bg-s-rust-on' : 'bg-s-rust-off'}`} />
        ))}
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[13px]">
        <span className="text-s-rust-sub">{streakNote(streak, on)}</span>
        <span className="font-semibold text-s-rust-light">{weekLine(thisWeek)}</span>
      </div>
    </div>
  );
}
