import type { Metadata } from 'next';
import Footer from '../components/common/Footer';
import Opportunities from '../components/landing/Opportunities';
import { PAGE_COL_WIDE } from '../components/site/ui';
import { getLanding } from '../lib/landing-cache';
import { PROGRAMS_DESCRIPTION, PROGRAMS_TITLE } from '../../lib/v5/site-copy';
import { Unavailable } from './[id]/GuideView';

export const revalidate = 600;

export const metadata: Metadata = {
  title: `${PROGRAMS_TITLE} · EarnKit`,
  description: PROGRAMS_DESCRIPTION,
  alternates: { canonical: 'https://earnkit.com/programs' },
};

/** Every listed program, open or upcoming: the same list as the landing. */
export default async function ProgramsPage() {
  const landing = await getLanding();
  if (!landing) return <Unavailable text="The programs are unavailable right now. Try again in a few minutes." />;
  return (
    <>
      <div className={`${PAGE_COL_WIDE} pt-2`}>
        <Opportunities programs={landing.tiles} h1 title={PROGRAMS_TITLE} />
      </div>
      <Footer />
    </>
  );
}
