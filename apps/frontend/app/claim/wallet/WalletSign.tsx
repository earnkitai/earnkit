'use client';

import { useRef, useState } from 'react';
import { PILL_BLUE, PILL_WHITE } from '../../components/site/ui';
import type { WALLET_TEXT } from '../../../lib/earnkit/wallet-proof';

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const hexOf = (s: string) => `0x${Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('')}`;
/** A secondary pill on the dark card: a hairline, white text, 44px tall. */
const PILL_LINE =
  'inline-flex min-h-11 items-center justify-center rounded-full border border-s-chip-line px-6 text-[15px] font-semibold text-s-text motion-safe:transition-colors duration-200 hover:bg-s-chip disabled:opacity-60';

/**
 * v3.1 wallet proof: the signing step. The browser wallet (EIP-1193 window.ethereum: eth_requestAccounts, then
 * personal_sign of the exact message, no SDK), then a same-origin POST to /claim/wallet/proof. Cancel (4001) says
 * nothing was signed; no wallet: the line and Copy link; success: the Done block with the server's line (the short
 * wallet). With a reward wallet already set (`lead`), Sign in with X comes first and signing is for contracts only.
 */
export default function WalletSign({
  token, message, lead, xHref, text, titleClass,
}: {
  token: string; message: string; lead: string | null; xHref: string | null; text: typeof WALLET_TEXT; titleClass: string;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [noWallet, setNoWallet] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  async function sign() {
    const eth = (window as unknown as { ethereum?: Eth }).ethereum;
    if (!eth) {
      setStatus(text.noWallet);
      setNoWallet(true);
      return;
    }
    setBusy(true);
    setStatus('');
    let wallet: string;
    let signature: string;
    try {
      [wallet] = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      signature = (await eth.request({ method: 'personal_sign', params: [hexOf(message), wallet] })) as string;
    } catch (e) {
      setBusy(false);
      setStatus((e as { code?: number })?.code === 4001 ? text.cancelled : text.failed);
      return;
    }
    try {
      const r = await fetch('/claim/wallet/proof', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: token, wallet, signature }) });
      const j = (await r.json()) as { line?: string };
      if (r.ok) {
        setDone(j.line ?? '');
        requestAnimationFrame(() => doneRef.current?.focus());
        return;
      }
      setStatus(j.line || text.failed);
    } catch {
      setStatus(text.failed);
    }
    setBusy(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setStatus(text.copied);
    } catch {
      // nothing to copy to
    }
  }

  if (done !== null)
    return (
      <div data-ek-wallet-done="" className="flex flex-col gap-4">
        <h1 id="wallet-title" ref={doneRef} tabIndex={-1} className={`${titleClass} outline-none`}>
          {text.doneTitle}
        </h1>
        <p className="text-[17px] leading-relaxed text-s-card-body md:text-[19px]">{done}</p>
      </div>
    );
  const contractsOnly = lead !== null;
  return (
    <>
      <h1 id="wallet-title" className={titleClass}>
        {text.title}
      </h1>
      <p className="text-[17px] leading-relaxed text-s-card-body md:text-[19px]">{text.lead}</p>
      <p className="text-[15px] leading-relaxed text-s-card-meta">{text.basescan}</p>
      {lead ? (
        <p data-ek-wallet-x="" className="rounded-[22px] bg-s-inset px-5 py-4 text-[15px] leading-relaxed text-s-text">
          {lead}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <p className="text-[13px] text-s-card-meta">{text.sign}</p>
        <pre className="whitespace-pre-wrap break-all rounded-[22px] border border-s-line bg-s-inset22 px-5 py-4 font-mono text-[14px] leading-relaxed text-s-text">
          {message}
        </pre>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {contractsOnly && xHref ? (
          <a href={xHref} className={PILL_WHITE}>
            {text.xButton}
          </a>
        ) : null}
        <button type="button" onClick={sign} disabled={busy} className={contractsOnly ? PILL_LINE : `${PILL_BLUE} h-auto min-h-11 px-6 text-[15px] disabled:opacity-60`}>
          {contractsOnly ? text.contractsOnly : text.button}
        </button>
        {noWallet ? (
          <button type="button" onClick={copy} className={PILL_LINE}>
            {text.copy}
          </button>
        ) : null}
      </div>
      <p role="status" className="min-h-6 text-[15px] text-s-card-body">
        {status}
      </p>
    </>
  );
}
