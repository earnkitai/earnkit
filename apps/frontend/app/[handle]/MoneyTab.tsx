import type { ReactNode } from 'react';
import { H2, NUM, ROWS } from '../components/common/Panel';
import RaisingPill from '../components/ui/RaisingPill';
import { dollars, type MoneyTabData } from '../../lib/earnkit/bench-data';
import { POINTS_PAGE_LINE } from '../../lib/earnkit/points';

export const FITS_TITLE = 'Programs that fit';
export const APPLIED_TITLE = 'Applications';
export const BACKING_TITLE = 'Backing';
/** Empty groups invite: what will show here, in one line. */
export const FITS_EMPTY = 'Programs your project can win show here.';
export const APPLIED_EMPTY = 'Apply to a program and it shows here.';
export const STATUS_WORD = { applied: 'Applied', won: 'Won' } as const;

/** "1,200 points.", "1 point.". Pure. */
export const pointsLine = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'point' : 'points'}.`;
/** "2 backers", "1 backer". Pure. */
export const backersWords = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'backer' : 'backers'}`;

const ROW = 'grid gap-x-6 gap-y-1 border-t border-ek-line py-4 md:grid-cols-[minmax(0,1fr)_auto] md:py-5';
const EMPTY = 'border-b border-t border-ek-line py-4 font-funnel-sans text-base text-ek-body md:py-5';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10 first:mt-0 md:mt-12">
      <h2 className={H2}>{title}</h2>
      <div className="mt-4 md:mt-5">{children}</div>
    </section>
  );
}

/**
 * v3 Stage 3 (spec 5.6): the Money tab: the open programs the project can win now (each row a link to its guide:
 * the title and why it fits, the prize and when it closes), the programs applied to or won, backing while open
 * (the coin's tokens.fun link, its backers and the fees earned; the Back button is the header's), then the points
 * and what they are. Server-safe.
 */
export default function MoneyTab({ money: m }: { money: MoneyTabData }) {
  return (
    <div>
      <Group title={FITS_TITLE}>
        {m.fits.length > 0 ? (
          <ul className={ROWS}>
            {m.fits.map((f) => (
              <li key={f.href}>
                <a href={f.href} className={`group ${ROW}`}>
                  <span className="min-w-0">
                    <span className="block break-words font-funnel-display text-lg font-medium text-ek-text underline-offset-4 group-hover:underline md:text-xl">
                      {f.title}
                    </span>
                    <span className="mt-1 block font-funnel-sans text-sm text-ek-muted md:text-base">{f.why}</span>
                  </span>
                  <span className="md:text-right">
                    <span className={`${NUM} block text-lg font-medium text-ek-text md:text-xl`}>{f.prize}</span>
                    <span className="mt-1 block font-funnel-sans text-sm text-ek-muted">{f.when}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className={EMPTY}>{FITS_EMPTY}</p>
        )}
      </Group>

      <Group title={APPLIED_TITLE}>
        {m.applied.length > 0 ? (
          <ul className={ROWS}>
            {m.applied.map((a) => (
              <li key={a.title} className={ROW}>
                <span className="min-w-0 break-words font-funnel-sans text-base text-ek-text md:text-lg">{a.title}</span>
                <span className={`font-funnel-sans text-sm md:text-base ${a.status === 'won' ? 'font-medium text-ek-accent' : 'text-ek-muted'}`}>
                  {STATUS_WORD[a.status]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={EMPTY}>{APPLIED_EMPTY}</p>
        )}
      </Group>

      {m.backing ? (
        <Group title={BACKING_TITLE}>
          <div className={ROWS}>
            <div className={ROW}>
              {/* v2.13 R8: the coin's pill (the one link to its tokens.fun page here; the Back button is the header's). */}
              <div><RaisingPill symbol={m.backing.symbol} url={m.backing.url} size="lg" /></div>
              <p className="font-funnel-sans text-base text-ek-body">
                {backersWords(m.backing.backers)}, {dollars(m.backing.earned_usd)} earned
              </p>
            </div>
          </div>
        </Group>
      ) : null}

      <p className="mt-10 max-w-[36rem] font-funnel-sans text-sm text-ek-muted md:mt-12 md:text-base">
        <span className="font-medium tabular-nums text-ek-text">{pointsLine(m.points)}</span> {POINTS_PAGE_LINE}
      </p>
    </div>
  );
}
