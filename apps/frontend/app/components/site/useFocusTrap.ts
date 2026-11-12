'use client';

import { type RefObject, useEffect } from 'react';

/** What can take focus inside the modal: links, enabled buttons and fields, and anything with a non-negative tabindex. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The id of the wrapper around everything on the page but the modal's portal (app/layout.tsx). */
export const SITE_ROOT = 'site-root';

/**
 * Where Tab goes inside the open modal (L27-2, v6.1.16): from the last focusable element Tab goes to the first, from
 * the first Shift+Tab goes to the last, and focus outside the modal comes back in; null leaves the browser's own step.
 * Pure: `items` in document order, `active` the focused element.
 */
export function trapTarget<T>(shift: boolean, items: readonly T[], active: T | null): T | null {
  if (items.length === 0) return null;
  const at = active === null ? -1 : items.indexOf(active);
  if (at < 0) return shift ? items[items.length - 1] : items[0];
  if (shift && at === 0) return items[items.length - 1];
  if (!shift && at === items.length - 1) return items[0];
  return null;
}

type Root = { setAttribute(name: string, value: string): void; removeAttribute(name: string): void };
/** `inert` on the page behind the modal while it is open, removed on close. `doc` is the document (a stub in tests). */
export function inertSiteRoot(doc: { getElementById(id: string): Root | null }, on: boolean): void {
  const root = doc.getElementById(SITE_ROOT);
  if (on) root?.setAttribute('inert', '');
  else root?.removeAttribute('inert');
}

/**
 * Keeps focus inside the modal at `ref` while `open`: the page behind it is `inert`, and Tab and Shift+Tab loop over
 * the modal's focusable elements. Declared before the effect that returns focus on close, so `inert` is gone first.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, open: boolean): void {
  useEffect(() => {
    if (!open) return;
    inertSiteRoot(document, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const next = trapTarget(e.shiftKey, items, document.activeElement as HTMLElement | null);
      if (next) {
        e.preventDefault();
        next.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      inertSiteRoot(document, false);
    };
  }, [ref, open]);
}
