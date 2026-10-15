import type { ProfileData } from '../../lib/earnkit/bench-data';

/**
 * v2.13 spec "Profile": the score's four parts, each "Shipped 15 of 20" over a slim bar filled to its
 * share. Two columns from sm, one on a phone. Pure.
 */
export default function ScoreParts({ parts }: { parts: ProfileData['parts'] }) {
  return (
    <ul className="grid w-full grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
      {parts.map((p) => {
        const share =
          p.max > 0 ? Math.max(0, Math.min(1, p.points / p.max)) : 0;
        return (
          <li key={p.label} className="min-w-0">
            <p className="font-funnel-sans text-[15px] text-ek-blue-light">{`${p.label} ${p.points} of ${p.max}`}</p>
            <span
              aria-hidden="true"
              className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-ek-navy"
            >
              {share > 0 ? (
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-ek-score-orange to-ek-score-purple"
                  style={{ width: `${Math.round(share * 100)}%` }}
                />
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
