import type { ReactNode } from 'react';
import Link from 'next/link';
import Footer from '../../components/common/Footer';
import { Eyebrow, Panel } from '../../components/common/Panel';
import ProgramLogo from '../../components/sections/ProgramLogo';
import AskAgent from './AskAgent';
import { difficultyBasis, difficultyLabel, wonHeading, type GuideSource } from '../../../lib/earnkit/guide';

/** v2.8 Ruling 13 (plan), Task 3 carry: the guide page (not the slim card) says a program fits any chain. */
export const ANY_CHAIN = 'Any chain';
import BonusPill from '../../components/ui/BonusPill';
import type { GuidePage } from '../../../lib/earnkit/landing';
import { shownUrl } from '../../../lib/earnkit/untrusted-text';

/** The guide's question for the agent (spec Decisions: "What can I earn?", on this program). */
export const askPrompt = (title: string) => `What can I earn on ${title}?`;

const SECONDARY =
  'inline-flex min-h-12 items-center justify-center rounded-full border-2 border-ek-blue-soft/50 px-7 py-[10px] font-funnel-sans text-base font-medium text-ek-blue-light transition-colors hover:border-ek-blue-light hover:text-white';
const LINK = 'text-ek-white underline underline-offset-4 transition-colors hover:text-ek-blue-soft';

/** One guide part: the heading left, its one-line items right (stacked on mobile). */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel label={title} className="py-8 md:py-10">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12">
        <h2 className="font-funnel-display text-xl font-medium text-ek-white md:text-2xl">{title}</h2>
        {children}
      </div>
    </Panel>
  );
}

/** "USDC payroll and payouts (3 of 20 winners)": the theme bright, its count quiet. */
function WonLine({ line }: { line: string }) {
  const m = line.match(/^(.*) (\([^()]*\))$/);
  return m ? (
    <>
      <span className="text-ek-white">{m[1]}</span> <span className="text-ek-blue-soft">{m[2]}</span>
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
    <p className="mt-6 font-funnel-sans text-sm font-light leading-relaxed text-ek-blue-soft">
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
 * program), the sources and the footer. v2.7.1: the builder bonus is a pill beside Difficulty. Same text as get_program (guide.ts).
 */
export default function GuideView({ page }: { page: GuidePage }) {
  const g = page.guide;
  const facts = g.header.startsWith(`${page.title} · `) ? g.header.slice(page.title.length + 3) : g.header;
  return (
    <div className="w-full pt-4">
      <div className="flex flex-col gap-4">
        <Panel className="py-10 md:py-16">
          <Eyebrow>Program guide</Eyebrow>
          <div className="mt-6 flex items-center gap-4 md:gap-6">
            <ProgramLogo logo={page.logo} title={page.title} size={56} />
            <h1 className="min-w-0 font-funnel-display text-3xl font-medium leading-tight text-ek-white md:text-5xl">
              {page.title}
            </h1>
          </div>
          <p className="mt-6 font-funnel-display text-xl font-medium text-ek-blue-light md:text-3xl">
            {page.any_chain ? `${facts} · ${ANY_CHAIN}` : facts}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
            <dl className="font-funnel-sans text-base text-ek-blue-soft md:text-lg">
              <dt className="inline">Difficulty:</dt>{' '}
              <dd className="inline">
                {/* v2.8 Ruling 12 (plan): an EarnKit rating is the level alone, no basis. */}
                {g.difficulty.rated ? (
                  <span className="font-medium text-ek-white">{difficultyLabel(g.difficulty)}</span>
                ) : (
                  <>
                    <span className="font-medium text-ek-white">{difficultyLabel(g.difficulty)}.</span> {difficultyBasis(g.difficulty)}
                  </>
                )}
              </dd>
            </dl>
            {/* v2.8 Ruling 19 (plan): the builder bonus pill beside Difficulty, linking to the leaderboard. */}
            {page.has_bonus && page.board_path && <BonusPill size="md" amount={page.bonus_amount} href={page.board_path} />}
          </div>
          {/* Fix round 1: the next step above the fold on mobile; the action row below repeats it. */}
          {page.open && (
            <div className="mt-8">
              <AskAgent prompt={askPrompt(page.title)} />
            </div>
          )}
        </Panel>

        {g.won && (
          <Part title={wonHeading(g.won)}>
            <div>
              {/* Ruling C12: the event behind a round that isn't this program's own. */}
              {g.won.event && (
                <p className="mb-4 font-funnel-sans text-sm text-ek-blue-soft md:text-base">{g.won.event}</p>
              )}
              <ul className="space-y-3 font-funnel-sans text-base text-ek-blue-light md:text-lg">
                {g.won.lines.map((l) => (
                  <li key={l} className="flex gap-3">
                    <span aria-hidden="true" className="mt-[0.6em] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ek-blue-bright" />
                    <span>
                      <WonLine line={l} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Part>
        )}

        {g.wants && (
          <Part title={`What ${g.wants.ecosystem} wants now`}>
            <ul className="flex flex-wrap gap-2 font-funnel-sans text-base text-ek-white md:text-lg">
              {g.wants.areas.map((a) => (
                <li key={a} className="rounded-full bg-ek-navy px-4 py-2">
                  {a}
                </li>
              ))}
            </ul>
          </Part>
        )}

        {g.best_bet && (
          <Part title="Your best bet">
            <ul>
              <li className="font-funnel-display text-xl font-medium text-ek-white md:text-2xl">{g.best_bet}</li>
            </ul>
          </Part>
        )}

        <Panel className="py-8 md:py-10">
          <div className="flex flex-col gap-3 sm:flex-row">
            {page.open && <AskAgent prompt={askPrompt(page.title)} />}
            <Link href="/programs" className={SECONDARY}>
              All programs
            </Link>
          </div>
          <Sources sources={page.sources} />
        </Panel>
      </div>

      <Footer />
    </div>
  );
}

/** The panel a page shows when its read failed (HTTP 200, no stack): one line, then the footer. */
export function Unavailable({ text }: { text: string }) {
  return (
    <div className="w-full pt-4">
      <Panel className="py-12 md:py-16">
        <p className="font-funnel-sans text-lg text-ek-blue-light">{text}</p>
        <Link href="/" className={`${LINK} mt-4 inline-flex min-h-11 items-center font-funnel-sans text-base`}>
          EarnKit home
        </Link>
      </Panel>
      <Footer />
    </div>
  );
}
