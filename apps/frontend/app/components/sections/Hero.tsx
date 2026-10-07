'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import AddToAgent, { START_PROMPT } from './AddToAgent';

/**
 * v2.7.1: the promise, the live "$1.3M+ open right now" figure (landing.ts: the open programs'
 * source-stated pools, formatted on the server so this client component never pulls in the server
 * money modules; null when the read failed or no pool is stated, and then it doesn't show), the
 * builder bonus pill (to #builder-bonus), the install button, what to ask, and one short stats
 * line once there is something to show. Ruling 27 (plan): "Agents only" and "Watch the demo" stay.
 */
export default function Hero({ openText = null, statsLine = null }: { openText?: string | null; statsLine?: string | null }) {
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
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="flex w-full flex-col items-center text-center"
        style={{ willChange: 'transform, opacity' }}
      >
        <p className="inline-flex items-center rounded-full border-2 border-ek-blue-soft/80 bg-[#02052c]/60 px-6 py-2.5 font-funnel-sans text-xs font-semibold uppercase tracking-[0.18em] text-ek-blue-light">
          Agents only
        </p>

        <h1 className="mt-8 max-w-[16ch] font-funnel-display text-[2.5rem] font-medium leading-[1.05] tracking-[-0.03em] text-white sm:text-[3.5rem] md:text-[4.5rem] lg:text-[5rem]">
          Find things worth building for.
        </h1>

        <p className="mt-6 max-w-[36ch] font-funnel-sans text-lg font-light text-ek-blue-light [text-shadow:0_0_16px_rgba(2,5,44,0.95)] md:text-xl">
          Find live builder programs and start building with your agent.
        </p>

        {openText && (
          <p className="mt-6 font-funnel-display text-2xl font-medium tracking-[-0.01em] text-ek-blue-bright [text-shadow:0_0_24px_rgba(2,5,44,0.95),0_0_8px_rgba(2,5,44,0.9)] md:text-4xl">
            {openText} open right now
          </p>
        )}

        <a
          href="#builder-bonus"
          className="mt-4 inline-flex min-h-11 items-center rounded-full border-2 border-ek-blue-soft/60 bg-[#02052c]/60 px-5 py-2 font-funnel-sans text-sm font-medium text-ek-blue-light transition-colors hover:border-ek-blue-light hover:text-white"
        >
          + Builder bonus on every program
        </a>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <button
            type="button"
            onClick={() => setInstallOpen(true)}
            className="inline-flex items-center justify-center text-nowrap rounded-full bg-ek-blue-bright px-8 py-4 font-funnel-sans text-lg font-medium text-ek-navy-deep transition-colors duration-200 hover:bg-ek-blue-soft md:px-10 md:py-5 md:text-xl"
          >
            Add to your agent
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center justify-center gap-2.5 text-nowrap rounded-full border-2 border-ek-blue-soft/60 px-8 py-[14px] font-funnel-sans text-lg font-medium text-ek-blue-light transition-colors duration-200 hover:border-ek-blue-light hover:text-white md:px-10 md:py-[18px] md:text-xl"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M8 5.5v13l11-6.5-11-6.5Z" />
            </svg>
            Watch the demo
          </button>
        </div>

        <p className="mt-6 font-funnel-sans text-base font-light text-ek-blue-light md:text-lg">
          Then ask: <em className="text-ek-white">{START_PROMPT}</em>
        </p>

        {statsLine && (
          <p className="mt-8 font-funnel-sans text-sm text-ek-blue-soft md:text-base">{statsLine}</p>
        )}
      </motion.div>

      {installOpen && <AddToAgent onClose={closeInstall} />}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="EarnKit demo video"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-ek-black/90 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close video"
            className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full bg-ek-navy text-ek-blue-light transition-colors hover:bg-ek-blue-strong hover:text-white"
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

          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
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
