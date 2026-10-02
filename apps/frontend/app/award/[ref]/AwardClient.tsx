'use client';

import { useState } from 'react';
import type { RawTx } from '@/lib/earnkit/escrow';
import { pollCheck, sendAll } from '@/app/components/wallet';
import WalletGate from '@/app/components/WalletGate';
import { walletErrorMessage } from '@/lib/earnkit/wallet-errors';

export default function AwardClient({
  ref_,
  tx,
  sponsorWallet,
}: {
  ref_: string;
  tx: RawTx;
  /** The campaign's bound wallet: the only one the escrow lets award. */
  sponsorWallet: string;
}) {
  const [busy, setBusy] = useState(false);
  // Once sent, the page only waits for EarnKit to read the award from the chain.
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState('');

  async function award() {
    setBusy(true);
    setMsg('');
    try {
      await sendAll([tx], sponsorWallet, setMsg);
    } catch (err) {
      setMsg(walletErrorMessage(err));
      setBusy(false);
      return;
    }
    setSent(true);
    setMsg('Award sent. Waiting for EarnKit to see it onchain…');
    const r = await pollCheck(ref_, (c) => c.state === 'awarded');
    setMsg(
      r?.state === 'awarded'
        ? `Paid ${r.paid} winner(s). Done.`
        : "EarnKit hasn't seen the award onchain yet. Reload this page in a minute: it checks again.",
    );
    setBusy(false);
  }

  // Progress and results stay visible even if the wallet switches accounts after sending.
  return (
    <>
      <WalletGate wallet={sponsorWallet}>
        <div className="mt-8 font-funnel-sans">
          {sent ? null : (
            <button
              type="button"
              disabled={busy}
              onClick={award}
              className="rounded-full bg-ek-blue-bright px-6 py-3 font-medium text-ek-navy-deep disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Pay the winners'}
            </button>
          )}
        </div>
      </WalletGate>
      {msg ? (
        <p
          className="mt-4 font-funnel-sans text-sm text-ek-blue-light"
          role="status"
        >
          {msg}
        </p>
      ) : null}
    </>
  );
}
