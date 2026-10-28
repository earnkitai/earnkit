import { Fragment } from 'react';
import { CARD_BLUE, CARD_LIGHT, CARD_NAVY, CARD_PANEL, CARD_RUST, PAGE_COL } from '../components/site/ui';
import { DOCS_GITHUB, DOCS_INSTALL_TITLE, DOCS_MONEY, DOCS_NAV, DOCS_SCORE, DOCS_SELECTORS, DOCS_STEPS, DOCS_WEEK } from '../../lib/earnkit/docs-copy';
import DocsNav from './DocsNav';
import InstallCard from './InstallCard';

/** The three cards' 32px radius (the card primitives carry 36px). */
const r32 = (card: string) => card.replace('rounded-[36px]', 'rounded-[32px]');
const CARD_TITLE = 'ek-serif text-[32px] leading-none';

/** One of the three cards: a Kaftan title, then one 15px line in the card's soft colour. */
function InfoCard({ id, card, soft, title, text }: { id: string; card: string; soft: string; title: string; text: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`${r32(card)} flex scroll-mt-24 flex-col gap-2.5 p-7`}>
      <h2 id={`${id}-title`} className={CARD_TITLE}>
        {title}
      </h2>
      <p className={`text-[15px] leading-[1.6] ${soft}`}>{text}</p>
    </section>
  );
}

/**
 * Install fixes: "No GitHub yet?" on the light install card, a light-inner tile: one line, a row per app builder
 * (Lovable, Bolt) with its confirmed steps, then the v0 note. Every string from docs-copy DOCS_GITHUB.
 */
function GitHubHelp() {
  return (
    <section id="github" aria-labelledby="github-title" className="flex scroll-mt-24 flex-col gap-3 rounded-[22px] bg-s-light-inner p-[18px] text-[15px] leading-[1.6] text-s-ink-body md:p-6">
      <h2 id="github-title" className="ek-serif text-[28px] leading-none text-s-ink">
        {DOCS_GITHUB.title}
      </h2>
      <p>{DOCS_GITHUB.text}</p>
      <dl className="flex flex-col gap-2.5">
        {DOCS_GITHUB.tools.map(([tool, steps]) => (
          <div key={tool} className="flex flex-col gap-0.5 md:flex-row md:gap-4">
            <dt className="shrink-0 font-semibold text-s-ink md:w-20">{tool}</dt>
            <dd>{steps}</dd>
          </div>
        ))}
      </dl>
      <p>{DOCS_GITHUB.v0}</p>
    </section>
  );
}

/**
 * v3.1 site Task 10 (Docs board): the side nav (a wrapping row above the article on a phone), the light install card
 * (the agent tabs and the chosen command from AGENTS, a copy button, three numbered steps, "No GitHub yet?"), the three cards (how the
 * week works, the Shipping score, programs and, while Backing is on, Backing), then the selectors strip with the
 * builder JSON URL. Server-rendered; the tabs and the side nav's lit item are the client parts.
 */
export default function DocsView() {
  const money = DOCS_MONEY;
  return (
    <div className={`${PAGE_COL} flex flex-col gap-4 pb-6 pt-2 lg:flex-row lg:items-start`}>
      <DocsNav items={DOCS_NAV} className={`${r32(CARD_PANEL)} flex flex-wrap gap-1 p-3 text-[15px] lg:w-[260px] lg:shrink-0 lg:flex-col lg:p-[22px]`} />

      <article className="flex min-w-0 flex-1 flex-col gap-4">
        <section id="install" aria-labelledby="install-title" className={`${CARD_LIGHT.replace('rounded-[36px]', 'rounded-[28px] md:rounded-[36px]')} flex scroll-mt-24 flex-col gap-5 p-6 md:p-9`}>
          <h1 id="install-title" className="ek-serif text-[40px] leading-none text-s-ink md:text-[56px]">
            {DOCS_INSTALL_TITLE}
          </h1>
          <InstallCard />
          <ol className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
            {DOCS_STEPS.map((s, i) => (
              <li key={s} data-ek-step="" className="flex flex-col gap-1.5 rounded-[22px] bg-s-light-inner p-[18px]">
                <span className="ek-serif text-[32px] leading-none text-s-blue">{i + 1}</span>
                <span className="text-[15px] text-s-ink-body">{s}</span>
              </li>
            ))}
          </ol>
          <GitHubHelp />
        </section>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          <InfoCard id="week" card={CARD_NAVY} soft="text-s-on-navy-soft" title={DOCS_WEEK.title} text={DOCS_WEEK.text} />
          <InfoCard id="score" card={CARD_RUST} soft="text-s-rust-sub" title={DOCS_SCORE.title} text={DOCS_SCORE.text} />
          <InfoCard id="money" card={CARD_PANEL} soft="text-s-muted" title={money.title} text={money.text} />
        </div>

        <section id="selectors" aria-labelledby="selectors-title" className={`${CARD_BLUE} flex scroll-mt-24 flex-wrap items-center justify-between gap-5 p-6 md:p-8`}>
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-2">
            <h2 id="selectors-title" className="ek-serif text-[40px] leading-none">
              {DOCS_SELECTORS.title}
            </h2>
            <p className="text-[15px] text-s-on-blue-soft">{DOCS_SELECTORS.text}</p>
          </div>
          {/* A phone breaks the URL only after a "/", never inside a word. */}
          <code className="max-w-full rounded-[18px] bg-s-inset22 px-[18px] py-3.5 font-mono text-[14px]">
            {DOCS_SELECTORS.url.split('/').map((part, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <>
                    /<wbr />
                  </>
                )}
                {part}
              </Fragment>
            ))}
          </code>
        </section>
      </article>
    </div>
  );
}
