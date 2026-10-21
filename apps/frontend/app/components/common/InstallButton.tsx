'use client';

import { useCallback, useState } from 'react';
import AddToAgent from '../sections/AddToAgent';

/** "Add to your agent" (or `label`): opens the install modal (AddToAgent) with the starting phrase. */
export default function InstallButton({ className, label = 'Add to your agent' }: { className: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      {open && <AddToAgent onClose={close} />}
    </>
  );
}
