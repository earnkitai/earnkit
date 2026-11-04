import Link from 'next/link';
import { H1_SITE, H2_SITE } from '../site/ui';
import type { Tile } from '../../../lib/v5/landing';
import { EARN_EMPTY, EARN_TITLE } from '../../../lib/v5/site-copy';
import Money from '../site/Money';

/** The four card looks in order: blue, step, rust, step; each with its secondary text colour. */
const LOOKS = [
  { card: 'border-s-blue-line bg-[linear-gradient(160deg,var(--ek-s-blue-top)_0%,var(--ek-s-blue-bottom)_100%)]', sub: 'text-s-on-navy-soft' },
  { card: 'border-s-step-line bg-gradient-to-br from-s-step-top to-s-step-bottom', sub: 'text-s-muted' },
  { card: 'border-s-rust-line bg-[linear-gradient(160deg,var(--ek-s-rust-top)_0%,var(--ek-s-rust-bottom)_100%)]', sub: 'text-s-rust-sub' },
  { card: 'border-s-step-line bg-gradient-to-br from-s-step-top to-s-step-bottom', sub: 'text-s-muted' },
] as const;

/** Marks drawn dark on their own (black on transparent): forced black so they read on the white tile. */
const DARK_MARKS = new Set(['alliance-all19']);

/**
 * The program's mark on a white 52px tile. Without a logo file, the organizer's name in ink on the same
 * white tile, as wide as the name. Logos are local files only (the tile's `logo` is checked to exist).
 */
export function Logo({ id, logo, organizer }: { id: string; logo: string | null; organizer: string }) {
  if (logo)
    return (
      <span className="inline-flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-s-light text-s-ink">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small local file; lazy: below the fold */}
        <img src={logo} alt="" width={30} height={30} loading="lazy" className={`h-[30px] w-[30px] object-contain ${DARK_MARKS.has(id) ? 'brightness-0' : ''}`} />
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
 * The open programs, every one of them, each card to its guide (the `#earn` anchor the hero chip lands on).
 * Upcoming programs carry a "Not open yet" chip. `h1`: the section is the page's title (/programs).
 */
export default function Opportunities({ programs, h1 = false, title = EARN_TITLE }: { programs: Tile[]; h1?: boolean; title?: string }) {
  const Heading = h1 ? 'h1' : 'h2';
  return (
    <section id="earn" aria-labelledby="earn-title" className="flex scroll-mt-6 flex-col gap-8">
      <Heading id="earn-title" className={`${h1 ? H1_SITE : H2_SITE} px-2`}>
        {title}
      </Heading>
      {programs.length > 0 ? (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          {programs.map((t, i) => {
            const look = LOOKS[i % LOOKS.length];
            return (
              <Link
                key={t.id}
                href={`/programs/${t.id}`}
                className={`flex min-h-[290px] min-w-0 flex-col gap-2 rounded-[32px] border p-[26px] text-s-text motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:-translate-y-1 ${look.card}`}
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
                <span className={`ek-serif leading-[0.9] ${t.big ? 'text-[52px] md:text-[64px]' : 'text-[28px] leading-none'}`}>
                  <Money text={t.money} />
                </span>
                <span className={`text-[13px] ${look.sub}`}>{t.kind}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="px-2 text-[16px] text-s-muted">{EARN_EMPTY}</p>
      )}
    </section>
  );
}
