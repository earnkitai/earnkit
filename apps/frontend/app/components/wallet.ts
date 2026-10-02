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

/**
 * Thrown by `sendAll` when the sequence doesn't complete. Carries every hash the wallet actually
 * returned (`sent`, in order), so a caller can tell a step that never reached the chain at all
 * from one whose outcome is merely unknown (e.g. the server's RPC node lagging the wallet's) —
 * see `decideRetry` in `lib/earnkit/send-retry.ts`, which turns this into a retry decision.
 */
export class SendAllError extends Error {
  /** Hashes submitted to the wallet so far, in order (`sendTransaction` resolved for each). */
  readonly sent: `0x${string}`[];
  /** `sent.at(-1)`, or `null` if nothing was submitted yet. */
  readonly lastHash: `0x${string}` | null;
  /**
   * Whether `lastHash`'s transaction is known, for a fact, to have reverted onchain. `false`
   * when its outcome is unknown (waiting for the receipt itself errored) rather than confirmed
   * failed — an unknown outcome must not be treated the same as a safe-to-retry revert.
   */
  readonly reverted: boolean;

  constructor(
    message: string,
    opts: { cause?: unknown; sent: `0x${string}`[]; reverted: boolean },
  ) {
    super(
      message,
      opts.cause !== undefined ? { cause: opts.cause } : undefined,
    );
    this.name = 'SendAllError';
    this.sent = opts.sent;
    this.lastHash = opts.sent.at(-1) ?? null;
    this.reverted = opts.reverted;
  }
}

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
  const sent: `0x${string}`[] = [];
  for (const [i, tx] of txs.entries()) {
    onStep(
      `Step ${i + 1} of ${txs.length}: ${tx.description}. Confirm in your wallet…`,
    );
    let hash: `0x${string}`;
    try {
      hash = await wallet.sendTransaction({
        account,
        to: tx.to,
        data: tx.data,
        chain,
      });
    } catch (err) {
      // Never reached the chain (e.g. the wallet rejected signing): `sent` doesn't grow.
      throw new SendAllError(`Step ${i + 1} could not be sent.`, {
        cause: err,
        sent,
        reverted: false,
      });
    }
    sent.push(hash);
    onStep(`Waiting for step ${i + 1} to confirm…`);
    // The tx was submitted, but if waiting for its receipt itself errors (e.g. the server's RPC
    // node lags the wallet's), its outcome couldn't be learned — it may yet land, so that must
    // not be treated the same as a confirmed, safe-to-retry revert.
    const receipt = await wallet
      .waitForTransactionReceipt({ hash })
      .catch((err) => {
        throw new SendAllError(
          `Step ${i + 1} was sent but couldn't be confirmed yet (${hash}).`,
          { cause: err, sent, reverted: false },
        );
      });
    if (receipt.status !== 'success')
      throw new SendAllError(`Step ${i + 1} failed onchain (${hash}).`, {
        sent,
        reverted: true,
      });
  }
  return sent[sent.length - 1];
}
