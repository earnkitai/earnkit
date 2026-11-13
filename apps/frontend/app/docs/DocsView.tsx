import Link from 'next/link';
import { CARD_BLUE, CARD_LIGHT, CARD_NAVY, CARD_PANEL, CARD_RUST, PAGE_COL } from '../components/site/ui';
import { DOCS_CHECKED, DOCS_INSTALL_TITLE, DOCS_NAV, DOCS_PROGRAMS, DOCS_RECORD, DOCS_SCREEN, DOCS_SESSION, DOCS_STEPS, DOCS_TERMS, PROJECT_NAME_LIMIT, SIGN_IN_EXPIRED, SIGN_IN_FROM_LINK } from '../../lib/v5/site-copy';
import DocsNav from './DocsNav';
import ExpiredNote from './ExpiredNote';
import InstallCard from './InstallCard';

/** The cards' 32px radius (the card primitives carry 36px). */
const r32 = (card: string) => card.replace('rounded-[36px]', 'rounded-[32px]');
const CARD_TITLE = 'ek-serif text-[32px] leading-none';

/** One of the cards: a Kaftan title, then one 15px line in the card's soft colour. */
function InfoCard({ id, card, soft, title, text, lead, children }: { id: string; card: string; soft: string; title: string; text: string; lead?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`${r32(card)} flex scroll-mt-24 flex-col gap-2.5 p-7`}>
      {lead}
      <h2 id={`${id}-title`} className={CARD_TITLE}>
        {title}
      </h2>
      <p className={`text-[15px] leading-[1.6] ${soft}`}>{text}</p>
      {children}
    </section>
  );
}

/** The docs: the side nav (a wrapping row above the article on a phone), the install card, then six cards (the program owners' one full width). */
export default function DocsView() {
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
                {/* L27-28 (v6.1.16): the deeper blue, 6.13:1 on the step's tint (the brand blue was 4.52:1). */}
                <span className="ek-serif text-[32px] leading-none text-s-blue-top">{i + 1}</span>
                <span className="text-[15px] text-s-ink-body">{s}</span>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          <InfoCard id="session" card={CARD_NAVY} soft="text-s-on-navy-soft" title={DOCS_SESSION.title} text={DOCS_SESSION.text} />
          {/* L27-28 (v6.1.16): white on the deeper blue, 6.63:1 (the soft white on the brand blue was 4.57:1). L27-31: the name limit. */}
          <InfoCard id="record" card={CARD_BLUE.replace('bg-s-blue', 'bg-s-blue-top')} soft="text-s-on-blue" title={DOCS_RECORD.title} text={DOCS_RECORD.text} lead={<ExpiredNote text={SIGN_IN_EXPIRED} signin={SIGN_IN_FROM_LINK} />}>
            <p className="text-[15px] leading-[1.6] text-s-on-blue">{PROJECT_NAME_LIMIT}</p>
          </InfoCard>
          <InfoCard id="screening" card={CARD_PANEL} soft="text-s-muted" title={DOCS_SCREEN.title} text={DOCS_SCREEN.text} />
          <section id="programs" aria-labelledby="programs-title" className={`${r32(CARD_PANEL)} col-span-full flex scroll-mt-24 flex-col gap-2.5 p-7`}>
            <h2 id="programs-title" className={CARD_TITLE}>
              {DOCS_PROGRAMS.title}
            </h2>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-[1.6] text-s-muted">
              {DOCS_PROGRAMS.items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
          <InfoCard id="checked" card={CARD_RUST} soft="text-s-rust-sub" title={DOCS_CHECKED.title} text={DOCS_CHECKED.text} />
          <InfoCard id="terms" card={CARD_PANEL} soft="text-s-muted" title={DOCS_TERMS.title} text={DOCS_TERMS.text}>
            <Link href="/terms" className="inline-flex min-h-11 items-center text-[15px] text-s-text underline underline-offset-4">
              {DOCS_TERMS.link}
            </Link>
          </InfoCard>
        </div>
      </article>
    </div>
  );
}
