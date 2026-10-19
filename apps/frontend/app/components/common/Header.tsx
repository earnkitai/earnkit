import Link from 'next/link';
import { Wordmark, Mark } from '../ui/Logo';
import { DOCS } from '../../lib/links';
import InstallButton from './InstallButton';
import { benchEnabled } from '../../../lib/earnkit/builder-score-flag';

/**
 * The site header. v2.7 fix round 1: the persistent call to action is the install ("Add to your
 * agent", the same modal as the hero). v2.7.1: "Docs" (footer-links DOCS) beside it on every page,
 * desktop and mobile; "Follow on X" lives in the footer only.
 */
export default function Header() {
  // v2.13 R16: the install modal shows no builder bonus pill under the Bench flag.
  const bench = benchEnabled();
  return (
    <>
      {/* Desktop */}
      <header className="hidden h-[12vh] w-full items-center justify-between font-funnel-display md:flex">
        <div className="flex min-h-full flex-1 items-center justify-between rounded-[56px] bg-ek-navy pl-[5rem] pr-12">
          <Link
            href="/"
            className="logoSVG ml-4 flex-shrink-0 text-ek-blue-light transition-colors hover:text-ek-white"
          >
            <Wordmark />
          </Link>
          <a
            href={DOCS}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center px-2 font-funnel-sans text-lg font-medium text-ek-blue-soft transition-colors hover:text-ek-white"
          >
            Docs
          </a>
        </div>

        <InstallButton bench={bench} className="flex min-h-full min-w-[20%] items-center justify-center rounded-[56px] bg-ek-blue-bright px-8 font-funnel-sans text-xl font-medium text-ek-navy-deep transition-colors hover:bg-ek-blue-soft 2xl:text-[1.2rem]" />
      </header>

      {/* Mobile - fixed bottom bar */}
      <header className="container2 fixed bottom-0 z-50 flex w-full flex-col items-center justify-between font-funnel-display md:hidden">
        <div className="absolute left-0 top-[-56px] text-ek-black">
          <svg
            className="-rotate-90"
            width="56"
            height="56"
            viewBox="0 0 56 56"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M0 0 H56 V56 H0 Z M0 56 A56 56 0 0 1 56 0 L56 56 Z"
              fill="currentColor"
              fillRule="evenodd"
            />
          </svg>
        </div>
        <div className="absolute right-0 top-[-56px] text-ek-black">
          <svg
            className="rotate-180"
            width="56"
            height="56"
            viewBox="0 0 56 56"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M0 0 H56 V56 H0 Z M0 56 A56 56 0 0 1 56 0 L56 56 Z"
              fill="currentColor"
              fillRule="evenodd"
            />
          </svg>
        </div>

        <div className="mobile-header-bg z-30 flex h-[10dvh] w-full max-w-full flex-row items-center justify-between gap-3 bg-ek-black px-5">
          <Link
            href="/"
            className="flex-shrink-0 text-ek-blue-light transition-colors hover:text-ek-white"
          >
            <Mark />
          </Link>
          <a
            href={DOCS}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex min-h-11 items-center px-2 font-funnel-sans text-base font-medium text-ek-blue-soft transition-colors hover:text-ek-white"
          >
            Docs
          </a>
          <InstallButton bench={bench} className="min-h-11 flex-shrink-0 rounded-full bg-ek-blue-bright px-5 py-2.5 font-funnel-sans text-base font-medium text-ek-navy-deep transition-colors hover:bg-ek-blue-soft" />
        </div>
      </header>
    </>
  );
}
