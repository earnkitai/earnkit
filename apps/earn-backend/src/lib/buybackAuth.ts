import {
  getAddress,
  parseAbi,
  recoverMessageAddress,
  verifyMessage,
  type Hex,
} from 'viem';
import { getBasePublicClient } from './splitsWarehouse';

const SAFE_ABI = parseAbi(['function getOwners() view returns (address[])']);

const SIGNATURE_FRESHNESS_MS = 5 * 60 * 1000;

export class BuybackAuthError extends Error {
  constructor(public readonly reason: string, message?: string) {
    super(message ?? reason);
    this.name = 'BuybackAuthError';
  }
}

export type BuybackAction =
  // Splits card on /create — user provides an existing 0xSplits contract.
  | { kind: 'register'; splitAddress: `0x${string}`; tokenAddress: `0x${string}`; recoveryAddress: `0x${string}` }
  // Token card on /create — split is deployed AFTER registration (we need
  // the buyback wallet address baked into the split's recipients, which only
  // exists post-Turnkey-provisioning). splitAddress is attached later via
  // `set-split`. The signed message does NOT mention any split because the
  // user hasn't picked one yet — the message proves intent to register a
  // deferred-split buyback, no more.
  | { kind: 'register-deferred'; tokenAddress: `0x${string}`; recoveryAddress: `0x${string}` }
  // Attach a freshly-deployed split to a `register-deferred` config and
  // activate it on first balance.
  | { kind: 'set-split'; configId: string; splitAddress: `0x${string}` }
  | { kind: 'patch'; configId: string; thresholdUsd: number }
  | { kind: 'delete'; configId: string }
  | { kind: 'check'; configId: string }
  | { kind: 'check-activation'; configId: string };

// See docs/06_RELIABILITY_FIXES_2026_05_14.md §1 for the auth model.
// Keep this in sync with apps/dashboard/lib/buybackAuth.ts buildAuthMessage.
export function buildAuthMessage(args: {
  owner: `0x${string}`;
  signedAt: string;
  action: BuybackAction;
}): string {
  const lines: string[] = [
    'EarnKit Shared Buyback',
    `owner: ${args.owner}`,
    `signedAt: ${args.signedAt}`,
  ];
  switch (args.action.kind) {
    case 'register':
      lines.push(
        'action: register',
        `split: ${args.action.splitAddress}`,
        `token: ${args.action.tokenAddress}`,
        `recovery: ${args.action.recoveryAddress}`,
      );
      break;
    case 'register-deferred':
      lines.push(
        'action: register-deferred',
        `token: ${args.action.tokenAddress}`,
        `recovery: ${args.action.recoveryAddress}`,
      );
      break;
    case 'set-split':
      lines.push(
        'action: set-split',
        `config: ${args.action.configId}`,
        `split: ${args.action.splitAddress}`,
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

function assertFreshTimestamp(signedAt: string): void {
  const ts = Date.parse(signedAt);
  if (Number.isNaN(ts)) {
    throw new BuybackAuthError('invalid_signed_at', 'signedAt must be an ISO timestamp');
  }
  const delta = Math.abs(Date.now() - ts);
  if (delta > SIGNATURE_FRESHNESS_MS) {
    throw new BuybackAuthError('signature_expired', 'Signature is older than 5 minutes or skewed too far into the future');
  }
}

async function verifyOwnershipSignature(args: {
  expectedOwner: `0x${string}`;
  message: string;
  signature: Hex;
}): Promise<void> {
  const client = getBasePublicClient();

  // EOA recovery + EIP-1271 in one call.
  try {
    const ok = await verifyMessage({
      address: args.expectedOwner,
      message: args.message,
      signature: args.signature,
      // @ts-expect-error - viem accepts publicClient for EIP-1271 staticcall
      publicClient: client,
    });
    if (ok) return;
  } catch {
    // fall through to Safe-owner check
  }

  // Safe-owner fallback — see docs §1.
  let recovered: `0x${string}`;
  try {
    recovered = await recoverMessageAddress({ message: args.message, signature: args.signature });
  } catch {
    throw new BuybackAuthError('invalid_signature', 'Could not recover signer from signature');
  }

  if (getAddress(recovered) === getAddress(args.expectedOwner)) return;

  try {
    const owners = (await client.readContract({
      address: args.expectedOwner,
      abi: SAFE_ABI,
      functionName: 'getOwners',
    })) as readonly `0x${string}`[];
    const recoveredCs = getAddress(recovered);
    if (owners.some((o) => getAddress(o) === recoveredCs)) return;
  } catch {
    // Not a Safe (or RPC failed) — fall through to rejection
  }

  throw new BuybackAuthError(
    'signature_mismatch',
    'Signature does not prove control of ownerAddress',
  );
}

export async function requireBuybackAuth(args: {
  owner: `0x${string}`;
  action: BuybackAction;
  body: Record<string, unknown> | null | undefined;
}): Promise<void> {
  const body = args.body ?? {};
  const signature = body.signature;
  const signedAt = body.signedAt;

  if (typeof signature !== 'string' || !signature.startsWith('0x')) {
    throw new BuybackAuthError('missing_signature', 'signature is required (hex string)');
  }
  if (typeof signedAt !== 'string') {
    throw new BuybackAuthError('missing_signed_at', 'signedAt is required (ISO timestamp)');
  }

  assertFreshTimestamp(signedAt);

  const message = buildAuthMessage({ owner: args.owner, signedAt, action: args.action });
  await verifyOwnershipSignature({
    expectedOwner: args.owner,
    message,
    signature: signature as Hex,
  });
}
