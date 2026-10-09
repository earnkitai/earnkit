'use client';

import { useEffect, useState } from 'react';
import type { RawTx } from '@/lib/earnkit/escrow';
import { pollCheck, sendBatched } from '@/app/components/wallet';
import WalletGate from '@/app/components/WalletGate';
import {
  DEADLINE_MARGIN_MS,
  DEADLINE_PASSED,
} from '@/lib/earnkit/sponsor-text';
import { walletErrorMessage } from '@/lib/earnkit/wallet-errors';

export default function FundClient({
  ref_,
  txs,
  endsAt,
  sponsorWallet,
}: {
  ref_: string;
  txs: RawTx[];
  /** The draft's deadline (ms). A deposit needs to land before endsAt - 10 minutes. */
  endsAt: number;
  /** The wallet bound at create: the only one whose deposit counts. */
  sponsorWallet: string;
}) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Once the deposit is sent, the page only waits for EarnKit to read it from the chain. Sending
  // again is harmless (the same wallet can't fund a ref twice) but pointless, so it's not offered.
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState('');
  // An open page re-checks the deadline: the server only checked when it rendered. Starts false
  // (the server rendered this only for a fundable draft), so hydration matches.
  const [tooLate, setTooLate] = useState(false);
  useEffect(() => {
    const check = () => setTooLate(Date.now() > endsAt - DEADLINE_MARGIN_MS);
    check();
    const t = setInterval(check, 15_000);
    return () => clearInterval(t);
  }, [endsAt]);

  async function fund() {
    if (Date.now() > endsAt - DEADLINE_MARGIN_MS) {
      setTooLate(true);
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      // One signature when the wallet supports atomic batching, else approve then deposit.
      await sendBatched(txs, sponsorWallet, setMsg);
    } catch (err) {
      setMsg(walletErrorMessage(err));
      setBusy(false);
      return;
    }
    setSent(true);
    setMsg('Deposit sent. Waiting for EarnKit to see it onchain…');
    const r = await pollCheck(
      ref_,
      (c) => c.state === 'live' || c.state === 'awarded',
    );
    if (r?.campaign_url) window.location.href = r.campaign_url;
    else
      setMsg(
        r?.problem
          ? `${r.problem[0].toUpperCase()}${r.problem.slice(1)} Contact EarnKit to have it refunded.`
          : "EarnKit hasn't seen the deposit onchain yet. Reload this page in a minute: it checks again.",
      );
    setBusy(false);
  }

  // Progress and results stay visible even if the wallet switches accounts after sending.
  return (
    <>
      <WalletGate wallet={sponsorWallet}>
        <div className="mt-8 font-funnel-sans">
          {sent ? null : (
            <>
              <div className="mb-6 text-sm text-ek-blue-light">
                <p>Your wallet will ask you to sign:</p>
                <ol className="mt-2 list-decimal pl-5">
                  {txs.map((t) => (
                    <li key={t.data}>{t.description}</li>
                  ))}
                </ol>
                <p className="mt-2">
                  One signature if your wallet supports batching, otherwise one
                  per step.
                </p>
              </div>
              <label className="flex items-start gap-3 text-sm text-ek-blue-light">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  I agree to the{' '}
                  <a
                    href="/terms#sponsor-terms"
                    target="_blank"
                    className="underline"
                  >
                    sponsor terms
                  </a>
                  .
                </span>
              </label>
              <button
                type="button"
                disabled={!agreed || busy || tooLate}
                onClick={fund}
                className="mt-4 rounded-full bg-ek-blue-bright px-6 py-3 font-medium text-ek-navy-deep disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Deposit the pool'}
              </button>
              {tooLate ? (
                <p className="mt-4 text-sm text-ek-white" role="status">
                  {DEADLINE_PASSED}
                </p>
              ) : null}
            </>
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
