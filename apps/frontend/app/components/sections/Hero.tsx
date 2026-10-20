'use client';

import { useCallback, useEffect, useState } from 'react';
import AddToAgent from './AddToAgent';
import { BTN_PRIMARY, BTN_SECONDARY } from '../common/Button';

/** v2.13 spec "Landing page" 1, R18: the hero's words. Shipping and funding; no coin, no community round. */
export const BENCH_HERO_TITLE = 'Ship every week. Get funded.';
export const BENCH_HERO_SUBTITLE = 'Add EarnKit to your AI agent. It ranks what you ship on the leaderboard and finds grants that fit.';

/**
 * The title and subtitle, the install and demo buttons, one short stats line once there is
 * something to show, and (v2.9 E20) the "Builders using EarnKit won $X" line once an announced win
 * exists.
 */
export default function Hero({ statsLine = null, wonLine = null }: { statsLine?: string | null; wonLine?: string | null }) {
  const [open, setOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const closeInstall = useCallback(() => setInstallOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, close]);

  return (
    <>
      <div className="flex w-full flex-col items-center text-center">
        <h1 className="max-w-[16ch] text-balance font-funnel-display text-[2.5rem] font-medium leading-[1.05] tracking-[-0.03em] text-ek-text sm:text-[3.5rem] md:text-[4.5rem]">
          {BENCH_HERO_TITLE}
        </h1>

        <p className="mt-5 max-w-[42ch] text-balance font-funnel-sans text-lg text-ek-body md:text-xl">
          {BENCH_HERO_SUBTITLE}
        </p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <button type="button" onClick={() => setInstallOpen(true)} className={BTN_PRIMARY}>
            Add to your agent
          </button>
          <button type="button" onClick={() => setOpen(true)} className={BTN_SECONDARY}>
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M8 5.5v13l11-6.5-11-6.5Z" />
            </svg>
            Watch the demo
          </button>
        </div>

        {statsLine && (
          <p className="mt-6 font-funnel-sans text-sm text-ek-muted">{statsLine}</p>
        )}
        {/* v2.9 E20: only once an announced win with a prize exists (never "$0"). */}
        {wonLine && (
          <p className={`${statsLine ? 'mt-1' : 'mt-6'} font-funnel-sans text-sm text-ek-muted`}>{wonLine}</p>
        )}
      </div>

      {installOpen && <AddToAgent onClose={closeInstall} />}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="EarnKit demo video"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-ek-page/90 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close video"
            className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full bg-ek-raised text-ek-text transition-colors hover:bg-ek-chip-hover"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>

          <video
            src="/videos/earnkit-launch.mp4"
            controls
            autoPlay
            playsInline
            className="max-h-[85vh] w-auto max-w-full rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
