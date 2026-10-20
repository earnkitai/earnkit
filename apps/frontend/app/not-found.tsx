import Link from 'next/link';
import Footer from './components/common/Footer';
import { BTN_PRIMARY, BTN_SECONDARY } from './components/common/Button';
import { COLUMN, H1, LEDE } from './components/common/Panel';

export const NOT_FOUND_TITLE = 'Page not found';
export const NOT_FOUND_LINE = 'This page or builder is not on EarnKit.';

export const metadata = { title: NOT_FOUND_TITLE, robots: 'noindex' };

/** Launch ready L10: every unknown page and handle gets the site's own 404 (never Next's white default). */
export default function NotFound() {
  return (
    <>
      <div className={`${COLUMN} pb-16 pt-12 md:pt-20`}>
        <h1 className={H1}>{NOT_FOUND_TITLE}</h1>
        <p className={LEDE}>{NOT_FOUND_LINE}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/leaderboard" className={BTN_PRIMARY}>
            See the leaderboard
          </Link>
          <Link href="/" className={BTN_SECONDARY}>
            Home
          </Link>
        </div>
      </div>
      <Footer />
    </>
  );
}
