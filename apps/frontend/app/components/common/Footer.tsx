import Link from 'next/link';
import { Wordmark } from '../ui/Logo';
import { XIcon } from '../ui/Icons';
import { FOOTER_COLUMNS, FOOTER_TAGLINE } from '../../../lib/earnkit/footer-links';

// Ruling 22 (plan): 44px tap targets.
const LINK =
  'inline-flex min-h-11 items-center px-1 text-ek-blue-soft underline-offset-4 transition-colors hover:text-ek-white hover:underline';

export default function Footer() {
  return (
    <footer className="w-full bg-ek-base pb-[calc(10dvh+76px)] pt-4 md:pb-10">
      <div className="rounded-[40px] bg-ek-navy-deep px-8 py-12 md:rounded-[56px] md:px-16 md:py-14">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between md:gap-16">
          <div className="flex flex-shrink-0 flex-col items-start gap-3">
            <Link href="/" className="inline-flex min-h-11 items-center text-ek-blue-light">
              <Wordmark className="h-7 w-auto" />
            </Link>
            <p className="font-funnel-sans text-lg text-ek-blue-light">{FOOTER_TAGLINE}</p>
          </div>

          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.title}>
                <h3 className="font-funnel-sans text-xs font-semibold uppercase tracking-wide text-ek-blue-soft/60">
                  {column.title}
                </h3>
                <ul className="mt-4 flex flex-col items-start gap-2">
                  {column.links.map((l) => (
                    <li key={l.href}>
                      {l.icon === 'x' ? (
                        <a
                          href={l.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={l.label}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border-2 border-ek-blue-soft/50 text-ek-blue-soft transition-colors hover:border-ek-blue-light hover:text-ek-white"
                        >
                          <XIcon className="h-5 w-5" />
                        </a>
                      ) : l.href.startsWith('/') ? (
                        <Link href={l.href} className={LINK}>
                          {l.label}
                        </Link>
                      ) : (
                        <a
                          href={l.href}
                          {...(l.href.startsWith('https://')
                            ? { target: '_blank', rel: 'noopener noreferrer' }
                            : {})}
                          className={LINK}
                        >
                          {l.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p
        aria-hidden="true"
        className="mt-4 select-none text-center font-funnel-display text-[18vw] font-bold leading-none tracking-[-0.03em] text-ek-blue-light/10"
      >
        EARNKIT
      </p>

      <p className="mt-4 text-center font-funnel-sans text-sm text-ek-blue-soft">
        &copy; {new Date().getFullYear()} Tokenfi Inc. All rights reserved.
      </p>
    </footer>
  );
}
