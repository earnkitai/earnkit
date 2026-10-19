import { Panel } from '../../components/common/Panel';
import { PROFILES_ANCHOR, PROFILES_POINTS, PROFILES_TITLE } from '../../../lib/earnkit/policy';

/**
 * v2.12 spec 8, v2.12.1 T12: /terms#builder-profiles, laid out as the policy section's "What EarnKit
 * records" (title left, list right). The words live in lib/earnkit/policy.ts (PROFILES_POINTS).
 */
export default function ProfilesSection() {
  return (
    <Panel id={PROFILES_ANCHOR} className="mt-4 scroll-mt-32 py-2 md:py-4" label={PROFILES_TITLE}>
      <div className="grid gap-4 py-10 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12 md:py-14">
        <h2 className="font-funnel-display text-2xl font-medium text-ek-white md:text-3xl">{PROFILES_TITLE}</h2>
        <div className="max-w-2xl font-funnel-sans text-base font-light leading-relaxed text-ek-blue-light md:text-lg">
          <ul className="list-disc space-y-2 pl-5 marker:text-ek-blue-bright">
            {PROFILES_POINTS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
