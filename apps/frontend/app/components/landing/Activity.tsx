import Link from 'next/link';
import Avatar from '../../[handle]/Avatar';
import InstallButton from '../common/InstallButton';
import ScoreText from '../site/ScoreText';
import XHandle from '../site/XHandle';
import { CARD_NEUTRAL, H2_SITE } from '../site/ui';
import type { FeedCard } from '../../../lib/earnkit/feed';
import { pagePath } from '../../../lib/earnkit/reserved-routes';
import { ACTIVITY_INVITE_TEXT, ACTIVITY_INVITE_TITLE, ACTIVITY_MORE, ACTIVITY_TITLE, CTA_INSTALL } from '../../../lib/earnkit/site-copy';
import { weekLabel } from '../../../lib/earnkit/weeks';

/** A card: the neutral gradient, the border brightening and a 4px lift on hover, both only without reduced motion. */
const CARD = `${CARD_NEUTRAL.replace('motion-safe:transition-colors duration-200', 'motion-safe:transition-[border-color,transform] motion-safe:duration-200')} flex min-h-[230px] min-w-0 flex-col gap-3.5 p-[26px] motion-safe:hover:-translate-y-1`;

/** "EarnKit · Week of Oct 12 · 279 commits"; no commits part at 0. Pure. */
export function activityMeta(c: Pick<FeedCard, 'project' | 'week' | 'commits'>): string {
  const parts = [c.project, weekLabel(c.week)];
  if (c.commits > 0) parts.push(`${c.commits.toLocaleString('en-US')} ${c.commits === 1 ? 'commit' : 'commits'}`);
  return parts.join(' · ');
}

/** The week's words: the summary, else the builder's note, else the fact chips. */
const words = (c: FeedCard): string => c.summary || c.text || c.chips.join(' · ');

function UpdateCard({ c }: { c: FeedCard }) {
  const body = words(c);
  return (
    <article className={CARD}>
      <div className="flex items-center gap-3">
        <Avatar src={c.avatar} handle={c.handle} className="h-11 w-11 text-base" />
        <div className="flex min-w-0 flex-1 flex-col items-start">
          {/* 44px tap targets on a phone, stacked edge to edge (no overlap): each pulls in only its outer side. */}
          <Link href={pagePath(c.handle)} className="-mt-[11px] inline-flex min-h-11 max-w-full items-center text-[15px] font-semibold md:mt-0 md:min-h-0">
            <span className="truncate">{c.name}</span>
          </Link>
          <XHandle handle={c.handle} className="-mb-[13px] min-h-11 md:mb-0 md:min-h-0" />
        </div>
        {c.score !== null ? <ScoreText score={c.score} size={32} unit="text-s-card-meta" className="shrink-0" /> : null}
      </div>
      {body ? <p className="line-clamp-5 text-[15px] leading-[1.6] text-s-card-body [overflow-wrap:anywhere]">{body}</p> : null}
      <span className="mt-auto text-[13px] text-s-card-meta [overflow-wrap:anywhere]">{activityMeta(c)}</span>
    </article>
  );
}

/** The invite beside one or two real cards: where the visitor's week would be. Beside one card it spans the two free columns. */
function InviteCard({ wide }: { wide: boolean }) {
  return (
    <article data-ek-invite="" className={`${CARD} items-start${wide ? ' md:col-span-2' : ''}`}>
      <h3 className="ek-serif text-[32px] leading-none">{ACTIVITY_INVITE_TITLE}</h3>
      <p className="text-[15px] leading-[1.6] text-s-card-body">{ACTIVITY_INVITE_TEXT}</p>
      <InstallButton
        label={CTA_INSTALL}
        className="mt-auto inline-flex min-h-11 items-center rounded-full bg-s-light px-6 text-[15px] font-bold text-s-ink hover:bg-s-light-hover motion-safe:transition-colors motion-safe:duration-200"
      />
    </article>
  );
}

/**
 * "Activity" (Landing board, W1): the feed's first three cards (landing.activity) with "See the leaderboard";
 * one or two cards add the invite card once (beside one card it is two columns wide, so the row is always full); none
 * hides the section. The cards are one a builder (landing.ts oneEach).
 */
export default function Activity({ cards }: { cards: FeedCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section id="activity" aria-labelledby="activity-title" className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4 px-2">
        <h2 id="activity-title" className={H2_SITE}>
          {ACTIVITY_TITLE}
        </h2>
        <Link href="/leaderboard" className="inline-flex min-h-11 items-center text-[15px] text-s-muted hover:text-s-text motion-safe:transition-colors motion-safe:duration-200 md:min-h-0">
          {ACTIVITY_MORE}
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <UpdateCard key={c.id} c={c} />
        ))}
        {cards.length < 3 ? <InviteCard wide={cards.length === 1} /> : null}
      </div>
    </section>
  );
}
