import Footer from '../components/common/Footer';
import { CARD_PANEL, H1_SITE, PAGE_COL } from '../components/site/ui';
import { TERMS_DESCRIPTION, TERMS_SECTIONS, TERMS_TITLE } from '../../lib/v5/site-copy';

export function generateMetadata() {
  return {
    title: TERMS_TITLE,
    description: TERMS_DESCRIPTION,
    alternates: { canonical: 'https://earnkit.com/terms' },
  };
}

/** The one legal page: what EarnKit reads, what it stores, what it never does. */
export default function TermsPage() {
  return (
    <>
      <div className={`${PAGE_COL} flex flex-col gap-4 pt-8 md:pt-12`}>
        <h1 className={H1_SITE}>{TERMS_TITLE}</h1>
        {TERMS_SECTIONS.map((s) => (
          <section key={s.title} aria-label={s.title} className={`${CARD_PANEL} flex flex-col gap-3 p-6 md:p-8`}>
            <h2 className="ek-serif text-[28px] leading-none md:text-[32px]">{s.title}</h2>
            {s.lines.map((l) => (
              <p key={l} className="text-[16px] leading-normal text-s-muted">
                {l}
              </p>
            ))}
          </section>
        ))}
      </div>
      <Footer />
    </>
  );
}
