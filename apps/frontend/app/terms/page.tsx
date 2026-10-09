import Footer from '../components/common/Footer';
import { Eyebrow, Panel } from '../components/common/Panel';
import PolicySection from './sections/PolicySection';
import RiskSection from './sections/RiskSection';
import SponsorTermsSection from './sections/SponsorTermsSection';

export const metadata = {
  title: 'Terms',
  description: 'How EarnKit works, where token fees go, the builder bonus, the risks, and the sponsor terms.',
  alternates: { canonical: 'https://earnkit.com/terms' },
};

const SECTIONS = [
  { href: '#policy', label: 'How EarnKit works' },
  { href: '#risk-disclosure', label: 'Risk disclosure' },
  { href: '#sponsor-terms', label: 'Sponsor terms' },
];

/**
 * v2.9 F22: the one legal page. /policy, /risk-disclosure and /sponsor-terms 301 here, to their
 * anchors (next.config.ts redirects).
 */
export default function TermsPage() {
  return (
    <div className="w-full pt-4">
      <Panel className="py-12 md:py-16" label="Terms">
        <Eyebrow>Terms</Eyebrow>
        <h1 className="mt-4 font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">Terms</h1>
        <p className="mt-4 max-w-2xl font-funnel-sans text-base font-light text-ek-blue-light md:text-lg">
          Plain answers on matching, token fees and the builder bonus, then the risks and the sponsor terms.
        </p>
        <nav aria-label="Sections" className="mt-6 flex flex-wrap gap-x-6 gap-y-1 font-funnel-sans text-base">
          {SECTIONS.map((s) => (
            <a
              key={s.href}
              href={s.href}
              className="inline-flex min-h-[44px] items-center text-ek-white underline underline-offset-4 transition-colors hover:text-ek-blue-soft"
            >
              {s.label}
            </a>
          ))}
        </nav>
      </Panel>
      <PolicySection />
      <RiskSection />
      <SponsorTermsSection />
      <Footer />
    </div>
  );
}
