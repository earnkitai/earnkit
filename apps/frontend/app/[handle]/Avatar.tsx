'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * v2.12.1 T11, v2.13 R12: a person's picture (page-data.ts avatarUrl: their X picture, else their GitHub one; those two
 * hosts only), else (none, or it fails to load: a stale picture after an X change, including a failure before
 * the page was interactive) the first letter of their handle on navy. Decorative: the name or
 * @handle always sits beside it. The server markup is v2.12.1's for both branches. v3.1 `tone="blue"`
 * (the profile's blue hero): no ring, and the initial in Kaftan Serif, blue on white.
 */
export default function Avatar({
  src,
  handle,
  className = 'h-14 w-14 text-xl',
  tone = 'default',
}: {
  src: string | null;
  handle: string;
  className?: string;
  tone?: 'default' | 'blue';
}) {
  const blue = tone === 'blue';
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
      // eslint-disable-next-line @next/next/no-img-element -- X's or GitHub's image host; next/image would proxy it through this server
      <img
        ref={img}
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        onError={() => setFailedSrc(src)}
        className={`shrink-0 rounded-full object-cover ${blue ? 'bg-s-light' : 'bg-ek-raised ring-1 ring-ek-line-strong'} ${className}`}
      />
    );
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full ${blue ? 'ek-serif bg-s-light leading-none text-s-blue' : 'bg-ek-raised font-funnel-display font-medium text-ek-body ring-1 ring-ek-line-strong'} ${className}`}
    >
      {handle.replace(/^_+/, '').charAt(0).toUpperCase() || '?'}
    </span>
  );
}
