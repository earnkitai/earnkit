import Hero from './components/sections/Hero';
import BackedBy from './components/sections/BackedBy';
import Footer from './components/common/Footer';
import { COLUMN } from './components/common/Panel';
import FeedRows from './components/sections/FeedRows';
import ProgramCards from './components/sections/ProgramCards';
import type { Landing } from '../lib/earnkit/landing';

/**
 * The homepage (interim until the v3.1 landing page task): the hero, the Activity cards (landing.activity, when there
 * are any), the money open now, backed by, the footer. `landing` is null when the read failed (Ruling 21 (plan)): the
 * hero and Backed by render and the live sections are skipped (a failed read claims nothing); an empty program list
 * shows its one empty line.
 * It lives outside page.tsx because a page file may only export Next's own fields.
 */
export default function HomeView({ landing }: { landing: Landing | null }) {
  return (
    <div className="w-full">
      <Hero featured={null} />
      <div className={`${COLUMN} flex flex-col gap-14 md:gap-24`}>
        {landing ? <FeedRows cards={landing.activity} /> : null}
        {landing ? <ProgramCards tiles={landing.tiles} figure={landing.open_text} more={landing.open_more} /> : null}
        <BackedBy />
      </div>
      <Footer />
    </div>
  );
}
