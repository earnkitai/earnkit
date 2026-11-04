import Link from 'next/link';
import InstallButton from './InstallButton';
import { Wordmark } from '../ui/Logo';
import NavLinks from '../site/NavLinks';
import { PILL_BLUE } from '../site/ui';
import { NAV_INSTALL } from '../../../lib/v5/site-copy';

/**
 * The one site header on every page, transparent and not sticky: the wordmark (home), Programs and Docs
 * (NavLinks marks the current one), and the blue pill that opens the install sheet. On a phone the
 * wordmark and the pill share the first row and the links take the second.
 */
export default function Header() {
  return (
    <header data-ek-header="" className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 gap-y-1 px-4 py-5 md:px-6">
      <Link href="/" aria-label="EarnKit home" className="inline-flex min-h-11 items-center text-s-text">
        <Wordmark decorative width={104} height={20} />
      </Link>
      <NavLinks className="order-last flex w-full flex-wrap gap-x-6 sm:order-none sm:w-auto sm:flex-1" />
      <InstallButton label={NAV_INSTALL} className={`${PILL_BLUE} ml-auto sm:ml-0`} />
    </header>
  );
}
