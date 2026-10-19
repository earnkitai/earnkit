'use client';

import { useEffect, useRef, useState } from 'react';

export const BADGE_COPY_LINE = 'Add the badge to your README';
export const COPY_FAILED = 'Copy failed';

/**
 * Launch-ready L8: a quiet line under the profile: the README badge's markdown and a Copy button. Pages are public and
 * the owner can't be told from a visitor (L7), so it shows for everyone, small and muted. `markdown`: badge.ts
 * badgeMarkdown (passed in, so the client bundle never loads the server module).
 */
export default function BadgeCopy({ markdown: md }: { markdown: string }) {
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
    <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-funnel-sans text-xs text-ek-muted md:text-sm">
      <span>{BADGE_COPY_LINE}</span>
      <code className="min-w-0 max-w-full truncate font-mono text-xs text-ek-muted">{md}</code>
      <button
        type="button"
        onClick={() => {
          // Fix round 1: a refused or missing clipboard says so, never a silent no-op.
          if (!navigator.clipboard) return show('failed');
          navigator.clipboard.writeText(md).then(() => show('copied'), () => show('failed'));
        }}
        aria-label="Copy the badge markdown"
        className="inline-flex min-h-11 items-center rounded-full border border-ek-line-strong px-3 font-medium text-ek-body transition-colors hover:bg-ek-chip hover:text-ek-text md:min-h-8"
      >
        {state === 'copied' ? 'Copied' : state === 'failed' ? COPY_FAILED : 'Copy'}
      </button>
    </div>
  );
}
