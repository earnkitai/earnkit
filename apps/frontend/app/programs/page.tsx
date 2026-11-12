import type { Metadata } from 'next';
import Footer from '../components/common/Footer';
import Opportunities from '../components/landing/Opportunities';
import { PAGE_COL_WIDE } from '../components/site/ui';
import { getLanding } from '../lib/landing-cache';
import { pageMeta } from '../lib/meta';
import { PROGRAMS_DESCRIPTION, PROGRAMS_TITLE } from '../../lib/v5/site-copy';
import { Unavailable } from './[id]/GuideView';

export const revalidate = 600;

export const metadata: Metadata = pageMeta({ path: '/programs', title: `${PROGRAMS_TITLE} · EarnKit`, description: PROGRAMS_DESCRIPTION });

/** Every listed program, open or upcoming, all on neutral cards; the landing shows six of them. */
export default async function ProgramsPage() {
  const landing = await getLanding();
  if (!landing) return <Unavailable text="The programs are unavailable right now. Try again in a few minutes." />;
  return (
    <>
      <div className={`${PAGE_COL_WIDE} pt-2`}>
        <Opportunities programs={landing.tiles} total={landing.total} full />
      </div>
      <Footer />
    </>
  );
}
