'use client';

import { useCallback, useEffect, useState } from 'react';
import { createWalletClient, custom, publicActions, type Chain } from 'viem';
import { base, baseSepolia, foundry } from 'viem/chains';
import type { RawTx } from '@/lib/earnkit/escrow';

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

/**
 * Sends each tx in order from `from` (the campaign's bound wallet). Every step but the last waits
 * for its receipt (createCampaign needs the approval mined); the last returns once submitted —
 * the page then polls EarnKit, which reads the outcome from the chain.
 */
export async function sendAll(
  txs: RawTx[],
  from: string,
  onStep: (msg: string) => void,
): Promise<void> {
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
    if (i === txs.length - 1) return;
    onStep(`Waiting for step ${i + 1} to confirm…`);
    const receipt = await wallet.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success')
      throw new Error(`Step ${i + 1} failed onchain. Try again.`);
  }
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
