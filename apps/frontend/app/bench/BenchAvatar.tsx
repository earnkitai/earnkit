'use client';

import { useEffect, useRef, useState } from 'react';
import Avatar from '../[handle]/Avatar';

/**
 * v2.13 The Bench: the person's X picture, and their first letter (Avatar's fallback) when the
 * picture fails to load, including a failure before the page was interactive.
 */
export default function BenchAvatar({ src, handle, className }: { src: string | null; handle: string; className: string }) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, []);
  if (!src || failed) return <Avatar src={null} handle={handle} className={className} />;
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
}
