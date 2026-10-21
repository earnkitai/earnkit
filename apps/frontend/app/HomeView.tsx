import Footer from './components/common/Footer';
import Hero from './components/landing/Hero';
import Steps from './components/landing/Steps';
import Activity from './components/landing/Activity';
import Opportunities from './components/landing/Opportunities';
import { PAGE_COL_WIDE } from './components/site/ui';
import { landingPrograms, type Landing } from '../lib/earnkit/landing';

/**
 * The homepage (v3.1, Landing board) on the deep page colour: the hero (painting, chip, title, CTA, agent marks),
 * "From commit to capital", Activity (landing.activity) and Earning opportunities (#earn), then the full footer.
 * `landing` is null when the read failed (Ruling 21 (plan)): the hero (without the chip) and the steps render and
 * the live sections are skipped (a failed read claims nothing). The layout holds <main>; this is a plain column.
 * It lives outside page.tsx because a page file may only export Next's own fields.
 */
export default function HomeView({ landing }: { landing: Landing | null }) {
  return (
    <div data-ek-deep="" className="w-full">
      <div className={`${PAGE_COL_WIDE} flex flex-col gap-[72px] pt-2 md:gap-32`}>
        <Hero chip={landing?.open_chip ?? null} />
        <Steps />
        {landing ? <Activity cards={landing.activity} /> : null}
        {landing ? <Opportunities programs={landingPrograms(landing.tiles)} /> : null}
      </div>
      <Footer />
    </div>
  );
}
