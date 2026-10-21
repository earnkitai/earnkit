import type { ReactNode } from 'react';
import Link from 'next/link';
import Footer from '../../components/common/Footer';
import { ROWS } from '../../components/common/Panel';
import { PAGE_COL } from '../../components/site/ui';
import { TEXT_LINK } from '../../components/common/Button';
import ProgramLogo from '../../components/sections/ProgramLogo';
import AskAgent from './AskAgent';
import { difficultyBasis, difficultyLabel, wonHeading, type GuideSource } from '../../../lib/earnkit/guide';
import type { GuidePage } from '../../../lib/earnkit/landing';
import { shownUrl } from '../../../lib/earnkit/untrusted-text';

/** v2.8 Ruling 13 (plan), Task 3 carry: the guide page (not the slim card) says a program fits any chain. */
export const ANY_CHAIN = 'Any chain';

/** The guide's question for the agent (spec Decisions: "What can I earn?", on this program). */
export const askPrompt = (title: string) => `What can I earn on ${title}?`;

/** v3.1 site Task 10: the guide's titles in Kaftan Serif on the 1200px column (no structural change). */
const H1 = 'ek-serif text-[40px] leading-none text-ek-text md:text-[56px]';
const H2 = 'ek-serif text-[28px] leading-none text-ek-text md:text-[36px]';

const LINK = 'text-ek-body underline underline-offset-4 transition-colors hover:text-ek-text';

/** One guide part, a hairline row: the heading left, its items right (stacked on a phone). */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-4 border-t border-ek-line py-8 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12 md:py-10">
      <h2 className={H2}>{title}</h2>
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

/** "Sources:" links, each the canonical https form (shownUrl), labelled by what it backs, spaced apart. */
function Sources({ sources }: { sources: GuideSource[] }) {
  const links = sources.flatMap((s) => {
    const url = shownUrl(s.url);
    return url ? [{ label: s.label, url }] : [];
  });
  if (links.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-funnel-sans text-sm text-ek-muted">
      <span>Sources:</span>
      {links.map((l) => (
        <a key={l.url} href={l.url} title={new URL(l.url).hostname} target="_blank" rel="noopener noreferrer" className={`${LINK} inline-flex min-h-11 items-center`}>
          {l.label}
        </a>
      ))}
    </p>
  );
}

/**
 * v2.7 §2, Ruling 22 (plan), v3 Stage 3 (spec 5.8): one curated program's guide (/programs/<id>). Pure: the logo
 * beside the title, the facts as separate muted spans (the award, when it closes or "rolling" or "not open yet",
 * the chain), an upcoming program's opens_note, the Difficulty line with its basis, "Ask your agent" (open programs
 * only), then one hairline row per guide part that has data (what won, what the ecosystem wants, the best bet),
 * "All programs" and the sources. Same text as get_program (guide.ts).
 */
export default function GuideView({ page }: { page: GuidePage }) {
  const g = page.guide;
  const facts = (g.header.startsWith(`${page.title} · `) ? g.header.slice(page.title.length + 3) : g.header).split(' · ');
  const chain = page.any_chain ? ANY_CHAIN : page.chain ?? null;
  if (chain) facts.push(chain);
  const parts = Boolean(g.won || g.wants || g.best_bet);
  return (
    <>
      <div className={`${PAGE_COL} pt-8 md:pt-12`}>
        <section aria-label={page.title}>
          <div className="flex items-center gap-4 md:gap-5">
            <ProgramLogo logo={page.logo} title={page.title} size={56} />
            <h1 className={`${H1} min-w-0 [overflow-wrap:break-word]`}>{page.title}</h1>
          </div>
          <p className="mt-5 flex flex-col gap-y-1 font-funnel-sans text-base text-ek-muted md:flex-row md:flex-wrap md:items-center md:gap-x-4 md:text-lg">
            {/* Task 7: each fact starts with a capital, as the row chips do ("Rolling", "Not open yet"); keyed by position, two facts can read alike. */}
            {facts.map((f, i) => (
              <span key={i} className={i > 0 ? 'md:border-l md:border-ek-line md:pl-4' : ''}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </span>
            ))}
          </p>
          {/* v3 Stage 2: an upcoming program's one line (opens_note) under the facts; it has no Ask button (page.open is false). */}
          {page.upcoming && g.opens_note && <p className="mt-3 max-w-[36rem] font-funnel-sans text-base text-ek-body md:text-lg">{g.opens_note}</p>}
          <dl className="mt-3 font-funnel-sans text-base text-ek-muted">
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
            <div className="mt-8">
              <AskAgent prompt={askPrompt(page.title)} />
            </div>
          )}
        </section>

        {parts && (
          <div className={`${ROWS} mt-10 md:mt-14`}>
            {g.won && (
              <Part title={wonHeading(g.won)}>
                <div>
                  {/* Ruling C12: the event behind a round that isn't this program's own. */}
                  {g.won.event && <p className="mb-3 font-funnel-sans text-sm text-ek-muted">{g.won.event}</p>}
                  <ul className="space-y-2 font-funnel-sans text-base text-ek-body md:text-lg">
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
                <ul className="flex flex-wrap gap-2 self-center font-funnel-sans text-base text-ek-body">
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
                <ul className="self-center">
                  <li className="font-funnel-display text-xl font-medium text-ek-text md:text-2xl">{g.best_bet}</li>
                </ul>
              </Part>
            )}
          </div>
        )}

        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between md:mt-10">
          <Link href="/#earn" className={TEXT_LINK}>
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
      <div className={`${PAGE_COL} pt-8 md:pt-12`}>
        <p className="font-funnel-sans text-lg text-ek-body">{text}</p>
        <Link href="/" className={`${LINK} mt-4 inline-flex min-h-11 items-center font-funnel-sans text-base`}>
          EarnKit home
        </Link>
      </div>
      <Footer />
    </>
  );
}
