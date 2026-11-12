import Link from 'next/link';
import { InstallLink } from './InstallButton';
import { Wordmark } from '../ui/Logo';
import NavLinks from '../site/NavLinks';
import { PILL_BLUE } from '../site/ui';
import { NAV_INSTALL, NAV_INSTALL_SHORT, NAV_RECORD } from '../../../lib/v5/site-copy';

/**
 * The one site header on every page, transparent and not sticky: the wordmark (home), Programs and Docs
 * (NavLinks marks the current one), `Your record` to /me when signed in (L27-16, v6.1.16; v6.1.17 Task 4: NavLinks
 * asks /api/me/signed-in after load, so the server HTML never carries it and every page but /me stays static), and the
 * blue pill, a link to /docs#install that opens the install sheet (L27-1). The rows wrap:
 * the wordmark and the pill share the first row, the links take the last row on a phone. Under 360px the pill says
 * `Add`, so the header fits two rows at 320px (L27-17). On /me with a linked agent (the page carries
 * `data-me-linked`, L21-22 v6.1.16) the pill is hidden.
 */
export default function Header() {
  return (
    <header data-ek-header="" className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 gap-y-1 px-4 py-5 max-[360px]:gap-x-4 md:px-6">
      <Link href="/" aria-label="EarnKit home" className="inline-flex min-h-11 items-center text-s-text">
        <Wordmark decorative width={104} height={20} />
      </Link>
      <NavLinks
        record={{ label: NAV_RECORD, href: '/me' }}
        className="order-last flex w-full flex-wrap gap-x-6 max-[360px]:gap-x-4 sm:order-none sm:w-auto sm:flex-1"
      />
      <InstallLink
        label={
          <>
            <span className="max-[360px]:hidden">{NAV_INSTALL}</span>
            <span className="hidden max-[360px]:inline">{NAV_INSTALL_SHORT}</span>
          </>
        }
        className={`${PILL_BLUE} ml-auto sm:ml-0 [body:has([data-me-linked])_&]:hidden`}
      />
    </header>
  );
}
