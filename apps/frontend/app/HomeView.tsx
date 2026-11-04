import Footer from './components/common/Footer';
import Hero from './components/landing/Hero';
import Steps from './components/landing/Steps';
import Opportunities from './components/landing/Opportunities';
import { PAGE_COL_WIDE } from './components/site/ui';
import type { Landing } from '../lib/v5/landing';

/**
 * The homepage: the hero (with the money chip), the three steps, the open programs, then the footer.
 * `landing` is null when the read failed: the hero (without the chip) and the steps render and the
 * list is skipped, so a failed read claims nothing. It lives outside page.tsx because a page file may
 * only export Next's own fields.
 */
export default function HomeView({ landing }: { landing: Landing | null }) {
  return (
    <div data-ek-deep="" className="w-full">
      <div className={`${PAGE_COL_WIDE} flex flex-col gap-[72px] pt-2 md:gap-32`}>
        <Hero chip={landing?.chip ?? null} />
        <Steps />
        {landing ? <Opportunities programs={landing.tiles} /> : null}
      </div>
      <Footer />
    </div>
  );
}
