'use client';

import Link from 'next/link';
import { PAGE_COL } from '../../components/site/ui';
import { GUIDE_UNAVAILABLE } from './unavailable';

/**
 * A guide whose read failed (N3, v6.1.17 Task 4): the page throws, so ISR never caches the failure and keeps serving the
 * last good guide; with none kept yet, this panel shows (inside the site header) and the next request reads again.
 */
export default function GuideError() {
  return (
    <div className={`${PAGE_COL} pb-16 pt-8 md:pt-12`}>
      <p className="text-[18px] text-s-muted">{GUIDE_UNAVAILABLE}</p>
      <Link href="/" className="mt-4 inline-flex min-h-11 items-center text-s-muted underline underline-offset-4 hover:text-s-text">
        EarnKit home
      </Link>
    </div>
  );
}
