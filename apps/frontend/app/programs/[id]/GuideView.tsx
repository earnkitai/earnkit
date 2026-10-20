import type { ReactNode } from 'react';
import Link from 'next/link';
import Footer from '../../components/common/Footer';
import { COLUMN, Panel } from '../../components/common/Panel';
import { BTN_SECONDARY } from '../../components/common/Button';
import ProgramLogo from '../../components/sections/ProgramLogo';
import AskAgent from './AskAgent';
import { difficultyBasis, difficultyLabel, wonHeading, type GuideSource } from '../../../lib/earnkit/guide';
import type { GuidePage } from '../../../lib/earnkit/landing';
import { shownUrl } from '../../../lib/earnkit/untrusted-text';

/** v2.8 Ruling 13 (plan), Task 3 carry: the guide page (not the slim card) says a program fits any chain. */
export const ANY_CHAIN = 'Any chain';

/** The guide's question for the agent (spec Decisions: "What can I earn?", on this program). */
export const askPrompt = (title: string) => `What can I earn on ${title}?`;

const LINK = 'text-ek-body underline underline-offset-4 transition-colors hover:text-ek-text';

/** One guide part: the heading left, its one-line items right (stacked on mobile); hairlines between parts. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-4 border-t border-ek-line py-8 first:border-t-0 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12 md:py-10">
      <h2 className="font-funnel-display text-xl font-medium text-ek-text md:text-2xl">{title}</h2>
      {children}
    </section>
  );
}

/** "USDC payroll and payouts (3 of 20 winners)": the theme bright, its count quiet. */
function WonLine({ line }: { line: string }) {
  const m = line.match(/^(.*) (\([^()]*\))$/);
  return m ? (
    <>
      <span className="text-ek-text">{m[1]}</span> <span className="text-ek-muted">{m[2]}</span>
    </>
  ) : (
    <span>{line}</span>
  );
}

/** "Sources:" links, each the canonical https form (shownUrl), labelled by what it backs. */
function Sources({ sources }: { sources: GuideSource[] }) {
  const links = sources.flatMap((s) => {
    const url = shownUrl(s.url);
    return url ? [{ label: s.label, url }] : [];
  });
  if (links.length === 0) return null;
  return (
    <p className="font-funnel-sans text-sm leading-relaxed text-ek-muted">
      Sources:{' '}
      {links.map((l, i) => (
        <span key={l.url}>
          {i > 0 && ' · '}
          <a
            href={l.url}
            title={new URL(l.url).hostname}
            target="_blank"
            rel="noopener noreferrer"
            className={`${LINK} inline-block py-1.5`}
          >
            {l.label}
          </a>
        </span>
      ))}
    </p>
  );
}

/**
 * v2.7 §2, Ruling 22 (plan): one curated program's guide (/programs/<id>). Pure: the header (logo,
 * title, prize and end, difficulty with its basis), then one panel per guide part that has data
 * (what won, what the ecosystem wants, the best bet), then "Ask your agent" (not on a closed
 * program), the sources and the footer. Same text as get_program (guide.ts).
 */
export default function GuideView({ page }: { page: GuidePage }) {
  const g = page.guide;
  const facts = g.header.startsWith(`${page.title} · `) ? g.header.slice(page.title.length + 3) : g.header;
  const parts = Boolean(g.won || g.wants || g.best_bet);
  return (
    <>
      <div className={`${COLUMN} pt-8 md:pt-12`}>
        <section aria-label={page.title}>
          <div className="flex items-center gap-4 md:gap-5">
            <ProgramLogo logo={page.logo} title={page.title} size={48} />
            <h1 className="min-w-0 font-funnel-display text-3xl font-medium leading-tight tracking-[-0.02em] text-ek-text md:text-5xl">
              {page.title}
            </h1>
          </div>
          <p className="mt-5 font-funnel-display text-xl font-medium text-ek-text md:text-2xl">
            {page.any_chain ? `${facts} · ${ANY_CHAIN}` : facts}
          </p>
          {/* v3 Stage 2: an upcoming program's one line (opens_note) under the header; it has no Ask button (page.open is false). */}
          {page.upcoming && g.opens_note && <p className="mt-2 font-funnel-sans text-base text-ek-body">{g.opens_note}</p>}
          <dl className="mt-2 font-funnel-sans text-base text-ek-muted">
            <dt className="inline">Difficulty:</dt>{' '}
            <dd className="inline">
              {/* v2.8 Ruling 12 (plan): an EarnKit rating is the level alone, no basis. */}
              {g.difficulty.rated ? (
                <span className="text-ek-body">{difficultyLabel(g.difficulty)}</span>
              ) : (
                <>
                  <span className="text-ek-body">{difficultyLabel(g.difficulty)}.</span> {difficultyBasis(g.difficulty)}
                </>
              )}
            </dd>
          </dl>
          {page.open && (
            <div className="mt-6">
              <AskAgent prompt={askPrompt(page.title)} />
            </div>
          )}
        </section>

        {parts && (
          <Panel className="mt-8 py-2 md:mt-10">
            {g.won && (
              <Part title={wonHeading(g.won)}>
                <div>
                  {/* Ruling C12: the event behind a round that isn't this program's own. */}
                  {g.won.event && <p className="mb-3 font-funnel-sans text-sm text-ek-muted">{g.won.event}</p>}
                  <ul className="space-y-2 font-funnel-sans text-base text-ek-body">
                    {g.won.lines.map((l) => (
                      <li key={l}>
                        <WonLine line={l} />
                      </li>
                    ))}
                  </ul>
                </div>
              </Part>
            )}

            {g.wants && (
              <Part title={`What ${g.wants.ecosystem} wants now`}>
                <ul className="flex flex-wrap gap-2 font-funnel-sans text-base text-ek-body">
                  {g.wants.areas.map((a) => (
                    <li key={a} className="rounded-full bg-ek-chip px-4 py-2">
                      {a}
                    </li>
                  ))}
                </ul>
              </Part>
            )}

            {g.best_bet && (
              <Part title="Your best bet">
                <ul>
                  <li className="font-funnel-display text-xl font-medium text-ek-text">{g.best_bet}</li>
                </ul>
              </Part>
            )}
          </Panel>
        )}

        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/programs" className={`${BTN_SECONDARY} self-start`}>
            All programs
          </Link>
          <Sources sources={page.sources} />
        </div>
      </div>

      <Footer />
    </>
  );
}

/** The panel a page shows when its read failed (HTTP 200, no stack): one line, then the footer. */
export function Unavailable({ text }: { text: string }) {
  return (
    <>
      <div className={`${COLUMN} pt-8 md:pt-12`}>
        <p className="font-funnel-sans text-lg text-ek-body">{text}</p>
        <Link href="/" className={`${LINK} mt-4 inline-flex min-h-11 items-center font-funnel-sans text-base`}>
          EarnKit home
        </Link>
      </div>
      <Footer />
    </>
  );
}
