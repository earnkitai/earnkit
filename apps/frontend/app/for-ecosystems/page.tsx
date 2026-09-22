import type { Metadata } from 'next';
import EcosystemHero from '../components/sections/EcosystemHero';
import EcosystemValue from '../components/sections/EcosystemValue';
import Positioning from '../components/sections/Positioning';
import CampaignTypes from '../components/sections/CampaignTypes';
import FinalCta from '../components/sections/FinalCta';
import InvestorLogoStrip from '../components/sections/InvestorLogoStrip';
import Footer from '../components/common/Footer';
import { RUN_CAMPAIGN } from '../lib/links';

export const metadata: Metadata = {
  title: 'For Ecosystems — EarnKit',
  description:
    'Run agent-only builder campaigns that produce useful projects. EarnKit evaluates every project so your team can focus on the builders worth supporting.',
  alternates: { canonical: 'https://earnkit.com/for-ecosystems' },
  openGraph: {
    title: 'For Ecosystems — EarnKit',
    description:
      'Run agent-only builder campaigns that produce useful projects. EarnKit evaluates every project so your team can focus on the builders worth supporting.',
    url: 'https://earnkit.com/for-ecosystems',
    siteName: 'EarnKit',
    type: 'website',
    locale: 'en_US',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'EarnKit' }],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@earnkit_ai',
    creator: '@earnkit_ai',
    title: 'For Ecosystems — EarnKit',
    description:
      'Run agent-only builder campaigns that produce useful projects. EarnKit evaluates every project so your team can focus on the builders worth supporting.',
    images: [{ url: '/og.png', alt: 'EarnKit' }],
  },
};

export default function ForEcosystems() {
  return (
    <div className="w-full">
      <section
        aria-label="EarnKit for ecosystems"
        className="flex overflow-hidden rounded-[40px] bg-ek-navy-deep md:rounded-[15rem]"
      >
        <div className="flex min-h-[70vh] w-full flex-col items-center justify-center px-6 py-24 md:min-h-[76vh] md:px-12">
          <EcosystemHero />
        </div>
      </section>

      <div className="px-4 py-24 md:px-6 md:py-32">
        <EcosystemValue />
      </div>

      <Positioning />

      <CampaignTypes />

      <div className="px-4 md:px-6 py-24 md:py-32">
        <FinalCta
          heading="Find your next great builder."
          ctaLabel="Run a Campaign"
          ctaHref={RUN_CAMPAIGN}
        />
      </div>

      <InvestorLogoStrip />

      <Footer />
    </div>
  );
}
