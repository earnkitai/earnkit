'use client';

import { useCallback, useState } from 'react';
import AddToAgent from '../../components/sections/AddToAgent';
import { BTN_PRIMARY } from '../../components/common/Button';

/** The guide's one primary action: the install modal, ending with the program's own question. */
export default function AskAgent({ prompt }: { prompt: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={BTN_PRIMARY}
      >
        Ask your agent
      </button>
      {open && <AddToAgent onClose={close} prompt={prompt} />}
    </>
  );
}
