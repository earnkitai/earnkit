import Link from 'next/link';
import { Wordmark } from '../ui/Logo';
import { XIcon } from '../ui/Icons';
import { BENCH_FOOTER_TAGLINE, FOOTER_COLUMNS } from '../../../lib/earnkit/footer-links';
import { COLUMN } from './Panel';

// Ruling 22 (plan): 44px tap targets.
const LINK = 'inline-flex min-h-11 items-center text-ek-muted transition-colors hover:text-ek-text';

/**
 * R18, v3 Stage 3 (spec 5.6): a quiet footer under a hairline: the wordmark and tagline, the links of
 * FOOTER_COLUMNS in one wrapping row (the column titles group them in code only), the company line.
 * Nothing uppercase, no large faded logo.
 */
export default function Footer() {
  const links = FOOTER_COLUMNS.flatMap((c) => c.links);
  return (
    <footer className={`${COLUMN} mt-14 pb-10 md:mt-24 md:pb-14`}>
      <div className="flex flex-col gap-6 border-t border-ek-line pt-8 md:flex-row md:items-start md:justify-between md:pt-10">
        <div className="flex flex-col items-start gap-1">
          <Link href="/" className="inline-flex min-h-11 items-center text-ek-text">
            <Wordmark className="h-5 w-auto" />
          </Link>
          <p className="font-funnel-sans text-sm text-ek-muted">{BENCH_FOOTER_TAGLINE}</p>
        </div>
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-1 font-funnel-sans text-sm">
          {links.map((l) => (
            <li key={l.href}>
              {l.icon === 'x' ? (
                <a href={l.href} target="_blank" rel="noopener noreferrer" aria-label={l.label} className={`${LINK} min-w-11 justify-center`}>
                  <XIcon className="h-4 w-4" />
                </a>
              ) : l.href.startsWith('/') ? (
                <Link href={l.href} className={LINK}>
                  {l.label}
                </Link>
              ) : (
                <a href={l.href} {...(l.href.startsWith('https://') ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className={LINK}>
                  {l.label}
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-6 font-funnel-sans text-xs text-ek-muted">
        EarnKit is a product of Tokenfi Inc. &copy; {new Date().getFullYear()} Tokenfi Inc. All rights reserved.
      </p>
    </footer>
  );
}
