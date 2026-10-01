'use client';

import { useState } from 'react';
import type { RawTx } from '@/lib/earnkit/escrow';
import { sendAll } from '@/app/components/wallet';

export default function FundClient({
  ref_,
  txs,
}: {
  ref_: string;
  txs: RawTx[];
}) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function fund() {
    setBusy(true);
    try {
      const tx = await sendAll(txs, setMsg);
      setMsg('Confirming with EarnKit…');
      const res = await fetch(`/api/sponsor/${ref_}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tx }),
      });
      const body = (await res.json()) as {
        campaign_url?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? 'Could not confirm.');
      window.location.href = body.campaign_url!;
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 font-funnel-sans">
      <label className="flex items-start gap-3 text-sm text-ek-blue-light">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1"
        />
        <span>
          I agree to the{' '}
          <a href="/sponsor-terms" target="_blank" className="underline">
            sponsor terms
          </a>
          .
        </span>
      </label>
      <button
        type="button"
        disabled={!agreed || busy}
        onClick={fund}
        className="mt-4 rounded-full bg-ek-blue-bright px-6 py-3 font-medium text-ek-navy-deep disabled:opacity-50"
      >
        {busy ? 'Working…' : 'Connect wallet and deposit'}
      </button>
      {msg ? (
        <p className="mt-4 text-sm text-ek-blue-light" role="status">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
