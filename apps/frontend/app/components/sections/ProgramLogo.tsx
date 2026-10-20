/**
 * A program's logo (v2.7 Ruling 23 (plan)): a local file under public/programs, only through
 * <img> (never inlined), alt = the program's factual title. v3 Stage 3 Task 4: the mark sits on a white disc
 * (`ek-text`) at 70% of it, so a dark mark (Arc's navy, Colosseum's black, a16z's black on white) reads on the
 * black page and every program shows the same round shape. Without a file, Ruling 1's monogram: the first letter
 * of each of the title's first two words, on the raised disc the same size. Nothing is fetched from a third party.
 */
export const monogram = (title: string) =>
  title
    .split(/\s+/)
    .map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

/** Ruling 23's only allowed shape, checked again here (defense in depth; sync already checks it). */
const LOCAL_LOGO = /^\/programs\/[a-z0-9-]+\.(svg|png)$/;

export default function ProgramLogo({ logo, title, size = 48 }: { logo: string | null; title: string; size?: number }) {
  if (logo && LOCAL_LOGO.test(logo)) {
    const mark = Math.round(size * 0.7);
    return (
      <span className="flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-ek-text" style={{ width: size, height: size }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt={title} width={mark} height={mark} className="object-contain" style={{ width: mark, height: mark }} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex flex-shrink-0 items-center justify-center rounded-full border border-ek-line-strong bg-ek-raised font-funnel-display font-medium text-ek-muted"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {monogram(title)}
    </span>
  );
}
