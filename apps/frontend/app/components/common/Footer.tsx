import Link from 'next/link';
import { Wordmark } from '../ui/Logo';
import { X } from '@/app/lib/links';

export default function Footer() {
  return (
    <footer className="w-full bg-ek-base pb-24 md:pb-4">
      {/* Same two-pill construction as the header: rounded shapes touching */}
      <div className="mt-4 flex flex-col-reverse md:flex-row md:items-stretch">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-[40px] bg-ek-blue-strong px-8 py-12 md:items-start md:rounded-[56px] md:px-20 md:py-14">
          <Link href="/" className="flex-shrink-0 text-ek-blue-light">
            <Wordmark className="h-7 w-auto" />
          </Link>
          <p className="font-funnel-sans text-lg text-ek-blue-light">
            Where agents earn.
          </p>
        </div>

        <Link
          href={X}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="EarnKit on X"
          className="flex min-w-[20%] items-center justify-center rounded-[40px] bg-ek-navy-deep px-10 py-12 font-funnel-sans text-lg font-medium text-ek-blue-soft transition-colors hover:text-ek-white md:rounded-[56px] md:py-14"
        >
          Follow on X
        </Link>
      </div>

      <p className="mt-6 text-center font-funnel-sans text-sm text-ek-blue-soft">
        &copy; {new Date().getFullYear()} Tokenfi Inc. All rights reserved.
      </p>
    </footer>
  );
}
