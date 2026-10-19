import type { ProfileData } from '../../lib/earnkit/bench-data';
import ScoreRing from './ScoreRing';
import { PART_COLORS, PART_WORDS } from './score-colors';

/**
 * profile-whoop: the score's parts, each its own ring in its own color with its points in the
 * middle, the label, "of N" and one sentence on what counts. Screen readers get the ring's one line
 * ("Shipped 15 of 20") and the sentence. Two columns on a phone, four from md, hairlines between. Pure.
 */
export default function ScoreParts({ parts }: { parts: ProfileData['parts'] }) {
  return (
    <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-[28px] bg-ek-blue-soft/10 md:grid-cols-4">
      {parts.map((p) => {
        const color = PART_COLORS[p.label];
        return (
          <li
            key={p.label}
            className="flex min-w-0 flex-col items-start gap-4 bg-ek-navy-deep p-5 md:p-6"
          >
            <ScoreRing
              score={p.points}
              max={p.max}
              color={color}
              stroke={7}
              label={`${p.label} ${p.points} of ${p.max}`}
              caption={`of ${p.max}`}
              className="h-20 w-20 md:h-24 md:w-24"
              numberClassName="text-[1.75rem] md:text-[2rem]"
            />
            <div className="min-w-0">
              <p
                aria-hidden="true"
                className="flex items-center gap-2 font-funnel-sans text-[15px] font-medium text-ek-white"
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {p.label}
              </p>
              <p className="mt-1.5 font-funnel-sans text-sm font-light leading-snug text-ek-blue-soft">
                {PART_WORDS[p.label]}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
