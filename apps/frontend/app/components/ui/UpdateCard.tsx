import Avatar from '../../[handle]/Avatar';
import { PART_COLORS, chipHue } from '../../[handle]/score-colors';
import { SURFACE } from '../common/Panel';
import { pagePath } from '../../../lib/earnkit/reserved-routes';
import { RENDERED_LINK, RENDERED_TRAILING } from '../../../lib/earnkit/update-links';
import { UNCONFIRMED_LABEL } from '../../../lib/earnkit/week-facts';
import { weekLabel } from '../../../lib/earnkit/weeks';

/** What a card needs. The person's handle, name, avatar and project are only for showPerson (the profile omits them). */
export type UpdateCardData = {
  handle?: string; name?: string; avatar?: string | null; project?: string;
  week: string; text: string | null; chips: string[]; started?: string | null;
  /** Weekly updates: what the week shipped, one paragraph, already filtered (week-summary.ts summaryShown); plain text. */
  summary?: string | null;
  /** false: the builder has not said yes to this week; the card reads UNCONFIRMED_LABEL (never on a Started card). */
  confirmed?: boolean;
};


/**
 * O3 fix round 1 (insurance for rows stored before O4): a link is made only of an href that is its
 * own parsed URL and has no "." or ".." path segment; anything else stays plain text.
 */
function linkable(href: string): boolean {
  if (!URL.canParse(href) || new URL(href).href !== href) return false;
  return !href.replace(/^https:\/\/[^/?#]*/, '').split(/[?#]/)[0].split('/').some((x) => x === '.' || x === '..');
}

/**
 * The update as plain React text (escaped). Only a full https href that update-text stored
 * (own links only) becomes an <a>; no markdown, no HTML, no auto-linking of anything else.
 */
function Body({ text }: { text: string }) {
  const out: (string | React.ReactElement)[] = [];
  let at = 0;
  // A full https link in the strict alphabet update-text stores own links in (and checks on the way out).
  for (const m of text.matchAll(RENDERED_LINK)) {
    const href = m[0].replace(RENDERED_TRAILING, '');
    if (!linkable(href)) continue;
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(<a key={m.index} href={href} rel="nofollow noopener ugc" className="text-ek-accent underline underline-offset-2">{href.replace(/^https:\/\//, '')}</a>);
    at = m.index + href.length;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}

/**
 * v2.13 spec "The feed": one update as a card, long (the feed, the profile) or square (the carousel),
 * on the site's card surface (R18: Panel.tsx SURFACE). Server-safe; no label says who wrote it. Chips
 * are neutral; the first, when it names a fact (data-hue, score-colors.ts chipHue), carries one small
 * dot in that fact's hue (PART_COLORS, the profile's accent palette: the one place the card takes a color from).
 * `showWeek: false` drops the week line where a section header already names the week (the feed).
 */
export default function UpdateCard({ card, shape, showPerson = true, showWeek = true }: { card: UpdateCardData; shape: 'long' | 'square'; showPerson?: boolean; showWeek?: boolean }) {
  const square = shape === 'square';
  const shell = square
    ? `${SURFACE} aspect-square p-5 flex flex-col justify-between w-[78vw] max-w-[18rem] sm:w-[18rem]`
    : `${SURFACE} p-5 md:px-8 md:py-6 w-full`;
  // Weekly updates: the week's summary leads; the builder's own note sits under it as a quote. The square card
  // shows the summary, or the note when there is no summary.
  const lead = card.started ?? card.summary ?? null;
  const note = card.started || !card.text ? null : square ? card.text.split(/(?<=[.!?])\s/)[0] : card.text;
  const chips = square ? card.chips.slice(0, 2) : card.chips;
  const handle = card.handle;
  const unconfirmed = card.confirmed === false && !card.started;
  return (
    <article data-shape={shape} className={shell}>
      <div>
        {showPerson && handle && (
          <div className="mb-4 flex items-center gap-3">
            <Avatar src={card.avatar ?? null} handle={handle} className="h-9 w-9 text-sm" />
            {/* The name and @handle are one link to their page (a 44px tap target). */}
            <a href={pagePath(handle)} className="group block min-h-11 min-w-0 font-funnel-sans text-sm">
              <p data-ek-name="" className="break-words font-medium text-ek-text group-hover:underline group-hover:underline-offset-4">{card.name}</p>
              <p data-ek-meta="" className="break-words text-ek-muted">@{handle}{card.project ? ` · ${card.project}` : ''}</p>
            </a>
          </div>
        )}
        {(showWeek || unconfirmed) && (
          <p data-ek-week="" className="font-funnel-sans text-sm text-ek-muted">
            {showWeek && weekLabel(card.week)}
            {unconfirmed && <span data-ek-unconfirmed="" className="text-ek-muted">{showWeek ? ' · ' : ''}{UNCONFIRMED_LABEL}</span>}
          </p>
        )}
        {lead && (
          <p data-ek-summary="" className={`mt-2 font-funnel-sans text-base text-ek-text ${square ? 'line-clamp-4' : ''}`}><Body text={lead} /></p>
        )}
        {note && !(square && lead) && (
          <blockquote data-ek-note="" className="mt-3 border-l-2 border-ek-chip pl-3 font-funnel-sans text-base text-ek-body">
            <p className={square ? 'line-clamp-3' : ''}><Body text={note} /></p>
          </blockquote>
        )}
      </div>
      {chips.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {chips.map((c, i) => {
            const hue = chipHue(c);
            return (
              <li key={c} data-hue={hue ?? undefined} className="inline-flex items-center gap-2 rounded-full bg-ek-chip px-3 py-1 font-funnel-sans text-sm text-ek-body">
                {i === 0 && hue ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: PART_COLORS[hue].to }} /> : null}
                {c}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
