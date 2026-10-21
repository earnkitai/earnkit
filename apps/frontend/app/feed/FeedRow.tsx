import Link from 'next/link';
import Avatar from '../[handle]/Avatar';
import ScoreText from '../components/site/ScoreText';
import XHandle from '../components/site/XHandle';
import { CARD_NEUTRAL } from '../components/site/ui';
import type { FeedCard } from '../../lib/earnkit/feed';
import { pagePath } from '../../lib/earnkit/reserved-routes';

/**
 * The row: the neutral card at 28px, the border brightening and a 4px lift on hover, both only without reduced motion.
 * A phone grid (the person block, the score at its right, the words below) that becomes the board's one wrapping line from md.
 */
const ROW = `${CARD_NEUTRAL.replace('rounded-[32px]', 'rounded-[28px]').replace('transition-colors duration-200', 'motion-safe:transition-[border-color,transform] motion-safe:duration-200')} grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3.5 px-[26px] py-[22px] motion-safe:hover:-translate-y-1 md:flex md:flex-wrap md:gap-[22px]`;

/** "EarnKit · 279 commits"; the project alone at 0 commits. Pure. */
export function feedMeta(c: Pick<FeedCard, 'project' | 'commits'>): string {
  if (c.commits <= 0) return c.project;
  return `${c.project} · ${c.commits.toLocaleString('en-US')} ${c.commits === 1 ? 'commit' : 'commits'}`;
}

/** The week's words: the summary, else the builder's note, else the fact chips; '' when none. Pure. */
export const feedWords = (c: Pick<FeedCard, 'summary' | 'text' | 'chips'>): string => c.summary || c.text || c.chips.join(' · ');

/** The builder's own note under the summary: only beside a summary, non-empty and not the same words; else null. Pure. */
export const feedNote = (c: Pick<FeedCard, 'summary' | 'text'>): string | null => {
  const note = c.text?.trim();
  return c.summary && note && note !== c.summary.trim() ? note : null;
};

/**
 * v3.1 site Task 9: one feed row (Feed board): the X photo, the name (to the builder's page) and the X glyph and @handle
 * (to X) as two separate links, the project and the week's commits, the week's words (and the builder's own note, quoted,
 * under a summary), the Shipping score in its band
 * colour (none while unknown). Names, projects and words wrap, never widen the page.
 */
export default function FeedRow({ c }: { c: FeedCard }) {
  const words = feedWords(c);
  const note = feedNote(c);
  return (
    <article data-ek-feed-row={c.id} className={ROW}>
      <div className="flex min-w-0 items-center gap-3 md:flex-[0_0_240px]">
        <Avatar src={c.avatar} handle={c.handle} className="h-12 w-12 text-lg" />
        <div className="flex min-w-0 flex-col items-start">
          {/* 44px tap targets on a phone, stacked edge to edge (no overlap): each pulls in only its outer side. */}
          <Link href={pagePath(c.handle)} className="-mt-[11px] inline-flex min-h-11 max-w-full items-center text-base font-semibold hover:text-s-text md:mt-0 md:min-h-0">
            <span className="min-w-0 [overflow-wrap:anywhere]">{c.name}</span>
          </Link>
          <XHandle handle={c.handle} className="-mb-[13px] min-h-11 md:mb-0 md:min-h-0" />
        </div>
      </div>
      <div className="col-span-2 flex min-w-0 flex-col gap-1 md:flex-[1_1_420px]">
        <span className="text-[13px] font-semibold text-s-card-meta [overflow-wrap:anywhere]">{feedMeta(c)}</span>
        {words ? <p className="text-[15px] leading-[1.55] text-s-card-body [overflow-wrap:anywhere]">{words}</p> : null}
        {/* The builder's note, quoted as plain text (never a link), at most two lines. */}
        {note ? (
          <blockquote data-ek-note="" className="mt-0.5 border-l-2 border-s-line-hover pl-3 text-sm leading-normal text-s-muted">
            <p className="line-clamp-2 [overflow-wrap:anywhere]">{note}</p>
          </blockquote>
        ) : null}
      </div>
      {c.score !== null ? (
        <span className="col-start-2 row-start-1 shrink-0">
          <ScoreText score={c.score} size={32} />
          <span className="sr-only"> Shipping</span>
        </span>
      ) : null}
    </article>
  );
}
