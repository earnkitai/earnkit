'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The nav's links. */
const LINKS = [
  { label: 'Programs', href: '/programs' },
  { label: 'Docs', href: '/docs' },
] as const;

const LINK = 'inline-flex min-h-11 items-center text-[15px] motion-safe:transition-colors duration-200 hover:text-s-text';

/** The no-store check behind `Your record` (v6.1.17 Task 4): it answers only `{ signedIn: boolean }`. */
export const SIGNED_IN_URL = '/api/me/signed-in';

/** Whether `pathname` is the link's page or under it (/programs/base-batches). */
function isActive(pathname: string | null, href: string): boolean {
  return pathname === href || (pathname ?? '').startsWith(`${href}/`);
}

/**
 * Whether the visitor is signed in, asked once after load (v6.1.17 Task 4: the layout reads no cookie, so the pages stay
 * static). False until the answer comes, and on any failure; without JavaScript it never runs (the footer links /me).
 */
function useSignedIn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(SIGNED_IN_URL, { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { signedIn?: unknown } | null) => {
        if (live) setOn(j?.signedIn === true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return on;
}

/**
 * Programs and Docs at 15px in s-muted, then `record` (Your record, to /me) once the signed-in check says so; the
 * current page in s-text, weight 600, aria-current="page".
 */
export default function NavLinks({ className = '', record = null }: { className?: string; record?: { label: string; href: string } | null }) {
  const pathname = usePathname();
  const signedIn = useSignedIn();
  return (
    <nav aria-label="Main" className={className}>
      {[...LINKS, ...(record && signedIn ? [record] : [])].map((l) => {
        const on = isActive(pathname, l.href);
        return (
          <Link key={l.href} href={l.href} prefetch={l.href === '/me' ? false : undefined} aria-current={on ? 'page' : undefined} className={`${LINK} ${on ? 'font-semibold text-s-text' : 'text-s-muted'}`}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
