import Link from 'next/link';
import InstallButton from './InstallButton';
import { Wordmark } from '../ui/Logo';
import { COLUMN } from './Panel';
import { DOCS } from '../../lib/links';

const LINK = 'inline-flex min-h-11 items-center px-2 font-funnel-sans text-sm font-medium text-ek-muted transition-colors hover:text-ek-text md:px-3 md:text-base';

/**
 * R18, v3 Stage 3 (spec 5.6): the one site header on every page: the wordmark, Leaderboard, Feed, Programs, Docs
 * (/docs), and the one primary action, "Add to your agent" (the install sheet).
 * Sticky on the page's glass with a hairline under it, in the page column. On a phone: the wordmark, Leaderboard and
 * the button; Feed, Programs and Docs from sm (and in the footer).
 */
export default function Header() {
  return (
    <header data-ek-header="" className="sticky top-0 z-40 border-b border-ek-line bg-ek-glass backdrop-blur">
      <nav aria-label="Site" className={`${COLUMN} flex h-14 items-center gap-1 md:h-16`}>
        <Link href="/" className="mr-auto inline-flex min-h-11 items-center text-ek-text">
          <Wordmark className="h-[18px] w-auto md:h-5" />
        </Link>
        <Link href="/leaderboard" className={LINK}>
          Leaderboard
        </Link>
        <Link href="/feed" className={`${LINK} hidden sm:inline-flex`}>
          Feed
        </Link>
        <Link href="/programs" className={`${LINK} hidden sm:inline-flex`}>
          Programs
        </Link>
        <Link href={DOCS} className={`${LINK} hidden sm:inline-flex`}>
          Docs
        </Link>
        <InstallButton className="ml-2 inline-flex h-11 items-center whitespace-nowrap rounded-full bg-ek-brand px-4 font-funnel-sans text-sm font-medium text-ek-text transition-colors hover:bg-ek-accent md:ml-3 md:px-5" />
      </nav>
    </header>
  );
}
