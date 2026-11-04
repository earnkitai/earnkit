'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The nav's links. */
const LINKS = [
  { label: 'Programs', href: '/programs' },
  { label: 'Docs', href: '/docs' },
] as const;

const LINK = 'inline-flex min-h-11 items-center text-[15px] motion-safe:transition-colors duration-200 hover:text-s-text';

/** Whether `pathname` is the link's page or under it (/programs/base-batches). */
function isActive(pathname: string | null, href: string): boolean {
  return pathname === href || (pathname ?? '').startsWith(`${href}/`);
}

/** Programs and Docs at 15px in s-muted; the current page in s-text, weight 600, aria-current="page". */
export default function NavLinks({ className = '' }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={className}>
      {LINKS.map((l) => {
        const on = isActive(pathname, l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={on ? 'page' : undefined} className={`${LINK} ${on ? 'font-semibold text-s-text' : 'text-s-muted'}`}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
