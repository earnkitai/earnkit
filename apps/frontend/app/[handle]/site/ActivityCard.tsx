import type { ProfileCard } from '../../../lib/earnkit/bench-data';
import { PROFILE_ACTIVITY, agoWords, nextUpdateLine, shippedAgo } from '../../../lib/earnkit/site-copy';
import { UNCONFIRMED_LABEL } from '../../../lib/earnkit/update-links';
import { weekLabel } from '../../../lib/earnkit/weeks';
import Pager from '../../components/site/Pager';
import { CARD_LIGHT, phoneRadius } from '../../components/site/ui';

/** Week cards per page (plan W6). */
export const ACTIVITY_PER_PAGE = 3;
/** The live dot pulses for a push within this long; after, it is a still grey dot. */
const FRESH_MS = 7 * 86_400_000;

/** A commits chip ("12 commits"), shown at the card's right already. */
const COMMITS_CHIP = /^\d[\d,]* commits?$/;
/**
 * A week's words: the Started line, else the summary, else the builder's note, else the fact chips (without the
 * commits chip when the count already shows at the right). Pure.
 */
export const weekWords = (c: ProfileCard): string =>
  c.started || c.summary || c.text || c.chips.filter((x) => !((c.commits ?? 0) > 0 && COMMITS_CHIP.test(x))).join(' · ');

function WeekCard({ c }: { c: ProfileCard }) {
  const commits = c.commits ?? 0;
  const body = weekWords(c);
  return (
    <article className="flex flex-col gap-2 rounded-[24px] bg-s-light-inner px-6 py-[22px] hover:bg-s-light-hover motion-safe:transition-[background-color,transform] motion-safe:duration-150 motion-safe:hover:-translate-y-0.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[15px] font-semibold">{weekLabel(c.week)}</span>
        {commits > 0 ? <span className="text-[13px] text-s-ink-muted">{`${commits.toLocaleString('en-US')} ${commits === 1 ? 'commit' : 'commits'}`}</span> : null}
      </div>
      {c.confirmed === false ? <span className="-mt-1 text-[13px] text-s-ink-muted">{UNCONFIRMED_LABEL}</span> : null}
      {body ? <p className="text-[15px] leading-[1.6] text-s-ink-body [overflow-wrap:anywhere]">{body}</p> : null}
    </article>
  );
}

/**
 * The white Activity card (Profile board): the title with the live dot and "Shipped 2h ago" (the last push: pulsing
 * within 7 days, a still grey dot after, none without one), three week cards a page (`?page=`, newest first) and the
 * quiet pager; under three cards, the dashed "Next update posts Monday, <date>" (plan W6). `quiet` (confirming, or no
 * project): the dashed line only.
 */
export default function ActivityCard({
  log,
  lastShippedAt,
  page,
  path,
  quiet,
  now,
}: {
  log: ProfileCard[];
  lastShippedAt: string | null;
  page: number;
  path: string;
  quiet: boolean;
  now: Date;
}) {
  const cards = quiet ? [] : log;
  const pages = Math.max(1, Math.ceil(cards.length / ACTIVITY_PER_PAGE));
  const at = Math.min(Math.max(Math.trunc(page) || 1, 1), pages);
  const shown = cards.slice((at - 1) * ACTIVITY_PER_PAGE, at * ACTIVITY_PER_PAGE);
  const last = !quiet && lastShippedAt ? new Date(lastShippedAt) : null;
  const fresh = last !== null && now.getTime() - last.getTime() <= FRESH_MS;
  return (
    <section data-ek-activity="" aria-labelledby="profile-activity" className={`${phoneRadius(CARD_LIGHT)} flex min-w-0 flex-[3_1_520px] flex-col gap-2.5 p-5 md:p-7`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-2">
        <h2 id="profile-activity" className="ek-serif text-[32px] leading-none md:text-[40px]">
          {PROFILE_ACTIVITY}
        </h2>
        {last && Number.isFinite(last.getTime()) ? (
          <span className="inline-flex items-center gap-2 text-[14px] text-s-ink-soft">
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${fresh ? 'ek-pulse bg-s-live motion-reduce:animate-none' : 'bg-s-ink-muted'}`} />
            {shippedAgo(agoWords(last, now))}
          </span>
        ) : null}
      </div>
      {shown.map((c) => (
        <WeekCard key={`${c.week}-${c.started ? 's' : 'u'}`} c={c} />
      ))}
      {cards.length < ACTIVITY_PER_PAGE ? (
        <div className="rounded-[24px] border-[1.5px] border-dashed border-s-light-dash px-6 py-5 text-[15px] text-s-ink-muted">{nextUpdateLine(now)}</div>
      ) : null}
      <Pager
        page={at}
        pages={pages}
        href={(n) => (n === 1 ? path : `${path}?page=${n}`)}
        labels={['Newer', 'Older']}
        numbers
        tone="light"
        label="Activity pages"
        className="pt-1.5"
      />
    </section>
  );
}
