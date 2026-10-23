'use client';

import { useRef, useState } from 'react';
import { PILL_BLUE, PILL_WHITE } from '../../components/site/ui';
import type { WALLET_TEXT } from '../../../lib/earnkit/wallet-proof';

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
/** An EIP-6963 announcement: each installed wallet answers with its own provider, name and icon. */
type Found = { info: { uuid: string; name: string; icon: string }; provider: Eth };
/** Asks every installed wallet to announce itself (EIP-6963); falls back to window.ethereum when none answer. */
async function findWallets(): Promise<Found[]> {
  const found = new Map<string, Found>();
  const on = (e: Event) => {
    const d = (e as CustomEvent<Found>).detail;
    if (d?.info?.uuid && d.provider && !found.has(d.info.uuid)) found.set(d.info.uuid, d);
  };
  window.addEventListener('eip6963:announceProvider', on);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise((r) => setTimeout(r, 250));
  window.removeEventListener('eip6963:announceProvider', on);
  if (found.size) return [...found.values()];
  const eth = (window as unknown as { ethereum?: Eth }).ethereum;
  return eth ? [{ info: { uuid: 'injected', name: 'Browser wallet', icon: '' }, provider: eth }] : [];
}
/** Lets the person pick the account inside the wallet; wallets without wallet_requestPermissions use eth_requestAccounts. */
async function pickAccount(eth: Eth): Promise<string> {
  try {
    await eth.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
  } catch (e) {
    if ((e as { code?: number })?.code === 4001) throw e;
  }
  const [wallet] = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  return wallet;
}
const hexOf = (s: string) => `0x${Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('')}`;
/** A secondary pill on the dark card: a hairline, white text, 44px tall. */
const PILL_LINE =
  'inline-flex min-h-11 items-center justify-center rounded-full border border-s-chip-line px-6 text-[15px] font-semibold text-s-text motion-safe:transition-colors duration-200 hover:bg-s-chip disabled:opacity-60';

/**
 * v3.1 wallet proof: the signing step. The browser wallet (EIP-6963 discovery, a picker when more than one answers,
 * window.ethereum as the fallback; the account prompt, then personal_sign of the exact message, no SDK), then a same-origin POST to /claim/wallet/proof. Cancel (4001) says
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
  const [wallets, setWallets] = useState<Found[]>([]);
  const doneRef = useRef<HTMLHeadingElement>(null);

  async function sign() {
    setBusy(true);
    setStatus('');
    const found = await findWallets();
    if (!found.length) {
      setBusy(false);
      setStatus(text.noWallet);
      setNoWallet(true);
      return;
    }
    if (found.length > 1) {
      setBusy(false);
      setWallets(found);
      setStatus(text.pick);
      return;
    }
    await signWith(found[0].provider);
  }

  async function signWith(eth: Eth) {
    setBusy(true);
    setStatus('');
    let wallet: string;
    let signature: string;
    try {
      wallet = await pickAccount(eth);
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
        <pre className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-[22px] border border-s-line bg-s-inset22 px-5 py-4 font-mono text-[14px] leading-relaxed text-s-text">
          {message}
        </pre>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {contractsOnly && xHref ? (
          <a href={xHref} className={PILL_WHITE}>
            {text.xButton}
          </a>
        ) : null}
        {wallets.length ? null : <button type="button" onClick={sign} disabled={busy} className={contractsOnly ? PILL_LINE : `${PILL_BLUE} h-auto min-h-11 px-6 text-[15px] disabled:opacity-60`}>
          {contractsOnly ? text.contractsOnly : text.button}
        </button>}
        {wallets.map((w) => (
          <button key={w.info.uuid} type="button" data-ek-wallet-pick="" onClick={() => signWith(w.provider)} disabled={busy} className={`${PILL_LINE} gap-2`}>
            {w.info.icon.startsWith('data:image/') ? <img src={w.info.icon} alt="" width={20} height={20} className="size-5 rounded" /> : null}
            {w.info.name}
          </button>
        ))}
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
