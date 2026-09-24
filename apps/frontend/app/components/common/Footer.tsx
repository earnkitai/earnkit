'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Wordmark } from '../ui/Logo';
import BackedBy from '../sections/BackedBy';
import * as links from '@/app/lib/links';

export default function Footer() {
  const pathname = usePathname();
  const isEcosystems = pathname?.startsWith('/for-ecosystems');

  const productLinks = isEcosystems
    ? [{ label: 'For Agents', href: links.FOR_AGENTS }]
    : [{ label: 'For Ecosystems', href: links.FOR_ECOSYSTEMS }];

  return (
    <footer className="w-full bg-ek-base pb-24 md:pb-2">
      <section className="mt-10 w-full rounded-[56px]">
        <div className="mx-auto flex flex-col-reverse justify-between gap-4 md:flex-row">
          {/* Brand block */}
          <div className="flex flex-1 flex-col items-center justify-center gap-16 rounded-[56px] bg-ek-blue-strong py-16 pl-0 md:flex-row md:justify-start md:py-24 md:pl-24">
            <div className="flex flex-col items-center md:items-start">
              <Link href="/" className="flex-shrink-0 text-ek-blue-light">
                <Wordmark className="h-8 w-auto" />
              </Link>
              <p className="mt-4 font-funnel-sans text-lg text-ek-blue-light">
                Where agents earn.
              </p>
            </div>
          </div>

          {/* Links block */}
          <div className="grid grid-cols-2 gap-x-10 gap-y-8 rounded-[56px] bg-ek-navy-deep p-10 md:gap-x-24 md:px-20">
            <div>
              <h3 className="mb-4 text-left font-funnel-display font-semibold text-ek-blue-bright">
                EarnKit
              </h3>
              <ul className="space-y-3">
                {productLinks.map((item) => (
                  <li key={item.label} className="text-left">
                    <Link
                      href={item.href}
                      className="font-funnel-sans text-ek-blue-bright transition-colors hover:text-white"
                      {...(item.href.startsWith('http')
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="mb-4 text-left font-funnel-display font-semibold text-ek-blue-bright">
                Socials
              </h3>
              <ul className="space-y-3">
                <li className="text-left">
                  <Link
                    href={links.X}
                    className="font-funnel-sans text-ek-blue-bright transition-colors hover:text-white"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="EarnKit on X"
                  >
                    X
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mx-auto flex max-w-6xl flex-col items-center justify-center gap-6 px-4 py-4 md:flex-row">
          <div className="flex items-center gap-6 font-funnel-sans text-sm text-ek-white">
            <Link
              href="/terms"
              className="transition-colors hover:text-ek-blue-bright"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="transition-colors hover:text-ek-blue-bright"
            >
              Privacy
            </Link>
          </div>
        </div>

        <div className="flex w-full items-center justify-center pb-10 text-center font-funnel-sans text-sm text-ek-white">
          &copy; {new Date().getFullYear()} EarnKit
        </div>

        {/* Investors sit at the very bottom, as in the Figma landing */}
        <BackedBy />
      </section>
    </footer>
  );
}
