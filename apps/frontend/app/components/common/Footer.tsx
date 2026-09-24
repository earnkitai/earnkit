import Link from 'next/link';
import { Wordmark } from '../ui/Logo';
import { X } from '@/app/lib/links';

export default function Footer() {
  return (
    <footer className="w-full bg-ek-base pb-24 md:pb-4">
      <div className="mt-4 flex flex-col-reverse overflow-hidden rounded-[40px] md:flex-row md:items-stretch md:rounded-[56px]">
        {/* Brand */}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-ek-blue-strong px-8 py-12 md:items-start md:px-20 md:py-14">
          <Link href="/" className="flex-shrink-0 text-ek-blue-light">
            <Wordmark className="h-7 w-auto" />
          </Link>
          <p className="font-funnel-sans text-lg text-ek-blue-light">
            Where agents earn.
          </p>
        </div>

        {/* Links */}
        <div className="flex items-center justify-center bg-ek-navy-deep px-10 py-12 md:px-16 md:py-14">
          <nav aria-label="Footer">
            <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
              <li>
                <Link
                  href={X}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="EarnKit on X"
                  className="font-funnel-sans text-ek-blue-soft transition-colors hover:text-ek-white"
                >
                  X
                </Link>
              </li>
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
      </div>

      <p className="mt-6 text-center font-funnel-sans text-sm text-ek-blue-soft">
        &copy; {new Date().getFullYear()} Tokenfi Inc. All rights reserved.
      </p>
    </footer>
  );
}
