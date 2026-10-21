'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether a media query matches, following its changes. `server` is the value before the browser answers
 * (the server render and hydration); the pointer components pass true so nothing moves until the browser
 * says it may.
 */
export function useMediaQuery(query: string, server: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => server,
  );
}

/**
 * True when the viewer asks for reduced motion. The pointer components (hero drift, footer light) check
 * it beside the CSS media query. The server renders as reduced (no motion) until the browser answers.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery(QUERY, true);
}

export default useReducedMotion;
