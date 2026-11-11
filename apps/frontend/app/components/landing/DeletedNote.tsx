'use client';
import { useEffect, useState } from 'react';

/**
 * L21-9 (v6.1.16): after a delete /me lands on /?deleted=1, and the home page says the account is deleted. Read in the
 * browser, so the home page stays static. The words come from the server (`ME_DELETED`): site-copy is not client code.
 */
export default function DeletedNote({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(new URLSearchParams(window.location.search).get('deleted') === '1');
  }, []);
  if (!shown) return null;
  return (
    <p role="status" className="mx-auto mt-2 rounded-[24px] bg-s-panel px-5 py-4 text-center text-[15px] text-s-good-text">
      {text}
    </p>
  );
}
