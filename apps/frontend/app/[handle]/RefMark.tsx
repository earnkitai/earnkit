'use client';

import { useEffect } from 'react';
import { refCookieToSet } from '../../lib/earnkit/ref-cookie';

/**
 * v3.1 GTM W1: remembers the page a visitor arrived on (ref-cookie.ts), so an install that follows can be counted for
 * this builder. Renders nothing; sets the cookie once, in the browser, only when none is remembered.
 */
export default function RefMark({ handle }: { handle: string }) {
  useEffect(() => {
    try {
      const c = refCookieToSet(handle, document.cookie, location.protocol === 'https:');
      if (c) document.cookie = c;
    } catch {
      // Cookies blocked: nothing to count.
    }
  }, [handle]);
  return null;
}
