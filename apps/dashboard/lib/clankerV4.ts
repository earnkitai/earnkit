// Clanker v4 (Uniswap v4 hook + per-token LpLocker) integration for the
// "update reward recipient from EarnKit" affordance on /create.
//
// Architecture:
//   Clanker factory deploys a ClankerToken + a Uniswap v4 hook + a per-token
//   ClankerLpLockerFeeConversion. The locker stores up to 7 (admin, recipient,
//   bps) tuples. Recipients/admins are mutable; bps is fixed at deploy. Each
//   index's `updateRewardRecipient` call is auth-gated to the index's admin.
//
// Facts sourced from:
//   - Clanker docs (clanker.gitbook.io/clanker-documentation/.../v4/fee-management-contracts)
//   - BaseScan: factory at 0xe85a59c6... (verified, source visible)

import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  type Hex,
  type PublicClient,
} from 'viem';
import { base } from 'viem/chains';

export const CLANKER_V4_FACTORY =
  '0xe85a59c628f7d27878aceb4bf3b35733630083a9' as const;

export const CLANKER_V4_FACTORY_ABI = parseAbi([
  'function deploymentInfoForToken(address token) view returns (address token_, address hook, address locker)',
]);

export const CLANKER_V4_LOCKER_ABI = parseAbi([
  'function updateRewardRecipient(address token, uint256 rewardIndex, address newRecipient)',
  'function updateRewardAdmin(address token, uint256 rewardIndex, address newAdmin)',
]);

export interface ClankerV4Deployment {
  hook: `0x${string}`;
  locker: `0x${string}`;
}

/**
 * Look up the hook + locker for a deployed Clanker v4 token. Returns null if
 * the token wasn't deployed by Clanker v4 (factory call reverts or returns
 * zero addresses) — caller should fall back to generic instructions.
 */
export async function getClankerV4Deployment(
  token: string,
  client?: PublicClient,
): Promise<ClankerV4Deployment | null> {
  const publicClient =
    client ?? createPublicClient({ chain: base, transport: http() });

  try {
    const result = (await publicClient.readContract({
      address: CLANKER_V4_FACTORY,
      abi: CLANKER_V4_FACTORY_ABI,
      functionName: 'deploymentInfoForToken',
      args: [getAddress(token) as `0x${string}`],
    })) as readonly [`0x${string}`, `0x${string}`, `0x${string}`];

    const [, hook, locker] = result;
    const ZERO = '0x0000000000000000000000000000000000000000';
    if (locker.toLowerCase() === ZERO || hook.toLowerCase() === ZERO) {
      return null;
    }
    return {
      hook: getAddress(hook) as `0x${string}`,
      locker: getAddress(locker) as `0x${string}`,
    };
  } catch {
    // Token not deployed by Clanker v4 — the call reverts.
    return null;
  }
}

export interface BuildUpdateRecipientCalldataArgs {
  /** The Clanker token contract address (the fee-source token). */
  token: string;
  /** 0..6 — the reward slot. The caller's wallet must be that slot's admin. */
  rewardIndex: number;
  /** New recipient address — for our flow, this is the deployed split. */
  newRecipient: string;
}

export interface BuildUpdateRecipientCalldataResult {
  /** The per-token locker contract — the `to` of the user's tx. */
  to: `0x${string}`;
  data: Hex;
}

/**
 * Encode `updateRewardRecipient(token, rewardIndex, newRecipient)` for the
 * per-token locker. Caller is responsible for first finding the locker via
 * `getClankerV4Deployment`.
 */
export function buildUpdateRecipientCalldata(
  args: BuildUpdateRecipientCalldataArgs & { locker: string },
): BuildUpdateRecipientCalldataResult {
  if (args.rewardIndex < 0 || args.rewardIndex > 6) {
    throw new Error('rewardIndex must be in [0, 6]');
  }
  const data = encodeFunctionData({
    abi: CLANKER_V4_LOCKER_ABI,
    functionName: 'updateRewardRecipient',
    args: [
      getAddress(args.token) as `0x${string}`,
      BigInt(args.rewardIndex),
      getAddress(args.newRecipient) as `0x${string}`,
    ],
  });
  return { to: getAddress(args.locker) as `0x${string}`, data };
}
