/**
 * v2.12.1 T11: a person's X picture (page-data.ts avatarUrl: X's own image host only), else the
 * first letter of their handle on navy. Decorative: the name or @handle always sits beside it.
 */
export default function Avatar({ src, handle, className = 'h-14 w-14 text-xl' }: { src: string | null; handle: string; className?: string }) {
  if (src)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- X's image host; next/image would proxy it through this server
      <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" className={`shrink-0 rounded-full bg-ek-navy object-cover ring-1 ring-ek-blue-soft/20 ${className}`} />
    );
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 select-none items-center justify-center rounded-full bg-ek-navy font-funnel-display font-medium text-ek-blue-light ring-1 ring-ek-blue-soft/20 ${className}`}>
      {handle.replace(/^_+/, '').charAt(0).toUpperCase() || '?'}
    </span>
  );
}
