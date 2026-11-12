import type { ReactNode } from 'react';
import Link from 'next/link';
import Footer from '../../components/common/Footer';
import { Logo } from '../../components/landing/Opportunities';
import Money from '../../components/site/Money';
import { CARD_PANEL, PAGE_COL, PILL_WHITE } from '../../components/site/ui';
import AskAgent from './AskAgent';
import type { GuidePage } from '../../../lib/v5/guide-page';
import { guidePills } from '../../../lib/v5/guide';
import {
  ALL_PROGRAMS, GUIDE_ASK, GUIDE_BEST_BET_TITLE, GUIDE_ELIGIBILITY_TITLE, GUIDE_FIELDS_TITLE, GUIDE_FOCUS_TITLE, GUIDE_NO_ELIGIBILITY,
  GUIDE_ROUNDS_TITLE, GUIDE_RULES_TITLE, GUIDE_SOURCES_TITLE,
} from '../../../lib/v5/site-copy';

const H1 = 'ek-serif text-[40px] leading-none text-s-text md:text-[56px]';
const H3 = 'ek-serif text-[28px] leading-none md:text-[32px]';
const LINK = 'inline-flex min-h-11 items-center text-s-muted underline underline-offset-4 motion-safe:transition-colors hover:text-s-text';

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={`${CARD_PANEL} flex flex-col gap-4 p-6 md:p-8`}>
      <h2 className={H3}>{title}</h2>
      {children}
    </section>
  );
}

const List = ({ items }: { items: string[] }) => (
  <ul className="flex list-disc flex-col gap-2 pl-5 text-[16px] leading-normal text-s-muted">
    {items.map((x, i) => (
      <li key={i}>{x}</li>
    ))}
  </ul>
);

/** One program's guide: the facts, then who can apply, what the form asks, the rules and the sources. */
export default function GuideView({ id, page }: { id: string; page: GuidePage }) {
  const g = page.guide;
  const open = page.status === 'active' && g.closes !== 'Closed';
  const pills = guidePills(g);
  const sources = g.sources.filter((s) => s.url.startsWith('https://'));
  return (
    <>
      <div className={`${PAGE_COL} flex flex-col gap-4 pt-8 md:pt-12`}>
        <section aria-label={g.title} className="flex flex-col gap-5 pb-4">
          <div className="flex items-center gap-4 md:gap-5">
            <Logo id={id} logo={page.logo} organizer={page.organizer} />
            <h1 className={`${H1} min-w-0 [overflow-wrap:break-word]`}>{g.title}</h1>
          </div>
          <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[18px] text-s-muted">
            <span className="ek-serif text-[32px] leading-none text-s-text">
              <Money text={g.money} />
            </span>
            <span>{g.closed_on ?? g.closes}</span>
          </p>
          {pills.length > 0 ? (
            <ul aria-label="How to apply" className="flex flex-wrap gap-2">
              {pills.map((t) => (
                <li key={t} className={`${PILL_WHITE} min-h-9 px-4 text-[14px]`}>
                  {t}
                </li>
              ))}
            </ul>
          ) : null}
          {page.opens_note ? <p className="max-w-[36rem] text-[16px] text-s-muted">{page.opens_note}</p> : null}
          <p className="max-w-[44rem] text-[16px] leading-normal text-s-muted">{g.description}</p>
          {open ? (
            <div className="flex flex-wrap items-center gap-3">
              <AskAgent prompt={GUIDE_ASK(g.title)} />
              <a href={page.submission_url} target="_blank" rel="noopener noreferrer" className={PILL_WHITE}>
                Apply on the program site
              </a>
            </div>
          ) : null}
        </section>

        <Part title={GUIDE_ELIGIBILITY_TITLE}>
          {g.eligibility.length > 0 ? <List items={g.eligibility} /> : <p className="text-[16px] text-s-muted">{GUIDE_NO_ELIGIBILITY}</p>}
        </Part>

        {g.fields.length > 0 ? (
          <Part title={GUIDE_FIELDS_TITLE}>
            <ul className="flex flex-col gap-2 text-[16px] leading-normal text-s-muted">
              {g.fields.map((f, i) => (
                <li key={i}>
                  <span className="text-s-text">{f.label}</span>: {f.todo}
                </li>
              ))}
            </ul>
          </Part>
        ) : null}

        {g.rules.length > 0 ? (
          <Part title={GUIDE_RULES_TITLE}>
            <List items={g.rules} />
          </Part>
        ) : null}

        {g.focus ? (
          <Part title={GUIDE_FOCUS_TITLE}>
            <p className="text-[16px] leading-normal text-s-muted">{g.focus}</p>
          </Part>
        ) : null}

        {g.past_rounds.length > 0 ? (
          <Part title={GUIDE_ROUNDS_TITLE}>
            <List items={g.past_rounds} />
          </Part>
        ) : null}

        {g.best_bet ? (
          <Part title={GUIDE_BEST_BET_TITLE}>
            <p className="text-[18px] text-s-text">{g.best_bet}</p>
          </Part>
        ) : null}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/programs" className={LINK}>
            {ALL_PROGRAMS}
          </Link>
          {sources.length > 0 ? (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-s-muted">
              <span>{`${GUIDE_SOURCES_TITLE}:`}</span>
              {sources.map((s) => (
                <a key={s.url} href={s.url} title={new URL(s.url).hostname} target="_blank" rel="noopener noreferrer" className={LINK}>
                  {s.label}
                </a>
              ))}
            </p>
          ) : null}
        </div>
      </div>
      <Footer />
    </>
  );
}

