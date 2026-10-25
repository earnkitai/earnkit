import { HIGHLIGHTS_TITLE } from '../../../lib/earnkit/site-copy';
import type { Highlight, HighlightIcon } from '../../../lib/earnkit/site-data';
import { CARD_PANEL, phoneRadius } from '../../components/site/ui';

/**
 * The board's icon paths (lucide strokes): a globe, a box, layers, a calendar with a check, a send arrow, a terminal, a
 * calendar. v3.1 Highlights competence (2026-10-25): products, consistency and experience added; code, repo and applied
 * went with their rows.
 */
const CALENDAR = ['M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M16 2v4M8 2v4', 'M3 10h18'];
const ICON: Record<HighlightIcon, string[]> = {
  live: ['M2 12h20', 'M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20', 'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20'],
  contract: [
    'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
    'm3.3 7 8.7 5 8.7-5',
    'M12 22V12',
  ],
  products: [
    'm12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z',
    'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65',
    'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65',
  ],
  consistency: [...CALENDAR, 'm9 16 2 2 4-4'],
  won: ['m22 2-7 20-4-9-9-4Z', 'M22 2 11 13'],
  experience: ['m4 17 6-6-6-6', 'M12 19h8'],
  start: CALENDAR,
};
/** lucide arrow-up-right: the opens-elsewhere mark on an external link; chevron-right on a page of EarnKit's own. */
const OUT = ['M7 7h10v10', 'M7 17 17 7'];
const NEXT = ['m9 18 6-6-6-6'];
/** An absolute link opens in a new tab (noopener noreferrer); an EarnKit path (a program guide) in the same tab. */
const external = (href: string) => !href.startsWith('/');

function Icon({ paths, size }: { paths: string[]; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function Body({ h }: { h: Highlight }) {
  return (
    <>
      <span aria-hidden="true" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-s-panel-inner text-s-on-navy">
        <Icon paths={ICON[h.icon]} size={18} />
      </span>
      <div className="flex min-w-0 flex-grow flex-col gap-0.5">
        <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{h.title}</span>
        {h.sub ? <span className="text-[13px] text-s-muted">{h.sub}</span> : null}
      </div>
    </>
  );
}

/**
 * The Highlights card (Profile board): verifiable facts only (site-data.ts highlights), each with its icon tile. An item
 * with proof links to it: another site in a new tab (rel noopener noreferrer) with a small arrow, a program guide in
 * the same tab with a chevron; the row is the tap target (44px+) and fills softly with a hairline on hover.
 * None: no card.
 */
export default function HighlightsCard({ items }: { items: Highlight[] }) {
  if (items.length === 0) return null;
  return (
    <div data-ek-highlights="" className={`${phoneRadius(CARD_PANEL)} flex flex-col gap-1 p-7`}>
      <h2 className="ek-serif mb-2.5 text-[32px] leading-none">{HIGHLIGHTS_TITLE}</h2>
      <ul className="flex flex-col gap-1">
        {items.map((h, i) => (
          <li key={i}>
            {h.href ? (
              <a
                href={h.href}
                {...(external(h.href) && { target: '_blank', rel: 'noopener noreferrer' })}
                className="group -mx-2 flex min-h-11 items-center gap-3.5 rounded-2xl px-2 py-[9px] outline-none ring-1 ring-transparent motion-safe:transition-colors motion-safe:duration-200 hover:bg-s-panel-hover hover:ring-s-line focus-visible:ring-2 focus-visible:ring-s-blue"
              >
                <Body h={h} />
                <span aria-hidden="true" className="shrink-0 text-s-muted motion-safe:transition-colors motion-safe:duration-200 group-hover:text-s-text">
                  <Icon paths={external(h.href) ? OUT : NEXT} size={16} />
                </span>
                {external(h.href) ? <span className="sr-only"> (opens in a new tab)</span> : null}
              </a>
            ) : (
              <div className="flex items-center gap-3.5 py-[9px]">
                <Body h={h} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
