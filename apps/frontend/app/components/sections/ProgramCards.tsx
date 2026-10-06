'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Eyebrow, Panel } from '../common/Panel';
import AddToAgent from './AddToAgent';
import ProgramLogo from './ProgramLogo';
import type { Tile } from '../../../lib/earnkit/landing';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-ek-blue-soft/15 py-2.5">
      <dt className="font-funnel-sans text-sm text-ek-blue-soft">{label}</dt>
      <dd className="text-right font-funnel-sans text-sm font-medium text-ek-white">{value}</dd>
    </div>
  );
}

/**
 * v2.7 §1: the open curated programs, sorted by prize (landing.ts). Each card: logo, title and
 * chain, the prize first, then the deadline, difficulty and builder bonus; "Ask your agent" opens
 * the install modal with "What can I earn on <program>?", "Guide" opens /programs/<id>.
 */
export default function ProgramCards({ tiles, limit, seeAll = false }: { tiles: Tile[]; limit?: number; seeAll?: boolean }) {
  const [asking, setAsking] = useState<string | null>(null);
  const close = useCallback(() => setAsking(null), []);
  const shown = limit === undefined ? tiles : tiles.slice(0, limit);
  const more = seeAll && limit !== undefined && tiles.length > limit;

  return (
    <Panel label="Open programs" className="py-12 md:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Open now</Eyebrow>
          <h2 className="mt-4 font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">Open programs</h2>
        </div>
        {more && (
          <Link
            href="/programs"
            className="font-funnel-sans text-base font-medium text-ek-blue-bright underline-offset-4 transition-colors hover:text-ek-white hover:underline"
          >
            See all
          </Link>
        )}
      </div>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 md:mt-10">
        {shown.map((t) => (
          <li key={t.id} className="flex flex-col rounded-[32px] bg-ek-navy p-6">
            <div className="flex items-center gap-4">
              <ProgramLogo logo={t.logo} title={t.title} size={48} />
              <div className="min-w-0">
                <h3 className="font-funnel-display text-xl font-medium leading-tight text-ek-white">{t.title}</h3>
                {t.chain && <p className="mt-1 font-funnel-sans text-sm text-ek-blue-soft">{t.chain}</p>}
              </div>
            </div>

            <dl className="mt-6 flex flex-1 flex-col">
              <div className="pb-4">
                <dt className="font-funnel-sans text-sm text-ek-blue-soft">Prize</dt>
                <dd className="mt-1 font-funnel-display text-2xl font-medium text-ek-white">{t.prize}</dd>
              </div>
              <Row label="Ends" value={t.ends} />
              <Row label="Difficulty" value={t.difficulty} />
              {t.bonus && <Row label="Builder bonus" value={t.bonus} />}
            </dl>

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

      {asking && <AddToAgent onClose={close} prompt={`What can I earn on ${asking}?`} />}
    </Panel>
  );
}
