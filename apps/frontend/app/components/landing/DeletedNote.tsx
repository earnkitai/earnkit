'use client';
import { useSyncExternalStore } from 'react';

const never = () => () => {};

/**
 * L21-9, L27-11 (v6.1.16): after a delete /me lands on /?deleted=1, and the home page says `Your record is deleted.` Read in the
 * browser, so the home page stays static. The words come from the server (`ME_DELETED_LINE`): site-copy is not client code.
 */
export default function DeletedNote({ text }: { text: string }) {
  // Read once on the client, false on the server, with no state set inside an effect (lint: set-state-in-effect).
  const shown = useSyncExternalStore(never, () => new URLSearchParams(window.location.search).get('deleted') === '1', () => false);
  if (!shown) return null;
  return (
    <p role="status" className="mx-auto mt-2 rounded-[24px] bg-s-panel px-5 py-4 text-center text-[15px] text-s-good-text">
      {text}
    </p>
  );
}
