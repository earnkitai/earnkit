'use client';

import { useState } from 'react';

export const BADGE_COPY_LINE = 'Add the badge to your README';

/**
 * Launch-ready L8: a quiet line under the profile: the README badge's markdown and a Copy button. Pages are public and
 * the owner can't be told from a visitor (L7), so it shows for everyone, small and muted. `markdown`: badge.ts
 * badgeMarkdown (passed in, so the client bundle never loads the server module).
 */
export default function BadgeCopy({ markdown: md }: { markdown: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-funnel-sans text-xs text-ek-muted md:text-sm">
      <span>{BADGE_COPY_LINE}</span>
      <code className="min-w-0 max-w-full truncate font-mono text-xs text-ek-muted">{md}</code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(md).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        aria-label="Copy the badge markdown"
        className="inline-flex min-h-11 items-center rounded-full border border-ek-line-strong px-3 font-medium text-ek-body transition-colors hover:bg-ek-chip hover:text-ek-text md:min-h-8"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
