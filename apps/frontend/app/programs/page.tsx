import Footer from '../components/common/Footer';
import ProgramCards from '../components/sections/ProgramCards';
import { getLanding } from '../lib/landing-cache';
import { Unavailable } from './[id]/GuideView';
import { Panel } from '../components/common/Panel';

/** v2.7 §1: read server-side, revalidated every 10 minutes. */
export const revalidate = 600;

export const metadata = {
  title: 'Open programs · EarnKit',
  description: 'Every open program EarnKit tracks, by pool: the prize, the deadline, the difficulty and the builder bonus.',
  alternates: { canonical: 'https://earnkit.com/programs' },
};

/** Ruling 22 (plan): every open curated program as a card ("See all" and the footer's "Programs"). */
export default async function ProgramsPage() {
  const landing = await getLanding();
  if (!landing) return <Unavailable text="Programs are unavailable right now." />;
  return (
    <div className="w-full pt-4">
      {landing.tiles.length > 0 ? (
        <ProgramCards tiles={landing.tiles} heading="h1" figure={landing.open_text} />
      ) : (
        <Panel className="py-12 md:py-16">
          <h1 className="font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">Open programs</h1>
          <p className="mt-4 font-funnel-sans text-lg text-ek-blue-light">No programs are open right now.</p>
        </Panel>
      )}
      <Footer />
    </div>
  );
}
