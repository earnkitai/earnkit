// Mirror of apps/earn-backend/src/lib/buybackAuth.ts — keep in sync.
// See docs/06_RELIABILITY_FIXES_2026_05_14.md §1.

import { createWalletClient, custom, getAddress, type Hex } from 'viem';
import { base } from 'viem/chains';
import type { ConnectedWallet } from '@privy-io/react-auth';

// Server checksum-normalizes every address before rebuilding the message for
// verification (see apps/earn-backend/src/routes/tokenBuyback.ts). If the
// client signs with lowercase bytes, the message hash diverges and recovery
// returns a junk address → signature_mismatch. Normalize here so both sides
// agree on the canonical EIP-55 form.
const ck = (a: string) => getAddress(a);

export type BuybackAction =
  | { kind: 'register'; splitAddress: string; tokenAddress: string; recoveryAddress: string }
  // Token-card flow: provision the buyback wallet WITHOUT a split address.
  // The split is deployed client-side after we know the buyback wallet, then
  // attached with `set-split`. See apps/earn-backend/src/lib/buybackAuth.ts
  // for the matching server-side union.
  | { kind: 'register-deferred'; tokenAddress: string; recoveryAddress: string }
  | { kind: 'set-split'; configId: string; splitAddress: string }
  | { kind: 'patch'; configId: string; thresholdUsd: number }
  | { kind: 'delete'; configId: string }
  | { kind: 'check'; configId: string }
  | { kind: 'check-activation'; configId: string };

export function buildAuthMessage(args: {
  owner: string;
  signedAt: string;
  action: BuybackAction;
}): string {
  const lines: string[] = [
    'EarnKit Shared Buyback',
    `owner: ${ck(args.owner)}`,
    `signedAt: ${args.signedAt}`,
  ];
  switch (args.action.kind) {
    case 'register':
      lines.push(
        'action: register',
        `split: ${ck(args.action.splitAddress)}`,
        `token: ${ck(args.action.tokenAddress)}`,
        `recovery: ${ck(args.action.recoveryAddress)}`,
      );
      break;
    case 'register-deferred':
      lines.push(
        'action: register-deferred',
        `token: ${ck(args.action.tokenAddress)}`,
        `recovery: ${ck(args.action.recoveryAddress)}`,
      );
      break;
    case 'set-split':
      lines.push(
        'action: set-split',
        `config: ${args.action.configId}`,
        `split: ${ck(args.action.splitAddress)}`,
      );
      break;
    case 'patch':
      lines.push(
        'action: patch',
        `config: ${args.action.configId}`,
        `thresholdUsd: ${args.action.thresholdUsd}`,
      );
      break;
    case 'delete':
      lines.push('action: delete', `config: ${args.action.configId}`);
      break;
    case 'check':
      lines.push('action: check', `config: ${args.action.configId}`);
      break;
    case 'check-activation':
      lines.push('action: check-activation', `config: ${args.action.configId}`);
      break;
  }
  return lines.join('\n');
}

export async function signBuybackAction(args: {
  wallet: ConnectedWallet;
  owner: string;
  action: BuybackAction;
}): Promise<{ signature: Hex; signedAt: string }> {
  const signedAt = new Date().toISOString();
  const message = buildAuthMessage({ owner: args.owner, signedAt, action: args.action });

  // signMessage doesn't need a chain — switch is best-effort.
  await args.wallet.switchChain(base.id).catch(() => {});
  const provider = await args.wallet.getEthereumProvider();
  const walletClient = createWalletClient({
    account: args.wallet.address as Hex,
    chain: base,
    transport: custom(provider),
  });
  const signature = await walletClient.signMessage({ message });
  return { signature, signedAt };
}
