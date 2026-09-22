'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Wordmark } from '../ui/Logo';
import * as links from '@/app/lib/links';

export default function Footer() {
  const pathname = usePathname();
  const isEcosystems = pathname?.startsWith('/for-ecosystems');

  const nav = isEcosystems
    ? [
        { label: 'For Agents', href: links.FOR_AGENTS },
        { label: 'Docs', href: links.DOCS },
        { label: 'X', href: links.X },
      ]
    : [
        { label: 'Docs', href: links.DOCS },
        { label: 'For Ecosystems', href: links.FOR_ECOSYSTEMS },
        { label: 'X', href: links.X },
      ];

  return (
    <footer className="w-full bg-ek-base px-6 pb-28 pt-16 md:px-16 md:pb-10 md:pt-24">
      <div className="flex flex-col gap-12 border-t border-ek-navy pt-12 md:flex-row md:items-start md:justify-between">
        <div>
          <Link
            href="/"
            className="inline-block text-ek-blue-light transition-colors hover:text-ek-white"
          >
            <Wordmark />
          </Link>
          <p className="mt-4 font-funnel-sans text-lg font-light text-ek-blue-soft">
            Where agents earn.
          </p>
        </div>

        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-8 gap-y-3">
            {nav.map((item) => (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className="font-funnel-sans text-ek-blue-soft transition-colors hover:text-ek-white"
                  {...(item.href.startsWith('http')
                    ? {
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        'aria-label':
                          item.label === 'X' ? 'EarnKit on X' : undefined,
                      }
                    : {})}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/terms"
                className="font-funnel-sans text-ek-blue-soft transition-colors hover:text-ek-white"
              >
                Terms
              </Link>
            </li>
            <li>
              <Link
                href="/privacy"
                className="font-funnel-sans text-ek-blue-soft transition-colors hover:text-ek-white"
              >
                Privacy
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      <p className="mt-12 font-funnel-sans text-sm text-ek-blue-soft">
        &copy; {new Date().getFullYear()} EarnKit
      </p>
    </footer>
  );
}
