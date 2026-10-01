'use client';

import { createWalletClient, custom, publicActions, type Chain } from 'viem';
import { base, baseSepolia, foundry } from 'viem/chains';
import type { RawTx } from '@/lib/earnkit/escrow';

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown[] }): Promise<unknown>;
    };
  }
}

const CHAINS: Record<number, Chain> = {
  8453: base,
  84532: baseSepolia,
  31337: foundry,
};

/** Connects the browser wallet, switches chain, sends each tx in order, waits for each. */
export async function sendAll(
  txs: RawTx[],
  onStep: (msg: string) => void,
): Promise<`0x${string}`> {
  if (!window.ethereum)
    throw new Error(
      'No browser wallet found. Install MetaMask, Coinbase Wallet, or Rabby.',
    );
  const chain = CHAINS[txs[0].chain_id];
  const wallet = createWalletClient({
    chain,
    transport: custom(window.ethereum),
  }).extend(publicActions);
  const [account] = await wallet.requestAddresses();
  if ((await wallet.getChainId()) !== chain.id) {
    onStep(`Switching your wallet to ${chain.name}…`);
    await wallet.switchChain({ id: chain.id }).catch(async () => {
      await wallet.addChain({ chain });
      await wallet.switchChain({ id: chain.id });
    });
  }
  let last: `0x${string}` = '0x';
  for (const [i, tx] of txs.entries()) {
    onStep(
      `Step ${i + 1} of ${txs.length}: ${tx.description}. Confirm in your wallet…`,
    );
    last = await wallet.sendTransaction({
      account,
      to: tx.to,
      data: tx.data,
      chain,
    });
    onStep(`Waiting for step ${i + 1} to confirm…`);
    const r = await wallet.waitForTransactionReceipt({ hash: last });
    if (r.status !== 'success')
      throw new Error(`Step ${i + 1} failed onchain (${last}).`);
  }
  return last;
}
