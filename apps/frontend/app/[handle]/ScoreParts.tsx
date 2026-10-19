import type { ProfileData } from '../../lib/earnkit/bench-data';
import ScoreRing from './ScoreRing';
import { PART_COLORS, PART_WORDS } from './score-colors';

/** profile-whoop v2: a dark card surface (hairline border, soft top-down gradient). */
export const SURFACE =
  'rounded-[24px] border border-white/[0.06] bg-gradient-to-b from-[#17191F] to-[#111318]';

/**
 * profile-whoop v2: the score's parts, each on its own card: its gradient ring with the points in the
 * middle, the label in small uppercase in its hue, and one muted sentence on what counts. Screen
 * readers get the ring's one line ("Shipped 15 of 20") and the sentence. Two columns on a phone,
 * four from md. Pure.
 */
export default function ScoreParts({ parts }: { parts: ProfileData['parts'] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
      {parts.map((p) => {
        const hue = PART_COLORS[p.label];
        return (
          <li
            key={p.label}
            className={`flex min-w-0 flex-col items-start gap-4 p-5 md:p-6 ${SURFACE}`}
          >
            <p
              aria-hidden="true"
              className="font-funnel-sans text-[11px] font-semibold uppercase tracking-[0.18em]"
              style={{ color: hue.text }}
            >
              {p.label}
            </p>
            <ScoreRing
              score={p.points}
              max={p.max}
              hue={hue}
              stroke={7}
              track={3}
              label={`${p.label} ${p.points} of ${p.max}`}
              caption={`of ${p.max}`}
              className="h-[5.5rem] w-[5.5rem] md:h-28 md:w-28"
              numberClassName="text-[1.9rem] md:text-[2.4rem]"
            />
            <p className="font-funnel-sans text-[13px] leading-snug text-[#9BA1AC] md:text-sm">
              {PART_WORDS[p.label]}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
