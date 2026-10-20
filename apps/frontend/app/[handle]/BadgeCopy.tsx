'use client';

import { useEffect, useRef, useState } from 'react';
import { BTN_SECONDARY, TEXT_LINK } from '../components/common/Button';

export const BADGE_COPY_LINE = 'Badge for your README';
export const COPY_FAILED = 'Copy failed';

/**
 * Launch-ready L8, v3 Stage 3 (spec 5.6): the README badge at the end of a ranked page. The badge image always shows;
 * one line, "Badge for your README", expands (a native details element, no script needed) to the markdown and a
 * Copy button. Pages are public and the owner can't be told from a visitor (L7), so it shows for everyone, small and
 * muted. `markdown`: badge.ts badgeMarkdown (passed in, so the client bundle never loads the server module).
 */
export default function BadgeCopy({ markdown: md, handle }: { markdown: string; handle: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fix round 1: the reset timer never outlives the page.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const show = (s: 'copied' | 'failed') => {
    setState(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1500);
  };
  return (
    <div className="mt-6 md:mt-8">
      {/* eslint-disable-next-line @next/next/no-img-element -- the site's own SVG, its width set by its text */}
      <img src={`/badge/${handle}.svg`} alt="EarnKit badge" height={20} className="block h-5 w-auto" />
      <details className="mt-3">
        {/* The site's text link look says it opens; the native marker is dropped with it. */}
        <summary className={`${TEXT_LINK} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
          {BADGE_COPY_LINE}
        </summary>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-3">
          <code className="min-w-0 max-w-full truncate bg-ek-surface px-3 py-2.5 font-mono text-xs text-ek-body">{md}</code>
          <button
            type="button"
            onClick={() => {
              // Fix round 1: a refused or missing clipboard says so, never a silent no-op.
              if (!navigator.clipboard) return show('failed');
              navigator.clipboard.writeText(md).then(() => show('copied'), () => show('failed'));
            }}
            aria-label="Copy the badge markdown"
            className={BTN_SECONDARY}
          >
            {state === 'copied' ? 'Copied' : state === 'failed' ? COPY_FAILED : 'Copy'}
          </button>
        </div>
      </details>
    </div>
  );
}
