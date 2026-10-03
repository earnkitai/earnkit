'use client';

import { useCallback, useEffect, useState } from 'react';
import { createWalletClient, custom, publicActions, type Chain } from 'viem';
import { base, baseSepolia, foundry } from 'viem/chains';
import type { RawTx } from '@/lib/earnkit/escrow';
import { atomicBatching } from '@/lib/earnkit/wallet-batch';

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown[] }): Promise<unknown>;
      on?(event: 'accountsChanged', fn: (accounts: string[]) => void): void;
      removeListener?(
        event: 'accountsChanged',
        fn: (accounts: string[]) => void,
      ): void;
    };
  }
}

const CHAINS: Record<number, Chain> = {
  8453: base,
  84532: baseSepolia,
  31337: foundry,
};

const NO_WALLET =
  'No browser wallet found. Install MetaMask, Coinbase Wallet, or Rabby.';

/** "0xABCD…1234": how the pages name the campaign's bound wallet. */
export const shortWallet = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * The browser wallet's connected account (lowercase), read without a prompt on load and kept up to
 * date when the user switches accounts; `connect` asks the wallet to connect.
 */
export function useAccount() {
  const [account, setAccount] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    const set = (accounts: string[]) =>
      setAccount(accounts[0]?.toLowerCase() ?? null);
    eth
      .request({ method: 'eth_accounts' })
      .then((a) => set(a as string[]))
      .catch(() => undefined);
    eth.on?.('accountsChanged', set);
    return () => eth.removeListener?.('accountsChanged', set);
  }, []);
  const connect = useCallback(async () => {
    setError('');
    if (!window.ethereum) return setError(NO_WALLET);
    try {
      const a = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];
      setAccount(a[0]?.toLowerCase() ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  return { account, connect, error };
}

/** A wallet client on the txs' chain, connected as `from` (the campaign's bound wallet). */
async function connect(
  txs: RawTx[],
  from: string,
  onStep: (msg: string) => void,
) {
  if (!window.ethereum) throw new Error(NO_WALLET);
  const chain = CHAINS[txs[0].chain_id];
  const wallet = createWalletClient({
    chain,
    transport: custom(window.ethereum),
  }).extend(publicActions);
  const [account] = await wallet.requestAddresses();
  if (account.toLowerCase() !== from.toLowerCase())
    throw new Error(`Switch your wallet to ${shortWallet(from)} first.`);
  if ((await wallet.getChainId()) !== chain.id) {
    onStep(`Switching your wallet to ${chain.name}…`);
    await wallet.switchChain({ id: chain.id }).catch(async () => {
      await wallet.addChain({ chain });
      await wallet.switchChain({ id: chain.id });
    });
  }
  return { wallet, account, chain };
}

type Connected = Awaited<ReturnType<typeof connect>>;

/**
 * Sends each tx in order, waiting for each receipt (createCampaign needs the approval mined; a
 * revert is reported). The page then polls EarnKit, which reads the outcome from the chain.
 */
async function sendInOrder(
  { wallet, account, chain }: Connected,
  txs: RawTx[],
  onStep: (msg: string) => void,
) {
  for (const [i, tx] of txs.entries()) {
    onStep(
      `Step ${i + 1} of ${txs.length}: ${tx.description}. Confirm in your wallet…`,
    );
    const hash = await wallet.sendTransaction({
      account,
      to: tx.to,
      data: tx.data,
      chain,
    });
    onStep(`Waiting for step ${i + 1} to confirm…`);
    // The last step's outcome is read by EarnKit from the chain, so an RPC hiccup while waiting
    // for its receipt is not an error here; a revert still is.
    const last = i === txs.length - 1;
    const receipt = await wallet
      .waitForTransactionReceipt({ hash })
      .catch((err) => {
        if (last) return null;
        throw err;
      });
    if (receipt && receipt.status !== 'success')
      throw new Error(`Step ${i + 1} failed onchain. Try again.`);
  }
}

/** Sends each tx in order from `from` (the campaign's bound wallet): one signature per tx. */
export async function sendAll(
  txs: RawTx[],
  from: string,
  onStep: (msg: string) => void,
): Promise<void> {
  await sendInOrder(await connect(txs, from, onStep), txs, onStep);
}

/**
 * One signature when the wallet can (EIP-5792): if wallet_getCapabilities says atomic batching is
 * supported on the chain, every tx goes in one wallet_sendCalls batch; otherwise they are sent in
 * order, as `sendAll`. Either way the page then polls EarnKit, which finds the outcome by reading
 * the chain (no hash is handed over).
 */
export async function sendBatched(
  txs: RawTx[],
  from: string,
  onStep: (msg: string) => void,
): Promise<'batched' | 'sequential'> {
  const c = await connect(txs, from, onStep);
  // Wallets without EIP-5792 reject the method: that just means "send them in order".
  const caps = await c.wallet
    .getCapabilities({ account: c.account, chainId: c.chain.id })
    .catch(() => null);
  if (txs.length < 2 || !atomicBatching(caps)) {
    await sendInOrder(c, txs, onStep);
    return 'sequential';
  }
  onStep(
    `One signature: ${txs.map((t) => t.description).join(', then ')}. Confirm in your wallet…`,
  );
  const { id } = await c.wallet.sendCalls({
    account: c.account,
    chain: c.chain,
    calls: txs.map((t) => ({ to: t.to, data: t.data })),
    forceAtomic: true,
  });
  onStep('Waiting for it to confirm…');
  // As with the last tx in order: EarnKit reads the outcome from the chain, so a status endpoint
  // that is slow or missing is not an error here; a failed batch still is.
  const status = await c.wallet
    .waitForCallsStatus({ id, timeout: 120_000 })
    .catch(() => null);
  if (status?.status === 'failure')
    throw new Error('The deposit failed onchain. Try again.');
  return 'batched';
}

export type CheckResult = {
  state?: string;
  campaign_url?: string;
  paid?: number;
  problem?: string;
  error?: string;
};

/**
 * Asks EarnKit to read the chain for this campaign every 3 seconds, for up to 2 minutes, until
 * `done` says so. Returns the last answer, or null if it never came.
 */
export async function pollCheck(
  ref: string,
  done: (r: CheckResult) => boolean,
): Promise<CheckResult | null> {
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    const r = (await fetch(`/api/sponsor/${ref}/check`, { method: 'POST' })
      .then((res) => res.json())
      .catch(() => ({}))) as CheckResult;
    if (done(r) || r.problem) return r;
    await new Promise((ok) => setTimeout(ok, 3_000));
  }
  return null;
}
