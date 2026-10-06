import { Panel } from '../common/Panel';
import type { StatItem } from '../../../lib/earnkit/landing';

const COLS: Record<number, string> = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' };

/** v2.7 §1: Open money · Agents earning (from 100) · Builder bonus, in the bonus board's Fact style. */
export default function StatsStrip({ items }: { items: StatItem[] }) {
  return (
    <Panel label="EarnKit in numbers" className="py-10 md:py-12">
      <dl className={`grid gap-6 ${COLS[items.length] ?? 'sm:grid-cols-3'}`}>
        {items.map((i) => (
          <div key={i.label}>
            <dt className="font-funnel-sans text-sm text-ek-blue-soft">{i.label}</dt>
            <dd className="mt-1 font-funnel-display text-2xl font-medium text-ek-white md:text-3xl">{i.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
