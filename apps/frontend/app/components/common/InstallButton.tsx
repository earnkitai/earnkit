'use client';

import { useCallback, useState } from 'react';
import AddToAgent from '../sections/AddToAgent';

/** "Add to your agent": opens the install modal (AddToAgent) with the starting phrase. `bench`: the Bench flag (no bonus pill). */
export default function InstallButton({ className, bench = false }: { className: string; bench?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        Add to your agent
      </button>
      {open && <AddToAgent onClose={close} bench={bench} />}
    </>
  );
}
