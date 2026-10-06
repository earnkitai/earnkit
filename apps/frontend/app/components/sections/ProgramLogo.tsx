/**
 * A program's logo (v2.7 Ruling 23 (plan)): a local file under public/programs, only through
 * <img> (never inlined), alt = the program's factual title. Without one, Ruling 1's monogram: the
 * first letter of each of the title's first two words, on a navy circle the same size. Nothing is
 * fetched from a third party.
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
  if (logo && LOCAL_LOGO.test(logo))
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt={title}
        width={size}
        height={size}
        className="flex-shrink-0 rounded-full bg-ek-white/90 object-contain p-1.5"
        style={{ width: size, height: size }}
      />
    );
  return (
    <span
      aria-hidden="true"
      className="flex flex-shrink-0 items-center justify-center rounded-full border border-ek-blue-soft/25 bg-ek-navy font-funnel-display font-medium text-ek-blue-soft"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {monogram(title)}
    </span>
  );
}
