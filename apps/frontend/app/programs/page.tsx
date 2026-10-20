import Footer from '../components/common/Footer';
import ProgramCards, { PROGRAMS_TITLE } from '../components/sections/ProgramCards';
import { getLanding } from '../lib/landing-cache';
import { Unavailable } from './[id]/GuideView';
import { COLUMN } from '../components/common/Panel';

/** v2.7 §1: read server-side, revalidated every 10 minutes. */
export const revalidate = 600;

export function generateMetadata() {
  return {
    title: `${PROGRAMS_TITLE} · EarnKit`,
    description: 'Every open grant, prize and program EarnKit tracks: how much, when it ends, how hard.',
    alternates: { canonical: 'https://earnkit.com/programs' },
  };
}

/**
 * Ruling 22 (plan), v2.8 Ruling 20, v3 Stage 3 Task 4: the landing's Money section as a page: the same title (h1),
 * the money line and what it leaves out, every open curated program as a row (ProgramRow); PROGRAMS_EMPTY with none.
 */
export default async function ProgramsPage() {
  const landing = await getLanding();
  if (!landing) return <Unavailable text="Programs are unavailable right now. Try again in a few minutes." />;
  return (
    <>
      <div className={`${COLUMN} pt-8 md:pt-12`}>
        <ProgramCards tiles={landing.tiles} heading="h1" figure={landing.open_text} more={landing.open_more} />
      </div>
      <Footer />
    </>
  );
}
