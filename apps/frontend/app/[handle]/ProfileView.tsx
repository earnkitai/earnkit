import type { ReactNode } from 'react';
import Footer from '../components/common/Footer';
import { Panel } from '../components/common/Panel';
import ScoreRing from '../b/[slug]/ScoreRing';
import { SOURCES_LINE, type PageCard, type PageHead } from '../../lib/earnkit/page-data';
import Avatar from './Avatar';
import ProjectCards from './ProjectCards';

/**
 * v2.12.1 spec "Profile": the page at earnkit.com/<x-handle>. The one dominant sentence is what they
 * made; under it, only beside a rank that reads well, the score ring, the rank and the people line.
 * Then the projects (`children`, streamed by the page; else `cards`, null for skeletons) and a
 * quiet line on where the numbers come from. Sentence case, no labels, no badges. Pure.
 */
export default function ProfileView({ head, cards = null, children }: { head: PageHead; cards?: PageCard[] | null; children?: ReactNode }) {
  const named = head.name !== `@${head.handle}`;
  return (
    <div className="w-full pt-4">
      <Panel className="relative overflow-hidden py-10 md:py-16" label="Profile">
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-48 h-[28rem] w-[28rem] rounded-full bg-ek-score-purple/[0.09] blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-56 -left-32 h-[24rem] w-[24rem] rounded-full bg-ek-score-orange/[0.05] blur-3xl" />
        <div className="relative">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar src={head.avatar} handle={head.handle} className="h-14 w-14 text-xl md:h-16 md:w-16" />
            <div className="min-w-0 font-funnel-sans">
              {named ? <p className="truncate text-base font-medium text-ek-white md:text-lg">{head.name}</p> : null}
              <p className={`truncate ${named ? 'text-sm' : 'text-base font-medium md:text-lg'} text-ek-blue-soft`}>@{head.handle}</p>
            </div>
          </div>
          <h1 className="mt-8 max-w-4xl text-balance break-words font-funnel-display text-[2.125rem] font-medium leading-[1.1] tracking-tight text-ek-white sm:text-5xl md:mt-12 md:text-[4rem] md:leading-[1.05]">
            {head.topLine}
          </h1>
          {head.rank && head.score !== null ? (
            <div className="mt-8 flex items-center gap-5 md:mt-10 md:gap-6">
              <ScoreRing score={head.score} className="h-[5.5rem] w-[5.5rem] md:h-28 md:w-28" numberClassName="text-[1.75rem] md:text-[2.25rem]" />
              <div className="min-w-0">
                <p className="font-funnel-display text-xl font-medium leading-snug text-ek-white md:text-3xl">{head.rank}</p>
                {head.peopleLine ? <p className="mt-1 font-funnel-sans text-base font-light text-ek-blue-light md:text-lg">{head.peopleLine}</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel className="mt-4 py-8 md:py-12" label="Projects">
        <h2 className="mb-5 font-funnel-display text-xl font-medium text-ek-white md:mb-6 md:text-2xl">Projects</h2>
        {children ?? <ProjectCards cards={cards} />}
        <p className="mt-8 max-w-3xl font-funnel-sans text-xs leading-relaxed text-ek-blue-soft md:mt-10 md:text-sm">{SOURCES_LINE}</p>
      </Panel>
      <Footer />
    </div>
  );
}
