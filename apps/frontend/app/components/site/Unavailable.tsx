import Link from 'next/link';
import Footer from '../common/Footer';
import { PAGE_COL } from './ui';

const LINK = 'inline-flex min-h-11 items-center text-s-muted underline underline-offset-4 motion-safe:transition-colors hover:text-s-text';

/**
 * The one unavailable panel (v6.1.17 final round): a read that failed says so, links home and keeps the footer. Shared by
 * the programs list, the guide-unavailable route, GuideView and the guide's error boundary (a client file, so this one
 * imports nothing server-only).
 */
export function Unavailable({ text }: { text: string }) {
  return (
    <>
      <div className={`${PAGE_COL} pt-8 md:pt-12`}>
        <p className="text-[18px] text-s-muted">{text}</p>
        <Link href="/" className={`${LINK} mt-4`}>
          EarnKit home
        </Link>
      </div>
      <Footer />
    </>
  );
}
