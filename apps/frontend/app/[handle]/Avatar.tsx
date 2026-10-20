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
  // The src that failed: a new photo (a reused instance) gets its own try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = src !== null && failedSrc === src;
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setFailedSrc(src);
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
        onError={() => setFailedSrc(src)}
        className={`shrink-0 rounded-full bg-ek-raised object-cover ring-1 ring-ek-line-strong ${className}`}
      />
    );
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full bg-ek-raised font-funnel-display font-medium text-ek-body ring-1 ring-ek-line-strong ${className}`}
    >
      {handle.replace(/^_+/, '').charAt(0).toUpperCase() || '?'}
    </span>
  );
}
