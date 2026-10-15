'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * v2.12.1 T11, v2.13 R12: a person's X picture (page-data.ts avatarUrl: X's own image host only),
 * else (none, or it fails to load: a stale picture after an X change, including a failure before
 * the page was interactive) the first letter of their handle on navy. Decorative: the name or
 * @handle always sits beside it. The server markup is v2.12.1's for both branches.
 */
export default function Avatar({
  src,
  handle,
  className = 'h-14 w-14 text-xl',
}: {
  src: string | null;
  handle: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, [src]);
  if (src && !failed)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- X's image host; next/image would proxy it through this server
      <img
        ref={img}
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full bg-ek-navy object-cover ring-1 ring-ek-blue-soft/20 ${className}`}
      />
    );
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full bg-ek-navy font-funnel-display font-medium text-ek-blue-light ring-1 ring-ek-blue-soft/20 ${className}`}
    >
      {handle.replace(/^_+/, '').charAt(0).toUpperCase() || '?'}
    </span>
  );
}
