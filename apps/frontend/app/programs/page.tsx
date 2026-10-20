import Footer from '../components/common/Footer';
import ProgramCards from '../components/sections/ProgramCards';
import { getLanding } from '../lib/landing-cache';
import { Unavailable } from './[id]/GuideView';
import { COLUMN, H1, LEDE } from '../components/common/Panel';

/** v2.7 §1: read server-side, revalidated every 10 minutes. */
export const revalidate = 600;

export function generateMetadata() {
  return {
    title: 'Open programs · EarnKit',
    description: 'Every open grant, prize and program EarnKit tracks: how much, when it ends, how hard.',
    alternates: { canonical: 'https://earnkit.com/programs' },
  };
}

/** Ruling 22 (plan), v2.8 Ruling 20, v3 Stage 3: every open curated program as a row (ProgramRow). */
export default async function ProgramsPage() {
  const landing = await getLanding();
  if (!landing) return <Unavailable text="Programs are unavailable right now. Try again in a few minutes." />;
  return (
    <>
      <div className={`${COLUMN} pt-8 md:pt-12`}>
        {landing.tiles.length > 0 ? (
          <ProgramCards tiles={landing.tiles} heading="h1" figure={landing.open_text} more={landing.open_more} />
        ) : (
          <section aria-label="Open programs">
            <h1 className={H1}>Open programs</h1>
            <p className={LEDE}>No programs are open right now.</p>
          </section>
        )}
      </div>
      <Footer />
    </>
  );
}
