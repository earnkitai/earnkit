'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Button from './Button';
import { Wordmark, Mark } from '../ui/Logo';
import * as links from '@/app/lib/links';

export default function Header() {
  const pathname = usePathname();
  const isEcosystems = pathname?.startsWith('/for-ecosystems');

  const nav = isEcosystems
    ? [
        { label: 'Docs', href: links.DOCS },
        { label: 'For Agents', href: links.FOR_AGENTS },
      ]
    : [
        { label: 'Docs', href: links.DOCS },
        { label: 'For Ecosystems', href: links.FOR_ECOSYSTEMS },
      ];

  const cta = isEcosystems
    ? { label: 'Run a Campaign', href: links.RUN_CAMPAIGN }
    : { label: 'Install EarnKit', href: links.INSTALL };

  return (
    <>
      {/* Desktop */}
      <header className="hidden h-[12vh] w-full items-center justify-between gap-4 font-funnel-display md:flex">
        <div className="flex min-h-full flex-1 items-center gap-10 rounded-[56px] bg-ek-navy px-12 lg:px-20">
          <Link
            href="/"
            className="logoSVG flex-shrink-0 text-ek-blue-light transition-colors hover:text-ek-white"
          >
            <Wordmark />
          </Link>

          <nav aria-label="Main" className="flex items-center gap-8">
            {nav.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="font-funnel-sans text-lg font-medium text-ek-blue-soft transition-colors hover:text-ek-white"
                {...(item.href.startsWith('http')
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <Button href={cta.href} className="min-h-full min-w-[20%] rounded-[56px]">
          {cta.label}
        </Button>
      </header>

      {/* Mobile */}
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

        <div className="mobile-header-bg z-30 flex h-[10dvh] w-full max-w-full flex-row items-center gap-3 overflow-hidden bg-ek-black px-5">
          <Link
            href="/"
            className="flex-shrink-0 text-ek-blue-light transition-colors hover:text-ek-white"
          >
            <Mark />
          </Link>

          <nav
            aria-label="Main"
            className="no-scrollbar flex min-w-0 flex-1 items-center justify-end gap-3 overflow-x-auto"
          >
            <Link
              href={nav[1].href}
              className="flex-shrink-0 font-funnel-sans text-sm font-medium text-ek-blue-soft transition-colors hover:text-ek-white"
            >
              {nav[1].label}
            </Link>
            <Button
              href={cta.href}
              className="flex-shrink-0 px-5 py-2.5 text-sm"
            >
              {cta.label}
            </Button>
          </nav>
        </div>
      </header>
    </>
  );
}
