import Link from 'next/link';
import InstallButton from './InstallButton';
import { Wordmark } from '../ui/Logo';
import { DOCS } from '../../lib/links';

const LINK =
  'inline-flex min-h-11 items-center px-2 font-funnel-sans text-sm font-medium text-ek-muted transition-colors hover:text-ek-text';

/**
 * R18: the one site header on every page (it was the profile's slim top bar): the wordmark, quiet
 * links, "Add to your agent" (the install modal), a hairline under it. Sticky, on the page's glass.
 * On a phone: the wordmark, Leaderboard and the install; Feed and Docs from sm (and in the footer).
 */
export default function Header() {
  return (
    <header data-ek-header="" className="sticky top-0 z-40 border-b border-ek-line bg-ek-glass backdrop-blur">
      <nav aria-label="Site" className="mx-auto flex h-14 w-full max-w-6xl items-center gap-1 px-4 md:px-8">
        <Link href="/" className="mr-auto inline-flex min-h-11 items-center text-ek-text">
          <Wordmark className="h-[18px] w-auto md:h-5" />
        </Link>
        <Link href="/leaderboard" className={LINK}>
          Leaderboard
        </Link>
        <Link href="/feed" className={`${LINK} hidden sm:inline-flex`}>
          Feed
        </Link>
        <a href={DOCS} target="_blank" rel="noopener noreferrer" className={`${LINK} hidden sm:inline-flex`}>
          Docs
        </a>
        <InstallButton className="ml-2 inline-flex h-11 items-center whitespace-nowrap rounded-full bg-ek-blue-bright px-4 font-funnel-sans text-sm font-medium text-ek-page transition-colors hover:bg-ek-blue-soft md:h-9" />
      </nav>
    </header>
  );
}
