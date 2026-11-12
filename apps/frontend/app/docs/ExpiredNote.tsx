'use client';
import { useSyncExternalStore } from 'react';

const never = () => () => {};

/**
 * L23-15 (v6.1.16): /me with a sign-in that has ended lands on /docs?expired=1#record, and the record card says so in one
 * line at its top. L43-12 (v6.1.19): a cookie that never was a live session lands on /docs?signin=1#record and reads
 * `signin` instead. Read in the browser, so the docs page stays static; the words come from the server
 * (`SIGN_IN_EXPIRED`, `SIGN_IN_FROM_LINK`).
 */
export default function ExpiredNote({ text, signin }: { text: string; signin: string }) {
  // Read once on the client, '' on the server, with no state set inside an effect (lint: set-state-in-effect).
  const which = useSyncExternalStore(
    never,
    () => {
      const q = new URLSearchParams(window.location.search);
      return q.get('expired') === '1' ? 'expired' : q.get('signin') === '1' ? 'signin' : '';
    },
    () => '',
  );
  if (!which) return null;
  return (
    <p role="status" className="rounded-[20px] bg-s-panel px-4 py-3 text-[15px] text-s-text">
      {which === 'expired' ? text : signin}
    </p>
  );
}
