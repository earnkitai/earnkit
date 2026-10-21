import { HIGHLIGHTS_TITLE } from '../../../lib/earnkit/site-copy';
import type { Highlight, HighlightIcon } from '../../../lib/earnkit/site-data';
import { CARD_PANEL, phoneRadius } from '../../components/site/ui';

/** The board's icon paths (lucide strokes): a globe, code brackets, a box, a send arrow, a calendar; won uses applied's. */
const APPLIED = ['m22 2-7 20-4-9-9-4Z', 'M22 2 11 13'];
const ICON: Record<HighlightIcon, string[]> = {
  live: ['M2 12h20', 'M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20', 'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20'],
  code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
  contract: [
    'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
    'm3.3 7 8.7 5 8.7-5',
    'M12 22V12',
  ],
  applied: APPLIED,
  won: APPLIED,
  start: ['M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M16 2v4M8 2v4', 'M3 10h18'],
};

/** The Highlights card (Profile board): verifiable milestones only (site-data.ts highlights), each with its icon tile. None: no card. */
export default function HighlightsCard({ items }: { items: Highlight[] }) {
  if (items.length === 0) return null;
  return (
    <div data-ek-highlights="" className={`${phoneRadius(CARD_PANEL)} flex flex-col gap-1 p-7`}>
      <h2 className="ek-serif mb-2.5 text-[32px] leading-none">{HIGHLIGHTS_TITLE}</h2>
      <ul className="flex flex-col gap-1">
        {items.map((h, i) => (
          <li key={i} className="flex items-center gap-3.5 py-[9px]">
            <span aria-hidden="true" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-s-panel-inner text-s-on-navy">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                {ICON[h.icon].map((d) => (
                  <path key={d} d={d} />
                ))}
              </svg>
            </span>
            <div className="flex min-w-0 flex-grow flex-col gap-0.5">
              <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{h.title}</span>
              <span className="text-[13px] text-s-muted">{h.sub}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
