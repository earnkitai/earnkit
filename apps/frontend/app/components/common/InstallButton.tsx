'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import AddToAgent from '../sections/AddToAgent';

/** Where every install action goes without JavaScript: the /docs install card (L27-1, v6.1.16). */
export const INSTALL_HREF = '/docs#install';

/**
 * An install action as a link (L27-1, v6.1.16): `<a href="/docs#install" data-install>`, so without JavaScript it opens
 * the docs' install card. On mount a click handler upgrades it to the install modal (AddToAgent) with `prompt` as its
 * last line; a click with a modifier key (new tab, new window) keeps the link.
 */
export function InstallLink({ label, className, prompt }: { label: ReactNode; className: string; prompt?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      setOpen(true);
    };
    a.addEventListener('click', onClick);
    return () => a.removeEventListener('click', onClick);
  }, []);
  return (
    <>
      <a ref={ref} href={INSTALL_HREF} data-install="" className={className}>
        {label}
      </a>
      {open && <AddToAgent onClose={close} prompt={prompt} />}
    </>
  );
}

/** "Add to your agent" (or `label`): the install link, upgraded to the install modal with the starting phrase. */
export default function InstallButton({ className, label = 'Add to your agent' }: { className: string; label?: ReactNode }) {
  return <InstallLink label={label} className={className} />;
}
