// Clanker v3 (pre-Uniswap-v4) integration. v3 uses a single per-version
// LpLockerv2 contract that holds the LP NFTs for every token launched under
// that version. Reward recipients/admins are keyed by the LP NFT tokenId,
// not by token-contract address.
//
// Architecture (per Clanker docs + BaseScan verification on 0x33e2…c8f9):
//
//   LpLockerv2 storage:
//     mapping(uint256 tokenId => TokenRewardInfo)
//     mapping(address creator => uint256[] lpTokenIds)  // via getLpTokenIdsForCreator
//
//   TokenRewardInfo = {
//     uint256 lpTokenId,
//     uint256 creatorReward,
//     RewardRecipient creator,      // (admin, recipient)
//     RewardRecipient interfacer,   // (admin, recipient)
//   }
//
//   Setters (callable by the corresponding admin):
//     updateCreatorRewardRecipient(uint256 tokenId, address newRecipient)
//     updateInterfaceRewardRecipient(uint256 tokenId, address newRecipient)
//
// Discovery:
//   - We don't have a direct token→tokenId mapping; instead `getLpTokenIdsForCreator(user)`
//     returns every LP NFT the user is recorded as creator of. We probe both
//     deployed v3.0 and v3.1 lockers in parallel.
//
// Sources verified:
//   - Clanker docs: clanker.gitbook.io/clanker-documentation/references/deployed-contracts
//   - BaseScan ABI: 0x33e2Eda238edcF470309b8c6D228986A1204c8f9 (verified)

import {
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Hex,
  type PublicClient,
} from 'viem';

export interface ClankerV3LockerDeployment {
  version: 'v3.0' | 'v3.1';
  address: `0x${string}`;
}

export const CLANKER_V3_LOCKERS: ClankerV3LockerDeployment[] = [
  // v3.1.0 — most active
  { version: 'v3.1', address: '0x33e2Eda238edcF470309b8c6D228986A1204c8f9' },
  // v3.0.0
  { version: 'v3.0', address: '0x5eC4f99F342038c67a312a166Ff56e6D70383D86' },
];

// `tokenRewards` is a Solidity `public mapping(uint256 => TokenRewardInfo)`,
// so the auto-generated getter returns the struct's fields as separate
// named returns (NOT a single struct). Declaring them inline as named
// multi-return values is the most defensive shape: viem decodes them into
// an object keyed by the names below, regardless of viem version quirks
// around `returns (StructName)` syntax. Nested tuples are still typed via
// `RewardRecipient` so `creator.admin` / `creator.recipient` decode cleanly.
export const CLANKER_V3_LOCKER_ABI = parseAbi([
  'struct RewardRecipient { address admin; address recipient; }',
  'function getLpTokenIdsForCreator(address user) view returns (uint256[])',
  'function tokenRewards(uint256 tokenId) view returns (uint256 lpTokenId, uint256 creatorReward, RewardRecipient creator, RewardRecipient interfacer)',
  'function updateCreatorRewardRecipient(uint256 tokenId, address newRecipient)',
  'function updateInterfaceRewardRecipient(uint256 tokenId, address newRecipient)',
]);

export interface ClankerV3Position {
  /** Which locker deployment the LP NFT lives in. */
  locker: ClankerV3LockerDeployment;
  /** Uniswap V3 LP NFT tokenId (the key into the locker's reward maps). */
  lpTokenId: bigint;
  /** Current creator (admin, recipient). Admin can rotate recipient. */
  creator: { admin: `0x${string}`; recipient: `0x${string}` };
  /** Current interfacer (admin, recipient). Usually the launchpad's address. */
  interfacer: { admin: `0x${string}`; recipient: `0x${string}` };
}

// Raw `tokenRewards` decode shape — viem returns named-multi-return values
// as an object. Local alias to keep callsites readable.
type TokenRewardsResult = {
  lpTokenId: bigint;
  creatorReward: bigint;
  creator: { admin: `0x${string}`; recipient: `0x${string}` };
  interfacer: { admin: `0x${string}`; recipient: `0x${string}` };
};

/**
 * Read one LP position from a specific locker. Returns null if the locker
 * has no entry for that tokenId (the call typically returns zero addresses
 * in that case — we treat the all-zero state as "missing" so the caller can
 * filter it out cleanly).
 */
export async function readClankerV3Position(args: {
  locker: ClankerV3LockerDeployment;
  lpTokenId: bigint;
  publicClient: PublicClient;
}): Promise<ClankerV3Position | null> {
  const ZERO = '0x0000000000000000000000000000000000000000' as const;
  try {
    const info = (await args.publicClient.readContract({
      address: args.locker.address,
      abi: CLANKER_V3_LOCKER_ABI,
      functionName: 'tokenRewards',
      args: [args.lpTokenId],
    })) as unknown as TokenRewardsResult;

    // All-zero admin AND recipient = no entry for this tokenId.
    if (
      info.creator.admin === ZERO &&
      info.creator.recipient === ZERO &&
      info.interfacer.admin === ZERO &&
      info.interfacer.recipient === ZERO
    ) {
      return null;
    }
    return {
      locker: args.locker,
      lpTokenId: args.lpTokenId,
      creator: {
        admin: getAddress(info.creator.admin) as `0x${string}`,
        recipient: getAddress(info.creator.recipient) as `0x${string}`,
      },
      interfacer: {
        admin: getAddress(info.interfacer.admin) as `0x${string}`,
        recipient: getAddress(info.interfacer.recipient) as `0x${string}`,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Probe a single tokenId across every known v3 locker. Useful as the manual
 * fallback when the connected wallet doesn't appear in any locker's
 * `getLpTokenIdsForCreator` mapping (e.g. they received admin via rotation
 * after the original creator launched).
 */
export async function probeClankerV3Position(args: {
  lpTokenId: bigint;
  publicClient: PublicClient;
}): Promise<ClankerV3Position | null> {
  for (const locker of CLANKER_V3_LOCKERS) {
    const position = await readClankerV3Position({
      locker,
      lpTokenId: args.lpTokenId,
      publicClient: args.publicClient,
    });
    if (position) return position;
  }
  return null;
}

/**
 * Discover every Clanker v3 LP position the user is recorded as creator of,
 * across both v3.0 and v3.1 lockers. For each tokenId, fetch the current
 * creator/interfacer admin+recipient pair so the UI can preview state.
 *
 * Returns an empty array if the user has no v3 positions (the most common
 * case — most Base creators are on v4 now).
 *
 * Known limitation: this discovery is keyed by the ORIGINAL creator in the
 * locker's `creatorTokenIds` mapping. If a user received admin rights via
 * `updateCreatorRewardAdmin` post-launch, their position won't surface here
 * — they need to enter the LP tokenId manually via `probeClankerV3Position`.
 */
export async function findClankerV3PositionsForCreator(args: {
  creator: string;
  publicClient: PublicClient;
}): Promise<ClankerV3Position[]> {
  const user = getAddress(args.creator) as `0x${string}`;
  const results: ClankerV3Position[] = [];

  for (const locker of CLANKER_V3_LOCKERS) {
    let ids: readonly bigint[];
    try {
      ids = (await args.publicClient.readContract({
        address: locker.address,
        abi: CLANKER_V3_LOCKER_ABI,
        functionName: 'getLpTokenIdsForCreator',
        args: [user],
      })) as readonly bigint[];
    } catch {
      // Locker not deployed or RPC failure — skip this version.
      continue;
    }
    if (ids.length === 0) continue;

    // Pull every position in parallel; failures (e.g. data corruption) drop out.
    const positions = await Promise.all(
      ids.map((id) =>
        readClankerV3Position({
          locker,
          lpTokenId: id,
          publicClient: args.publicClient,
        }),
      ),
    );
    for (const p of positions) if (p) results.push(p);
  }
  return results;
}

export interface BuildUpdateV3RecipientArgs {
  /** Which locker contract to call. */
  locker: ClankerV3LockerDeployment;
  /** The LP NFT tokenId. */
  lpTokenId: bigint;
  /** Whether to update the creator slot or the interfacer slot. */
  slot: 'creator' | 'interfacer';
  /** New recipient — for our flow, this is the deployed split address. */
  newRecipient: string;
}

/**
 * Encode the right setter for the v3 locker. Caller's wallet must be the
 * current admin of the chosen slot — the locker reverts otherwise.
 */
export function buildUpdateV3RecipientCalldata(
  args: BuildUpdateV3RecipientArgs,
): { to: `0x${string}`; data: Hex } {
  const fn =
    args.slot === 'creator'
      ? 'updateCreatorRewardRecipient'
      : 'updateInterfaceRewardRecipient';
  const data = encodeFunctionData({
    abi: CLANKER_V3_LOCKER_ABI,
    functionName: fn,
    args: [args.lpTokenId, getAddress(args.newRecipient) as `0x${string}`],
  });
  return { to: args.locker.address, data };
}
