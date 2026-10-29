'use client';

import { useEffect } from 'react';
import { refCookieToSet, refSourceOfQuery } from '../../../lib/earnkit/ref-cookie';

/**
 * v4.0 Task 10: `?ref=tokensfun` on any page remembers where the visitor came from (ref-cookie.ts, first visit wins),
 * so an install that follows is counted (installations.ref_source). Renders nothing. (Not middleware: site-proof SP10
 * keeps the app free of it.)
 */
export default function RefSourceMark() {
  useEffect(() => {
    try {
      const src = refSourceOfQuery(new URLSearchParams(location.search).get('ref'));
      const c = src && refCookieToSet(src, document.cookie, location.protocol === 'https:');
      if (c) document.cookie = c;
    } catch {
      // Cookies blocked: nothing to count.
    }
  }, []);
  return null;
}
