import Link from 'next/link';
import InstallButton from '../components/common/InstallButton';
import { Wordmark } from '../components/ui/Logo';
import { DOCS } from '../lib/links';

const LINK =
  'inline-flex min-h-11 items-center px-2 font-funnel-sans text-[13px] font-medium text-[#9BA1AC] transition-colors hover:text-[#F5F6F8] md:min-h-0';

/**
 * profile-whoop v2: the profile's slim top bar (48px, 56px from md) in place of the site header
 * (globals.css hides that header on a page that carries data-ek-premium): the small wordmark, quiet
 * links, a small "Add to your agent" button, a hairline under it. Same near-black as the page.
 */
export default function ProfileTopBar() {
  return (
    <div className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#0B0B0F]/90 backdrop-blur supports-[backdrop-filter]:bg-[#0B0B0F]/75">
      <nav
        aria-label="Site"
        className="mx-auto flex h-12 w-full max-w-6xl items-center gap-2 px-4 md:h-14 md:px-8"
      >
        <Link
          href="/"
          className="mr-auto inline-flex min-h-11 items-center text-[#F5F6F8] md:min-h-0"
        >
          <Wordmark className="h-[18px] w-auto md:h-5" />
        </Link>
        <Link href="/bench" className={`${LINK} hidden sm:inline-flex`}>
          Bench
        </Link>
        <Link href="/feed" className={`${LINK} hidden sm:inline-flex`}>
          Feed
        </Link>
        <a
          href={DOCS}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK}
        >
          Docs
        </a>
        <InstallButton className="ml-1 inline-flex h-8 items-center rounded-full border border-white/10 bg-white/[0.04] px-3.5 font-funnel-sans text-[13px] font-medium text-[#F5F6F8] transition-colors hover:bg-white/[0.09]" />
      </nav>
    </div>
  );
}
