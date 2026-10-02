'use client';

import { useState } from 'react';
import type { RawTx } from '@/lib/earnkit/escrow';
import { SendAllError, sendAll } from '@/app/components/wallet';
import { decideRetry } from '@/lib/earnkit/send-retry';
import { walletErrorMessage } from '@/lib/earnkit/wallet-errors';

export default function AwardClient({ ref_, tx }: { ref_: string; tx: RawTx }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // Set only once `sendAll` has returned a hash, i.e. the award is already onchain. Once set,
  // the only control offered re-POSTs this same hash — never re-sending `award`, which would
  // revert (or pay again) rather than simply re-confirming.
  const [sentTx, setSentTx] = useState<`0x${string}` | null>(null);
  // Set once EarnKit confirmed the payment: nothing left to retry, only the result stays.
  const [done, setDone] = useState(false);

  async function confirm(hash: `0x${string}`) {
    setBusy(true);
    try {
      const res = await fetch(`/api/sponsor/${ref_}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tx: hash }),
      });
      const body = (await res.json()) as { paid?: number; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not confirm.');
      setMsg(`Paid ${body.paid} winner(s). Done.`);
      setDone(true);
      setBusy(false);
    } catch (err) {
      setMsg(walletErrorMessage(err));
      setBusy(false);
    }
  }

  async function award() {
    setBusy(true);
    setMsg('');
    try {
      const hash = await sendAll([tx], setMsg);
      setSentTx(hash);
      await confirm(hash);
    } catch (err) {
      // sendAll failed partway through. The award tx is a single step, so if its hash was
      // submitted and isn't a confirmed revert, its outcome is unknown (it may have landed) —
      // the only safe move is to let the sponsor retry confirming that same hash, never resend
      // `award`.
      if (err instanceof SendAllError) {
        const decision = decideRetry(err.sent, 1, err.reverted);
        if (decision.action === 'confirm') setSentTx(decision.hash);
      }
      setMsg(walletErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 font-funnel-sans">
      {done ? null : !sentTx ? (
        <button
          type="button"
          disabled={busy}
          onClick={award}
          className="rounded-full bg-ek-blue-bright px-6 py-3 font-medium text-ek-navy-deep disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Connect wallet and pay winners'}
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => confirm(sentTx)}
          className="rounded-full bg-ek-blue-bright px-6 py-3 font-medium text-ek-navy-deep disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Retry confirmation'}
        </button>
      )}
      {msg ? (
        <p className="mt-4 text-sm text-ek-blue-light" role="status">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
