import Link from 'next/link';
import { monogram } from '../sections/ProgramLogo';
import { H2_SITE } from '../site/ui';
import type { Tile } from '../../../lib/earnkit/landing';
import { EARN_FOOT, EARN_TITLE } from '../../../lib/earnkit/site-copy';

/** The four card looks in order (Landing board): blue, step, rust, step; each with its secondary text colour. */
const LOOKS = [
  { card: 'border-s-blue-line bg-[linear-gradient(160deg,var(--ek-s-blue-top)_0%,var(--ek-s-blue-bottom)_100%)]', sub: 'text-s-on-navy-soft' },
  { card: 'border-s-step-line bg-gradient-to-br from-s-step-top to-s-step-bottom', sub: 'text-s-muted' },
  { card: 'border-s-rust-line bg-[linear-gradient(160deg,var(--ek-s-rust-top)_0%,var(--ek-s-rust-bottom)_100%)]', sub: 'text-s-rust-sub' },
  { card: 'border-s-step-line bg-gradient-to-br from-s-step-top to-s-step-bottom', sub: 'text-s-muted' },
] as const;

/** Marks drawn dark on their own (black on transparent): forced black so they read on the white tile. */
const DARK_MARKS = new Set(['alliance-all19']);
/** Ruling 23's only logo shape: a local file under public/programs. */
const LOCAL_LOGO = /^\/programs\/[a-z0-9-]+\.(svg|png)$/;

/** The program's mark on a white 52px tile (30px image), else its monogram in ink. */
function Logo({ t }: { t: Tile }) {
  return (
    <span className="inline-flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-s-light text-s-ink">
      {t.logo && LOCAL_LOGO.test(t.logo) ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small local file
        <img src={t.logo} alt="" width={30} height={30} className={`h-[30px] w-[30px] object-contain ${DARK_MARKS.has(t.id) ? 'brightness-0' : ''}`} />
      ) : (
        <span aria-hidden="true" className="text-[17px] font-semibold">
          {monogram(t.title)}
        </span>
      )}
    </span>
  );
}

/**
 * "Earning opportunities" (Landing board, W2), the `#earn` anchor (the hero chip and /programs land here): the
 * programs HomeView chose (landingPrograms: the first four open), each card to its guide. It imports no
 * db-backed module at runtime (only types and the pure site-copy), so it stays safe to share. The big number is the per-winner max
 * (`tile.big`, S2), else the tile's prize text smaller. No open program: the title and the foot line only.
 */
export default function Opportunities({ programs: shown }: { programs: Tile[] }) {
  return (
    <section id="earn" aria-labelledby="earn-title" className="flex scroll-mt-6 flex-col gap-8">
      <h2 id="earn-title" className={`${H2_SITE} px-2`}>
        {EARN_TITLE}
      </h2>
      {shown.length > 0 ? (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          {shown.map((t, i) => {
            const look = LOOKS[i % LOOKS.length];
            return (
              <Link
                key={t.id}
                href={`/programs/${t.id}`}
                className={`flex min-h-[290px] min-w-0 flex-col gap-2 rounded-[32px] border p-[26px] text-s-text motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:-translate-y-1 ${look.card}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <Logo t={t} />
                  <span className={`text-[13px] ${look.sub}`}>{t.when}</span>
                </span>
                <span className="mt-auto text-[16px] font-semibold [overflow-wrap:anywhere]">{t.title}</span>
                {t.big ? (
                  <span className="ek-serif text-[52px] leading-[0.9] md:text-[64px]">{t.big}</span>
                ) : (
                  <span className="ek-serif text-[28px] leading-none">{t.prize}</span>
                )}
                <span className={`text-[13px] ${look.sub}`}>{t.kind}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
      <p className="px-2 text-[14px] text-s-dim">{EARN_FOOT}</p>
    </section>
  );
}
