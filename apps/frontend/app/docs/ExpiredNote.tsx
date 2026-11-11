'use client';
import { useEffect, useState } from 'react';

/**
 * L23-15 (v6.1.16): /me with a sign-in that has ended lands on /docs?expired=1#record, and the record card says so in one
 * line at its top. Read in the browser, so the docs page stays static; the words come from the server (`SIGN_IN_EXPIRED`).
 */
export default function ExpiredNote({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(new URLSearchParams(window.location.search).get('expired') === '1');
  }, []);
  if (!shown) return null;
  return (
    <p role="status" className="rounded-[20px] bg-s-panel px-4 py-3 text-[15px] text-s-text">
      {text}
    </p>
  );
}
