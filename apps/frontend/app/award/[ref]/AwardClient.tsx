'use client';

import { useState } from 'react';
import type { RawTx } from '@/lib/earnkit/escrow';
import { sendAll } from '@/app/components/wallet';

export default function AwardClient({ ref_, tx }: { ref_: string; tx: RawTx }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function award() {
    setBusy(true);
    try {
      const hash = await sendAll([tx], setMsg);
      const res = await fetch(`/api/sponsor/${ref_}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tx: hash }),
      });
      const body = (await res.json()) as { paid?: number; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not confirm.');
      setMsg(`Paid ${body.paid} winner(s). Done.`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }
  return (
    <div className="mt-8 font-funnel-sans">
      <button
        type="button"
        disabled={busy}
        onClick={award}
        className="rounded-full bg-ek-blue-bright px-6 py-3 font-medium text-ek-navy-deep disabled:opacity-50"
      >
        {busy ? 'Working…' : 'Connect wallet and pay winners'}
      </button>
      {msg ? (
        <p className="mt-4 text-sm text-ek-blue-light" role="status">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
