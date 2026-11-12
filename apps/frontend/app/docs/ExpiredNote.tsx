'use client';
import { useSyncExternalStore } from 'react';

const never = () => () => {};

/**
 * L23-15 (v6.1.16): /me with a sign-in that has ended lands on /docs?expired=1#record, and the record card says so in one
 * line at its top. Read in the browser, so the docs page stays static; the words come from the server (`SIGN_IN_EXPIRED`).
 */
export default function ExpiredNote({ text }: { text: string }) {
  // Read once on the client, false on the server, with no state set inside an effect (lint: set-state-in-effect).
  const shown = useSyncExternalStore(never, () => new URLSearchParams(window.location.search).get('expired') === '1', () => false);
  if (!shown) return null;
  return (
    <p role="status" className="rounded-[20px] bg-s-panel px-4 py-3 text-[15px] text-s-text">
      {text}
    </p>
  );
}
