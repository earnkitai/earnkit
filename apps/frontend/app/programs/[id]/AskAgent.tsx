'use client';

import { useCallback, useState } from 'react';
import AddToAgent from '../../components/sections/AddToAgent';

/** The guide's one primary action: the install modal, ending with the program's own question. */
export default function AskAgent({ prompt }: { prompt: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-12 items-center justify-center text-nowrap rounded-full bg-ek-blue-bright px-7 py-3 font-funnel-sans text-base font-medium text-ek-navy-deep transition-colors hover:bg-ek-blue-soft"
      >
        Ask your agent
      </button>
      {open && <AddToAgent onClose={close} prompt={prompt} />}
    </>
  );
}
