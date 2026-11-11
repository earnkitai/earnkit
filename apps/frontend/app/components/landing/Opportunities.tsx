import Link from 'next/link';
import { CARD_NEUTRAL, H1_SITE, H2_SITE, PILL_WHITE } from '../site/ui';
import type { Tile } from '../../../lib/v5/landing';
import { EARN_ALL, EARN_EMPTY, EARN_TITLE, PROGRAMS_DESCRIPTION, PROGRAMS_TITLE } from '../../../lib/v5/site-copy';
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

/**
 * The program's mark on a white 52px tile (a wordmark in `WIDE_MARKS` on a tile as wide as the mark). Without
 * a logo file, the organizer's name in ink on the same white tile, as wide as the name. Logos are local files only (the tile's `logo` is checked to exist).
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
      data-ek-logo-name=""
      aria-hidden="true"
      className="inline-flex h-[52px] min-w-[52px] max-w-[60%] shrink items-center justify-center rounded-2xl bg-s-light px-3.5 text-[15px] font-semibold text-s-ink"
    >
      <span className="truncate">{organizer}</span>
    </span>
  );
}

/**
 * The programs grid, each card to its guide. On the landing (`full` false): "Open now", the six featured
 * cards (the first blue, the rest neutral) and one white pill to /programs with the listed count; the section
 * is the `#earn` anchor the hero chip lands on; six read as 3 by 2 on a desktop, 2 by 3 on a tablet, one column on a phone. On /programs (`full`): the page title, the description line
 * and every listed program, all neutral, in auto-fit columns. Upcoming programs carry a "Not open yet" chip. With no cards,
 * "Nothing is open right now." under the title (and on the landing the pill still, when programs are listed).
 */
export default function Opportunities({ programs, total, full = false }: { programs: Tile[]; total: number; full?: boolean }) {
  return (
    <section id="earn" aria-labelledby="earn-title" className="flex scroll-mt-6 flex-col gap-8">
      {full ? (
        <div className="flex flex-col gap-4 px-2">
          <h1 id="earn-title" className={H1_SITE}>
            {PROGRAMS_TITLE}
          </h1>
          <p className="text-[17px] leading-normal text-s-muted">{PROGRAMS_DESCRIPTION}</p>
        </div>
      ) : (
        <h2 id="earn-title" className={`${H2_SITE} px-2`}>
          {EARN_TITLE}
        </h2>
      )}
      {programs.length > 0 ? (
        <div className={`grid gap-4 ${full ? '[grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
          {programs.map((t, i) => {
            const look = !full && i === 0 ? BLUE : NEUTRAL;
            return (
              <Link
                key={t.id}
                href={`/programs/${t.id}`}
                className={`flex min-h-[290px] min-w-0 flex-col gap-2 p-[26px] motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:-translate-y-1 ${look.card}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <Logo id={t.id} logo={t.logo} organizer={t.organizer} />
                  <span
                    className={`shrink-0 text-right text-[13px] ${t.status === 'upcoming' ? 'rounded-full bg-s-chip px-3 py-1 text-s-chip-text' : look.sub}`}
                  >
                    {t.when}
                  </span>
                </span>
                <span className="mt-auto text-[16px] font-semibold [overflow-wrap:anywhere]">{t.title}</span>
                {t.big && t.money.startsWith(UP_TO) ? <span className={`-mb-1 text-[15px] ${look.sub}`}>Up to</span> : null}
                {/* Full figures (lane 22, v6.1.15): a long one ("$1,000,000") steps down a size and may wrap, never overflow at 375px. */}
                <span
                  className={`ek-serif min-w-0 leading-[0.9] [overflow-wrap:anywhere] ${
                    !t.big ? 'text-[28px] leading-none' : t.money.replace(UP_TO, '').length > 8 ? 'text-[44px] md:text-[56px]' : 'text-[52px] md:text-[64px]'
                  }`}
                >
                  <Money text={t.big ? t.money.replace(UP_TO, '') : t.money} />
                </span>
                <span className={`text-[13px] ${look.sub}`}>{t.kind}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="px-2 text-[16px] text-s-muted">{EARN_EMPTY}</p>
      )}
      {!full && total > 0 ? (
        <div className="flex justify-center">
          <Link href="/programs" className={PILL_WHITE}>
            {EARN_ALL}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
