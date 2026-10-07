'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Eyebrow, Panel } from '../common/Panel';
import AddToAgent from './AddToAgent';
import ProgramLogo from './ProgramLogo';
import type { Tile } from '../../../lib/earnkit/landing';

/** v2.7.1: the line under the title, on the homepage and /programs. */
export const BONUS_LINE = 'Every entry also competes for the builder bonus.';

const CHIP = 'rounded-full bg-ek-navy-deep px-3 py-1.5 font-funnel-sans text-sm text-ek-blue-light';

/**
 * v2.7 §1, v2.7.1: the open curated programs, sorted by prize (landing.ts). Each card: logo, title
 * and chain, the big line (the pool, else the per-winner amount), "up to $X per winner" under it
 * when different, then chips for the deadline, the difficulty and the builder bonus ("+ Builder
 * bonus", "+ 0.42 ETH bonus"); "Ask your agent" opens the install modal with "What can I earn on
 * <program>?", "Guide" opens /programs/<id>. /programs (heading h1) also shows the hero's figure.
 */
export default function ProgramCards({
  tiles,
  limit,
  seeAll = false,
  mobileLimit,
  heading = 'h2',
  figure = null,
}: {
  tiles: Tile[];
  limit?: number;
  seeAll?: boolean;
  /** Cards shown below `sm`; the rest are hidden there and "See all programs" follows. */
  mobileLimit?: number;
  /** v2.7 /programs: the cards are the page, so their heading is its h1. */
  heading?: 'h1' | 'h2';
  /** v2.7.1 /programs: the landing page's "$1.3M+" (the same pool total), shown under the title. */
  figure?: string | null;
}) {
  const Heading = heading;
  const [asking, setAsking] = useState<string | null>(null);
  const close = useCallback(() => setAsking(null), []);
  const shown = limit === undefined ? tiles : tiles.slice(0, limit);
  const more = seeAll && limit !== undefined && tiles.length > limit;
  const moreMobile = seeAll && mobileLimit !== undefined && tiles.length > mobileLimit;

  return (
    <Panel label="Open programs" className="py-12 md:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {heading === 'h1' && <Eyebrow>By prize</Eyebrow>}
          <Heading className={`${heading === 'h1' ? 'mt-4 ' : ''}font-funnel-display text-3xl font-medium text-ek-white md:text-5xl`}>
            Open programs
          </Heading>
          {figure && (
            <p className="mt-4 font-funnel-display text-2xl font-medium text-ek-blue-bright md:text-3xl">{figure} open right now</p>
          )}
          <p className="mt-3 font-funnel-sans text-base font-light text-ek-blue-light md:text-lg">{BONUS_LINE}</p>
        </div>
        {more && (
          <Link
            href="/programs"
            className="hidden min-h-11 items-center px-2 font-funnel-sans text-base font-medium text-ek-blue-bright underline-offset-4 transition-colors hover:text-ek-white hover:underline sm:inline-flex"
          >
            See all
          </Link>
        )}
      </div>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 md:mt-10">
        {shown.map((t, i) => (
          <li
            key={t.id}
            className={`flex-col rounded-[32px] bg-ek-navy p-6 ${mobileLimit !== undefined && i >= mobileLimit ? 'hidden sm:flex' : 'flex'}`}
          >
            <div className="flex items-center gap-4">
              <ProgramLogo logo={t.logo} title={t.title} size={48} />
              <div className="min-w-0">
                <h3 className="font-funnel-display text-xl font-medium leading-tight text-ek-white">{t.title}</h3>
                {t.chain && <p className="mt-1 font-funnel-sans text-sm text-ek-blue-soft">{t.chain}</p>}
              </div>
            </div>

            <div className="mt-6 flex-1">
              <p className="font-funnel-display text-2xl font-medium text-ek-white">{t.prize}</p>
              {t.prize_note && <p className="mt-1 font-funnel-sans text-sm text-ek-blue-soft">{t.prize_note}</p>}
              <ul className="mt-4 flex flex-wrap gap-2">
                <li className={CHIP}>{t.ends}</li>
                {t.difficulty !== '—' && <li className={CHIP}>{t.difficulty}</li>}
                {t.bonus && (
                  <li className="rounded-full border border-ek-blue-bright/60 px-3 py-[5px] font-funnel-sans text-sm font-medium text-ek-blue-bright">
                    {t.bonus}
                  </li>
                )}
              </ul>
            </div>

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setAsking(t.title)}
                className="inline-flex flex-1 items-center justify-center text-nowrap rounded-full bg-ek-blue-bright px-5 py-3 font-funnel-sans text-base font-medium text-ek-navy-deep transition-colors hover:bg-ek-blue-soft"
              >
                Ask your agent
              </button>
              <Link
                href={`/programs/${t.id}`}
                className="inline-flex items-center justify-center rounded-full border-2 border-ek-blue-soft/50 px-5 py-[10px] font-funnel-sans text-base font-medium text-ek-blue-light transition-colors hover:border-ek-blue-light hover:text-white"
              >
                Guide
              </Link>
            </div>
          </li>
        ))}
      </ul>

      {moreMobile && (
        <Link
          href="/programs"
          className="mt-4 flex min-h-12 items-center justify-center rounded-full border-2 border-ek-blue-soft/50 font-funnel-sans text-base font-medium text-ek-blue-light transition-colors hover:border-ek-blue-light hover:text-white sm:hidden"
        >
          See all programs
        </Link>
      )}

      {asking && <AddToAgent onClose={close} prompt={`What can I earn on ${asking}?`} />}
    </Panel>
  );
}
