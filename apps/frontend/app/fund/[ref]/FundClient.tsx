'use client';

import { useState } from 'react';
import type { RawTx } from '@/lib/earnkit/escrow';
import { sendAll } from '@/app/components/wallet';
import { walletErrorMessage } from '@/lib/earnkit/wallet-errors';

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
  // Set only once `sendAll` has returned a hash, i.e. the deposit is already onchain. Once set,
  // the only control offered re-POSTs this same hash — never re-sending the approve/create
  // transactions, which would waste gas (same wallet) or fund a second, untracked escrow
  // (a different wallet).
  const [sentTx, setSentTx] = useState<`0x${string}` | null>(null);

  async function confirm(tx: `0x${string}`) {
    setBusy(true);
    setMsg('Confirming with EarnKit…');
    try {
      const res = await fetch(`/api/sponsor/${ref_}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tx }),
      });
      const body = (await res.json()) as {
        campaign_url?: string;
        error?: string;
      };
      if (!res.ok || !body.campaign_url)
        throw new Error(body.error ?? 'Could not confirm.');
      window.location.href = body.campaign_url;
    } catch (err) {
      setMsg(walletErrorMessage(err));
      setBusy(false);
    }
  }

  async function fund() {
    setBusy(true);
    setMsg('');
    try {
      const tx = await sendAll(txs, setMsg);
      setSentTx(tx);
      await confirm(tx);
    } catch (err) {
      setMsg(walletErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 font-funnel-sans">
      {!sentTx ? (
        <>
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
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => confirm(sentTx)}
          className="mt-4 rounded-full bg-ek-blue-bright px-6 py-3 font-medium text-ek-navy-deep disabled:opacity-50"
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
