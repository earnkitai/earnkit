import Link from 'next/link';
import { Wordmark, Mark } from '../ui/Logo';
import { FOLLOW_X } from '@/app/lib/links';

export default function Header() {
  return (
    <>
      {/* Desktop */}
      <header className="hidden h-[12vh] w-full items-center justify-between font-funnel-display md:flex">
        <div className="flex min-h-full flex-1 items-center rounded-[56px] bg-ek-navy px-[5rem]">
          <Link
            href="/"
            className="logoSVG ml-4 flex-shrink-0 text-ek-blue-light transition-colors hover:text-ek-white"
          >
            <Wordmark />
          </Link>
        </div>

        <Link
          href={FOLLOW_X}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-full min-w-[20%] items-center justify-center rounded-[56px] bg-ek-blue-bright font-funnel-sans text-xl font-medium text-ek-navy-deep transition-colors hover:bg-ek-blue-soft 2xl:text-[1.2rem]"
        >
          Follow on X
        </Link>
      </header>

      {/* Mobile — fixed bottom bar */}
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
          <Link
            href={FOLLOW_X}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 rounded-full bg-ek-blue-bright px-5 py-2.5 font-funnel-sans text-sm font-medium text-ek-navy-deep transition-colors hover:bg-ek-blue-soft"
          >
            Follow on X
          </Link>
        </div>
      </header>
    </>
  );
}
