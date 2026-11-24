import { notFound } from 'next/navigation';
import Footer from '../components/common/Footer';
import { CARD_PANEL, H1_SITE, PAGE_COL } from '../components/site/ui';
import { flagOn } from '../../lib/v5/flags';
import { PRIVACY_SECTIONS, PRIVACY_TITLE } from '../../lib/v6/consent';

export const dynamic = 'force-dynamic';
export const metadata = { title: `${PRIVACY_TITLE} · EarnKit` };

/** v3.8 E12 (`form`, L10): what is public, what is private, what the consent covers (decision 28). Off: 404. */
export default function PrivacyPage() {
  if (!flagOn('form')) notFound();
  return (
    <>
      <div className={`${PAGE_COL} flex flex-col gap-4 pt-8 md:pt-12`}>
        <h1 className={H1_SITE}>{PRIVACY_TITLE}</h1>
        {PRIVACY_SECTIONS.map((s) => (
          <section key={s.title} aria-label={s.title} className={`${CARD_PANEL} flex flex-col gap-3 p-6 md:p-8`}>
            <h2 className="ek-serif text-[28px] leading-none md:text-[32px]">{s.title}</h2>
            {s.lines.map((l) => (
              <p key={l} className="text-[16px] leading-normal text-s-muted">{l}</p>
            ))}
          </section>
        ))}
      </div>
      <Footer />
    </>
  );
}
