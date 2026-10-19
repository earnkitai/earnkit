import Footer from '../components/common/Footer';
import { COLUMN, H1 } from '../components/common/Panel';
import { PROFILES_ANCHOR, PROFILES_TITLE, RECORDS_HREF, RECORDS_TITLE } from '../../lib/earnkit/policy';
import PolicySection from './sections/PolicySection';
import ProfilesSection from './sections/ProfilesSection';
import RiskSection from './sections/RiskSection';
import SponsorTermsSection from './sections/SponsorTermsSection';

/** v2.13 R16: no builder bonus. */
const DESCRIPTION = 'How EarnKit works, what it records, builder profiles, the risks, and the sponsor terms.';

export function generateMetadata() {
  return {
    title: 'Terms',
    description: DESCRIPTION,
    alternates: { canonical: 'https://earnkit.com/terms' },
  };
}

const SECTIONS = [
  { href: '#policy', label: 'How EarnKit works' },
  { href: RECORDS_HREF.slice('/terms'.length), label: RECORDS_TITLE },
  { href: `#${PROFILES_ANCHOR}`, label: PROFILES_TITLE },
  { href: '#risk-disclosure', label: 'Risk disclosure' },
  { href: '#sponsor-terms', label: 'Sponsor terms' },
];

/**
 * v2.9 F22: the one legal page. /policy, /risk-disclosure and /sponsor-terms 301 here, to their
 * anchors (next.config.ts redirects).
 */
export default function TermsPage() {
  return (
    <>
      <div className={`${COLUMN} flex flex-col gap-4 pt-8 md:pt-12`}>
        <section aria-label="Terms" className="mb-4">
          <h1 className={H1}>Terms</h1>
          <nav aria-label="Sections" className="mt-4 flex flex-wrap gap-x-6 gap-y-1 font-funnel-sans text-base">
            {SECTIONS.map((s) => (
              <a
                key={s.href}
                href={s.href}
                className="inline-flex min-h-[44px] items-center text-ek-body underline underline-offset-4 transition-colors hover:text-ek-text"
              >
                {s.label}
              </a>
            ))}
          </nav>
        </section>
        <PolicySection />
        <ProfilesSection />
        <RiskSection />
        <SponsorTermsSection />
      </div>
      <Footer />
    </>
  );
}
