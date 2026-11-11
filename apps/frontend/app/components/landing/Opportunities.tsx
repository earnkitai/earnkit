import Link from 'next/link';
import { CARD_NEUTRAL, H1_SITE, H2_SITE, PILL_WHITE } from '../site/ui';
import type { Tile } from '../../../lib/v5/landing';
import { CLOSED, EARN_ALL, EARN_EMPTY, EARN_TITLE, NOT_OPEN_YET, PROGRAMS_DESCRIPTION, PROGRAMS_TITLE } from '../../../lib/v5/site-copy';
import Money from '../site/Money';

/** The two card looks: blue (the landing's first card) and neutral (every other card); each with its secondary text colour. */
const BLUE = { card: 'rounded-[32px] border border-s-blue-line bg-[linear-gradient(160deg,var(--ek-s-blue-top)_0%,var(--ek-s-blue-bottom)_100%)] text-s-text', sub: 'text-s-on-navy-soft' };
const NEUTRAL = { card: `${CARD_NEUTRAL} hover:border-s-line-hover`, sub: 'text-s-muted' };

/** A range's money (v6.1.14): on a big tile, "Up to" is drawn small above the figure. */
const UP_TO = 'Up to ';

/** Marks drawn in one flat colour that may not read on white (black or white on transparent): forced black on the white tile. */
const DARK_MARKS = new Set(['alliance-all19', 'thiel-fellowship']);
/** Wordmarks with no square mark from the organizer: drawn 96 by 28 on a white tile as wide as the mark, like the name tile. */
const WIDE_MARKS = new Set(['ugreen-ai-nas-hackathon-2026', 'thiel-fellowship']);

/** Words an organizer's initials skip (L27-23, v6.1.16). */
const SKIP_WORDS = new Set(['the', 'of', 'and']);

/**
 * An organizer's initials for a tile without a logo (L27-23, v6.1.16): the first letters of the first two words that
 * are not `the`, `of` or `and`, upper-cased ("Base Ecosystem Fund" gives "BE"); one letter for a one-word organizer.
 * Pure.
 */
export function initialsOf(organizer: string): string {
  const words = organizer.split(/[\s/&,-]+/).filter((w) => /\p{L}|\p{N}/u.test(w) && !SKIP_WORDS.has(w.toLowerCase()));
  return words
    .slice(0, 2)
    .map((w) => [...w.replace(/^[^\p{L}\p{N}]+/u, '')][0] ?? '')
    .join('')
    .toUpperCase();
}

/**
 * The program's mark on a white 52px tile (a wordmark in `WIDE_MARKS` on a tile as wide as the mark). Without a logo
 * file, the organizer's initials in ink on the same 52px square (L27-23, v6.1.16: never a cut word). Logos are local
 * files only (the tile's `logo` is checked to exist).
 */
export function Logo({ id, logo, organizer }: { id: string; logo: string | null; organizer: string }) {
  const dark = DARK_MARKS.has(id) ? 'brightness-0' : '';
  if (logo && WIDE_MARKS.has(id))
    return (
      <span data-ek-logo-wide="" className="inline-flex h-[52px] shrink-0 items-center justify-center rounded-2xl bg-s-light px-3.5">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small local file; lazy: below the fold */}
        <img src={logo} alt="" width={96} height={28} loading="lazy" className={`h-[28px] w-[96px] object-contain ${dark}`} />
      </span>
    );
  if (logo)
    return (
      <span className="inline-flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-s-light text-s-ink">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small local file; lazy: below the fold */}
        <img src={logo} alt="" width={30} height={30} loading="lazy" className={`h-[30px] w-[30px] object-contain ${dark}`} />
      </span>
    );
  return (
    <span
      data-ek-logo-initials=""
      aria-hidden="true"
      className="inline-flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-s-light text-[17px] font-semibold text-s-ink"
    >
      {initialsOf(organizer)}
    </span>
  );
}

/** One program as a list item (L27-6, L27-13, v6.1.16): an article whose title is an h3 link to the guide (its
 *  pseudo-element covers the card, so the whole card still clicks), then the money line and the close line. */
function Card({ t, look }: { t: Tile; look: typeof BLUE }) {
  return (
    <li className="flex min-w-0">
      <article
        className={`relative flex min-h-[290px] w-full min-w-0 flex-col gap-2 p-[26px] motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:-translate-y-1 ${look.card}`}
      >
        <h3 className="mt-auto text-[16px] font-semibold [overflow-wrap:anywhere]">
          <Link href={`/programs/${t.id}`} className="after:absolute after:inset-0 after:rounded-[32px] after:content-['']">
            {t.title}
          </Link>
        </h3>
        {t.big && t.money.startsWith(UP_TO) ? <span className={`-mb-1 text-[15px] ${look.sub}`}>Up to</span> : null}
        {/* Full figures (lane 22, v6.1.15): a long one ("$1,000,000") steps down a size and may wrap, never overflow at 375px. */}
        <p
          className={`ek-serif min-w-0 leading-[0.9] [overflow-wrap:anywhere] ${
            !t.big ? 'text-[28px] leading-none' : t.money.replace(UP_TO, '').length > 8 ? 'text-[44px] md:text-[56px]' : 'text-[52px] md:text-[64px]'
          }`}
        >
          <Money text={t.big ? t.money.replace(UP_TO, '') : t.money} />
        </p>
        <p className={`text-[13px] ${look.sub}`}>{t.kind}</p>
        {/* Drawn first, read last: the mark, the organizer (wraps to two lines, never an ellipsis, L27-24) and the close line. */}
        <div className="order-first flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-3">
            <Logo id={t.id} logo={t.logo} organizer={t.organizer} />
            {t.logo ? null : <span className={`line-clamp-2 min-w-0 text-[13px] [overflow-wrap:anywhere] ${look.sub}`}>{t.organizer}</span>}
          </span>
          <p
            className={`shrink-0 text-right text-[13px] ${t.status === 'upcoming' ? 'rounded-full bg-s-chip px-3 py-1 text-s-chip-text' : look.sub}`}
          >
            {t.when}
          </p>
        </div>
      </article>
    </li>
  );
}

type Block = { key: 'open' | 'upcoming' | 'closed'; title: string; tiles: Tile[] };
/** The /programs blocks in order (Open now, Not open yet, Closed), only those with programs. Pure. */
export function blocksOf(tiles: Tile[]): Block[] {
  const stateOf = (t: Tile): Block['key'] => (t.status === 'upcoming' ? 'upcoming' : (t.status as string) === 'closed' ? 'closed' : 'open');
  const all: Block[] = [
    { key: 'open', title: EARN_TITLE, tiles: [] },
    { key: 'upcoming', title: NOT_OPEN_YET, tiles: [] },
    { key: 'closed', title: CLOSED, tiles: [] },
  ];
  for (const t of tiles) all.find((b) => b.key === stateOf(t))!.tiles.push(t);
  return all.filter((b) => b.tiles.length > 0);
}

/**
 * The programs as a semantic list (L27-6, L27-13, v6.1.16): each block is a section with its h2, then a `ul` of
 * `li > article` cards. On the landing (`full` false): one block, "Open now", the six featured cards (the first blue,
 * the rest neutral) and one white pill to /programs; the section is the `#earn` anchor the hero chip lands on; six read
 * as 3 by 2 on a desktop, 2 by 3 on a tablet, one column on a phone. On /programs (`full`): the page title, the
 * description line, then Open now, Not open yet and Closed (only those with programs), all neutral, in auto-fit
 * columns. Upcoming programs carry a "Not open yet" chip. With no cards, "Nothing is open right now." under the title
 * (and on the landing the pill still, when programs are listed).
 */
export default function Opportunities({ programs, total, full = false }: { programs: Tile[]; total: number; full?: boolean }) {
  const grid = `grid gap-4 ${full ? '[grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`;
  const list = (tiles: Tile[]) => (
    <ul role="list" className={grid}>
      {tiles.map((t, i) => (
        <Card key={t.id} t={t} look={!full && i === 0 ? BLUE : NEUTRAL} />
      ))}
    </ul>
  );
  if (full)
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4 px-2">
          <h1 id="earn-title" className={H1_SITE}>
            {PROGRAMS_TITLE}
          </h1>
          <p className="text-[17px] leading-normal text-s-muted">{PROGRAMS_DESCRIPTION}</p>
        </div>
        {programs.length === 0 ? <p className="px-2 text-[16px] text-s-muted">{EARN_EMPTY}</p> : null}
        {blocksOf(programs).map((b) => (
          <section key={b.key} id={b.key === 'open' ? 'earn' : b.key} aria-labelledby={`${b.key}-title`} className="flex scroll-mt-6 flex-col gap-6">
            <h2 id={`${b.key}-title`} className={`${H2_SITE} px-2`}>
              {b.title}
            </h2>
            {list(b.tiles)}
          </section>
        ))}
      </div>
    );
  return (
    <section id="earn" aria-labelledby="earn-title" className="flex scroll-mt-6 flex-col gap-8">
      <h2 id="earn-title" className={`${H2_SITE} px-2`}>
        {EARN_TITLE}
      </h2>
      {programs.length > 0 ? list(programs) : <p className="px-2 text-[16px] text-s-muted">{EARN_EMPTY}</p>}
      {total > 0 ? (
        <div className="flex justify-center">
          <Link href="/programs" className={PILL_WHITE}>
            {EARN_ALL}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
