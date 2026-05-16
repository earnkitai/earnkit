// 0xSplits V2 (PullSplit) factory wiring for the Token-card buyback flow.
//
// Address + ABI sourced from the official deployments registry at
// https://github.com/0xSplits/splits-contracts-monorepo/blob/main/packages/splits-v2/deployments/8453.json
// (Base, chain id 8453). We use V2.2 — the latest stable release.

import {
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  parseAbi,
  parseEventLogs,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from 'viem';

export const BASE_PULL_SPLIT_FACTORY_V2_2 =
  '0x6B9118074aB15142d7524E8c4ea8f62A3Bdb98f1' as const;

// Splits V2 lib Split struct:
//   struct Split {
//     address[] recipients;
//     uint256[] allocations;
//     uint256 totalAllocation;
//     uint16 distributionIncentive;
//   }
//
// Factory ABI fragment we encode:
//   createSplit(Split splitParams, address owner, address creator)
//     returns (address split)
//
// Event we parse from the receipt:
//   SplitCreated(address indexed split, Split splitParams, address owner,
//                address creator, uint256 nonce)
export const SPLIT_FACTORY_V2_ABI = parseAbi([
  'struct Split { address[] recipients; uint256[] allocations; uint256 totalAllocation; uint16 distributionIncentive; }',
  'function createSplit(Split splitParams, address owner, address creator) returns (address split)',
  'event SplitCreated(address indexed split, Split splitParams, address owner, address creator, uint256 nonce)',
]);

// We use a 1e6 base for allocations (matches the 0xSplits app's own
// convention). totalAllocation must equal the sum of allocations exactly.
export const ALLOCATION_DENOMINATOR = BigInt(1_000_000);

export interface SplitRecipientInput {
  address: string;
  percent: number; // 0-100, two decimals supported (e.g. 33.33)
}

/** Convert a list of percentages to integer allocations summing to 1_000_000. */
export function percentsToAllocations(percents: number[]): bigint[] {
  if (percents.length === 0) {
    throw new Error('percentsToAllocations: at least one recipient required');
  }
  const sum = percents.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.001) {
    throw new Error(`Recipient percentages must sum to 100 (got ${sum.toFixed(4)})`);
  }
  // Allocate proportionally to 1e6, then absorb rounding drift into the last
  // recipient so the sum matches totalAllocation exactly.
  const raw = percents.map((p) => BigInt(Math.round(p * 10_000)));
  const drift = ALLOCATION_DENOMINATOR - raw.reduce((a, b) => a + b, BigInt(0));
  raw[raw.length - 1] = raw[raw.length - 1] + drift;
  return raw;
}

export interface BuildCreateSplitCalldataArgs {
  recipients: SplitRecipientInput[];
  owner: string; // user's wallet
  creator?: string; // defaults to owner
  // Optional distributor reward (max ~6.5%). Default 0 — we distribute
  // ourselves via the buyback worker, no reward needed.
  distributionIncentive?: number;
}

export interface BuildCreateSplitCalldataResult {
  to: `0x${string}`;
  data: Hex;
  // For debugging / verification
  recipients: `0x${string}`[];
  allocations: bigint[];
  totalAllocation: bigint;
  owner: `0x${string}`;
}

export function buildCreateSplitCalldata(
  args: BuildCreateSplitCalldataArgs,
): BuildCreateSplitCalldataResult {
  if (args.recipients.length < 2) {
    throw new Error('A split needs at least two recipients');
  }
  const recipients = args.recipients.map((r) => getAddress(r.address) as `0x${string}`);
  const allocations = percentsToAllocations(args.recipients.map((r) => r.percent));
  const owner = getAddress(args.owner) as `0x${string}`;
  const creator = getAddress(args.creator ?? args.owner) as `0x${string}`;
  const distributionIncentive = args.distributionIncentive ?? 0;

  const data = encodeFunctionData({
    abi: SPLIT_FACTORY_V2_ABI,
    functionName: 'createSplit',
    args: [
      {
        recipients,
        allocations,
        totalAllocation: ALLOCATION_DENOMINATOR,
        distributionIncentive,
      },
      owner,
      creator,
    ],
  });

  return {
    to: BASE_PULL_SPLIT_FACTORY_V2_2,
    data,
    recipients,
    allocations,
    totalAllocation: ALLOCATION_DENOMINATOR,
    owner,
  };
}

// PullSplit V2 contract ABI for the actual deployed split. `distribute` is
// permissionless — anyone (including the user from EarnKit) can call it to
// flush accumulated balances to the SplitsWarehouse keyed by recipient.
// The Split struct passed in MUST match the original deploy params (the
// contract verifies the hash); see getSplitParamsFromFactory below.
export const PULL_SPLIT_ABI = parseAbi([
  'struct Split { address[] recipients; uint256[] allocations; uint256 totalAllocation; uint16 distributionIncentive; }',
  'function distribute(Split _split, address _token, address _distributor)',
]);

// 0xSplits sentinel for native ETH (matches splitsWarehouse on backend).
export const SPLITS_NATIVE_TOKEN =
  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const;

export interface SplitParams {
  recipients: `0x${string}`[];
  allocations: bigint[];
  totalAllocation: bigint;
  distributionIncentive: number;
}

// Most public Base RPCs cap getLogs to ~10k blocks per request. The split's
// SplitCreated event is at deploy time which is usually recent — scan
// backward in chunks from the tip until we find it. Mirrors splitReader.ts
// on the backend.
const LOG_SCAN_CHUNK_BLOCKS = BigInt(9_500);
const LOG_SCAN_MAX_CHUNKS = 40; // ~9 days on Base

/**
 * Look up the original `createSplit` params (recipients, allocations, etc.)
 * for a deployed PullSplit V2.2 by scanning the factory's `SplitCreated`
 * event log. Filters by the indexed `split` topic so even with many factory
 * events the call is cheap on a single split. Returns null if the split
 * wasn't deployed by this factory or we couldn't find the event in range.
 */
export async function getSplitParamsFromFactory(
  splitAddress: string,
  publicClient: PublicClient,
): Promise<SplitParams | null> {
  const target = getAddress(splitAddress) as `0x${string}`;
  let toBlock: bigint;
  try {
    toBlock = await publicClient.getBlockNumber();
  } catch {
    return null;
  }

  for (let i = 0; i < LOG_SCAN_MAX_CHUNKS; i++) {
    const fromBlock =
      toBlock > LOG_SCAN_CHUNK_BLOCKS
        ? toBlock - LOG_SCAN_CHUNK_BLOCKS
        : BigInt(0);
    try {
      const rawLogs = await publicClient.getLogs({
        address: BASE_PULL_SPLIT_FACTORY_V2_2,
        fromBlock,
        toBlock,
      });
      // Decode + filter by indexed `split` topic in one pass. We can't
      // pass `event` to getLogs above because the inferred ABI loses arg
      // type info; parseEventLogs handles that cleanly.
      const decoded = parseEventLogs({
        abi: SPLIT_FACTORY_V2_ABI,
        eventName: 'SplitCreated',
        logs: rawLogs,
      }).filter((l) => getAddress(l.args.split) === getAddress(target));
      if (decoded.length > 0) {
        const args = decoded[decoded.length - 1].args;
        return {
          recipients: args.splitParams.recipients.map(
            (r) => getAddress(r) as `0x${string}`,
          ),
          allocations: args.splitParams.allocations.map((a) => BigInt(a)),
          totalAllocation: BigInt(args.splitParams.totalAllocation),
          distributionIncentive: Number(args.splitParams.distributionIncentive),
        };
      }
    } catch {
      /* RPC error — try next chunk */
    }
    if (fromBlock === BigInt(0)) break;
    toBlock = fromBlock - BigInt(1);
  }
  return null;
}

export interface BuildDistributeCalldataArgs {
  splitParams: SplitParams;
  splitAddress: string;
  /** Token sitting on the split. Use SPLITS_NATIVE_TOKEN for ETH. */
  token: string;
  /** Address that receives the distributor incentive (msg.sender by default). */
  distributor: string;
}

/**
 * Encode `distribute(splitParams, token, distributor)` for a PullSplit V2.2.
 * Anyone can call this — the call moves all of `token` sitting on the split
 * into the SplitsWarehouse credited per-recipient.
 */
export function buildDistributeCalldata(args: BuildDistributeCalldataArgs): {
  to: `0x${string}`;
  data: Hex;
} {
  const data = encodeFunctionData({
    abi: PULL_SPLIT_ABI,
    functionName: 'distribute',
    args: [
      {
        recipients: args.splitParams.recipients,
        allocations: args.splitParams.allocations,
        totalAllocation: args.splitParams.totalAllocation,
        distributionIncentive: args.splitParams.distributionIncentive,
      },
      getAddress(args.token) as `0x${string}`,
      getAddress(args.distributor) as `0x${string}`,
    ],
  });
  return { to: getAddress(args.splitAddress) as `0x${string}`, data };
}

/**
 * Wait for a tx receipt and throw if it reverted. `waitForTransactionReceipt`
 * returns `{ status: 'reverted' | 'success' }` instead of throwing on revert,
 * so the caller's success path runs even when the tx was mined-and-reverted.
 * Use this everywhere we follow a sendTransaction with a "success" toast.
 */
// PublicClient typed loosely — chain-specific viem clients (e.g. one built
// with `chain: base`) don't unify cleanly with the bare `PublicClient`
// generic. Both shapes have the same `waitForTransactionReceipt` method, so
// `any` here is the smallest cost vs adding chain generics everywhere.
export async function waitForSuccessReceipt(
  publicClient: {
    waitForTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<{
      status: 'success' | 'reverted';
    }>;
  },
  hash: `0x${string}`,
) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error('Transaction reverted on-chain');
  }
  return receipt;
}

// SplitsWarehouse — the central balance store for V2 pull splits. After a
// `distribute(...)` call on a split contract, each recipient's share lives
// here keyed by (recipient, token). To get funds out, the recipient calls
// `withdraw(owner=recipient, token)`. Anyone can call withdraw for any owner;
// the funds always go to the owner's address.
export const SPLITS_WAREHOUSE_ADDRESS =
  '0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8' as const;

export const SPLITS_WAREHOUSE_ABI = parseAbi([
  'function withdraw(address owner, address token)',
  'function balanceOf(address owner, uint256 id) view returns (uint256 balance)',
]);

/**
 * Read the user's claimable balance from the SplitsWarehouse for a token.
 * The warehouse stores balances keyed by `uint256(token)`. ETH uses the
 * sentinel `0xEeee…`.
 */
export async function readWarehouseBalance(args: {
  owner: `0x${string}`;
  token: `0x${string}` | typeof SPLITS_NATIVE_TOKEN;
  publicClient: PublicClient;
}): Promise<bigint> {
  try {
    return (await args.publicClient.readContract({
      address: SPLITS_WAREHOUSE_ADDRESS,
      abi: SPLITS_WAREHOUSE_ABI,
      functionName: 'balanceOf',
      args: [args.owner, BigInt(args.token)],
    })) as bigint;
  } catch {
    return BigInt(0);
  }
}

/**
 * Encode `warehouse.withdraw(owner, token)` calldata. The user signs and
 * sends this from their wallet to pull their own share out of the warehouse
 * after a distribute call has credited them.
 */
export function buildWarehouseWithdrawCalldata(args: {
  owner: `0x${string}`;
  token: `0x${string}` | typeof SPLITS_NATIVE_TOKEN;
}): { to: `0x${string}`; data: Hex } {
  const data = encodeFunctionData({
    abi: SPLITS_WAREHOUSE_ABI,
    functionName: 'withdraw',
    args: [args.owner, args.token],
  });
  return { to: SPLITS_WAREHOUSE_ADDRESS, data };
}

// Canonical Multicall3 deployed at the same address on every major chain,
// including Base. We use `aggregate3` to bundle N `distribute` calls into
// a single tx so the user gets one MetaMask popup regardless of how many
// tokens are sitting on the split.
export const MULTICALL3_ADDRESS =
  '0xcA11bde05977b3631167028862bE2a173976CA11' as const;

export const MULTICALL3_ABI = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
]);

/**
 * Bundle a distribute() call per token into a single Multicall3 aggregate3.
 * PullSplit's `distribute(...)` is permissionless and doesn't read
 * msg.sender beyond what the user explicitly passes as `distributor`, so
 * batching via Multicall3 is safe — each inner call still credits the
 * supplied distributor (not Multicall3 itself).
 *
 * `allowFailure: false` per call — if any single token's distribute reverts
 * (e.g. the split's hash doesn't match), the whole batch reverts. That's
 * deliberate: a partial distribute is hard to reason about.
 */
export function buildDistributeAllCalldata(args: {
  splitParams: SplitParams;
  splitAddress: string;
  tokens: string[];
  distributor: string;
}): { to: `0x${string}`; data: Hex } {
  if (args.tokens.length === 0) {
    throw new Error('buildDistributeAllCalldata: tokens is empty');
  }
  const splitAddress = getAddress(args.splitAddress) as `0x${string}`;
  const calls = args.tokens.map((token) => ({
    target: splitAddress,
    allowFailure: false,
    callData: buildDistributeCalldata({
      splitParams: args.splitParams,
      splitAddress: args.splitAddress,
      token,
      distributor: args.distributor,
    }).data,
  }));
  const data = encodeFunctionData({
    abi: MULTICALL3_ABI,
    functionName: 'aggregate3',
    args: [calls],
  });
  return { to: MULTICALL3_ADDRESS, data };
}

/**
 * Read native ETH + ERC-20 balances sitting on a split contract address.
 * These are funds that haven't been distributed yet — a successful
 * `distribute` call moves them into the SplitsWarehouse keyed per recipient.
 */
export async function readSplitContractBalances(args: {
  splitAddress: string;
  tokens: { address: `0x${string}`; symbol: string; decimals: number }[];
  publicClient: PublicClient;
}): Promise<
  Array<{
    token: `0x${string}` | typeof SPLITS_NATIVE_TOKEN;
    symbol: string;
    decimals: number;
    balance: bigint;
  }>
> {
  const split = getAddress(args.splitAddress) as `0x${string}`;
  const results: Array<{
    token: `0x${string}` | typeof SPLITS_NATIVE_TOKEN;
    symbol: string;
    decimals: number;
    balance: bigint;
  }> = [];

  // Native ETH
  try {
    const eth = await args.publicClient.getBalance({ address: split });
    results.push({
      token: SPLITS_NATIVE_TOKEN,
      symbol: 'ETH',
      decimals: 18,
      balance: eth,
    });
  } catch {
    /* skip */
  }

  // ERC-20s — one call per token, parallelized
  const erc20s = await Promise.all(
    args.tokens.map(async (t) => {
      try {
        const bal = (await args.publicClient.readContract({
          address: t.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [split],
        })) as bigint;
        return {
          token: t.address,
          symbol: t.symbol,
          decimals: t.decimals,
          balance: bal,
        };
      } catch {
        return null;
      }
    }),
  );
  for (const r of erc20s) if (r) results.push(r);

  return results;
}

/**
 * Parse the deployed split's address from a `createSplit` tx receipt.
 * Throws if the receipt doesn't include a SplitCreated event from our factory.
 */
export function parseSplitCreatedFromReceipt(
  receipt: TransactionReceipt,
): `0x${string}` {
  // Filter to logs from our factory first — there can be other unrelated
  // events in the same tx if the user batched.
  const factory = getAddress(BASE_PULL_SPLIT_FACTORY_V2_2);
  const factoryLogs = receipt.logs.filter(
    (l) => getAddress(l.address) === factory,
  );

  // viem's parseEventLogs handles indexed/non-indexed decoding for us.
  const events = parseEventLogs({
    abi: SPLIT_FACTORY_V2_ABI,
    eventName: 'SplitCreated',
    logs: factoryLogs,
  });

  const first = events[0];
  if (!first) {
    // Fall back to manual decode in case parseEventLogs missed something
    // (different SDK versions, etc.)
    for (const log of factoryLogs) {
      try {
        const decoded = decodeEventLog({
          abi: SPLIT_FACTORY_V2_ABI,
          eventName: 'SplitCreated',
          data: log.data,
          topics: log.topics,
        });
        const split = (decoded.args as { split: `0x${string}` }).split;
        if (split) return getAddress(split) as `0x${string}`;
      } catch {
        /* try next */
      }
    }
    throw new Error('SplitCreated event not found in receipt');
  }
  return getAddress(first.args.split) as `0x${string}`;
}
