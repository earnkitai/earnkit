import Avatar from '../../[handle]/Avatar';
import { PART_COLORS, chipHue } from '../../[handle]/score-colors';
import { SURFACE } from '../common/Panel';
import { pagePath } from '../../../lib/earnkit/reserved-routes';
import { RENDERED_LINK, RENDERED_TRAILING } from '../../../lib/earnkit/update-links';
import { weekLabel } from '../../../lib/earnkit/weeks';

/** What a card needs. The person's handle, name, avatar and project are only for showPerson (the profile omits them). */
export type UpdateCardData = {
  handle?: string; name?: string; avatar?: string | null; project?: string;
  week: string; text: string | null; chips: string[]; started?: string | null;
  /** v2.14 spec 3: the week's shipped titles, already filtered (ship-titles.ts titlesShown); plain text. */
  titles?: string[];
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
  const raw = card.started ?? card.text;
  const text = raw && square ? raw.split(/(?<=[.!?])\s/)[0] : raw;
  const chips = square ? card.chips.slice(0, 2) : card.chips;
  // The square card has room for one title beside its text.
  const titles = (square ? card.titles?.slice(0, 1) : card.titles) ?? [];
  const handle = card.handle;
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
        {showWeek && <p data-ek-week="" className="font-funnel-sans text-sm text-ek-muted">{weekLabel(card.week)}</p>}
        {titles.length ? <ul className="mt-2 space-y-1">{titles.map((t) => <li key={t} className="font-funnel-sans text-[15px] font-medium text-ek-text">{t}</li>)}</ul> : null}
        {text && (
          <p className={`mt-2 font-funnel-sans text-base text-ek-body ${square ? 'line-clamp-3' : ''}`}><Body text={text} /></p>
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
