import Link from 'next/link';
import { CARD_LIGHT, CARD_NAVY, CARD_PANEL, CARD_RUST, PAGE_COL } from '../components/site/ui';
import { DOCS_CHECKED, DOCS_INSTALL_TITLE, DOCS_NAV, DOCS_SESSION, DOCS_STEPS, DOCS_TERMS } from '../../lib/v5/site-copy';
import DocsNav from './DocsNav';
import InstallCard from './InstallCard';

/** The cards' 32px radius (the card primitives carry 36px). */
const r32 = (card: string) => card.replace('rounded-[36px]', 'rounded-[32px]');
const CARD_TITLE = 'ek-serif text-[32px] leading-none';

/** One of the cards: a Kaftan title, then one 15px line in the card's soft colour. */
function InfoCard({ id, card, soft, title, text, children }: { id: string; card: string; soft: string; title: string; text: string; children?: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`${r32(card)} flex scroll-mt-24 flex-col gap-2.5 p-7`}>
      <h2 id={`${id}-title`} className={CARD_TITLE}>
        {title}
      </h2>
      <p className={`text-[15px] leading-[1.6] ${soft}`}>{text}</p>
      {children}
    </section>
  );
}

/** The docs: the side nav (a wrapping row above the article on a phone), the install card, then three cards. */
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
                <span className="ek-serif text-[32px] leading-none text-s-blue">{i + 1}</span>
                <span className="text-[15px] text-s-ink-body">{s}</span>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          <InfoCard id="session" card={CARD_NAVY} soft="text-s-on-navy-soft" title={DOCS_SESSION.title} text={DOCS_SESSION.text} />
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
