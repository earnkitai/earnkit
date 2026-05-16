import { parseAbiItem, parseAbi } from 'viem';
import {
  getBasePublicClient,
  readWarehouseBalance,
  SPLIT_NATIVE_TOKEN_ADDRESS,
  type BasePublicClient,
} from './splitsWarehouse';
import { SUPPORTED_TOKENS } from '../services/tokenService';

// 0xSplits V2 — recipients are stored in event logs, not on-chain state.
// The SplitUpdated event is emitted on initialize() and updateSplit().
const SPLIT_UPDATED_EVENT = parseAbiItem(
  'event SplitUpdated((address[] recipients, uint256[] allocations, uint256 totalAllocation, uint16 distributionIncentive) _split)',
);

// Legacy V2 ABI variants that have getSplit() (older factory deployments)
const SPLIT_V2_STRUCT_ABI = parseAbi([
  'function getSplit() external view returns ((address[] recipients, uint256[] allocations, uint256 totalAllocation, uint16 distributionIncentive) split_)',
]);
const SPLIT_V2_TUPLE_ABI = parseAbi([
  'function getSplit() external view returns ((address recipient, uint256 allocation)[] receivers, uint256 distributionIncentive)',
]);
const SPLIT_RECIPIENTS_ABI = parseAbi([
  'function recipients() external view returns (address[])',
]);

// Most public Base RPCs cap getLogs at 10k blocks. Scan in chunks from the
// chain tip backward so we don't miss the latest SplitUpdated event when the
// split was deployed long ago.
const LOG_SCAN_CHUNK_BLOCKS = BigInt(9_500);
const LOG_SCAN_MAX_CHUNKS = 40; // ~380k blocks (~9 days on Base) — adequate for
                                // recent activity; older splits will likely
                                // also have a getSplit() variant that works.

// Tri-state: true = in split, false = readable + absent, null = unknown.
// See docs/06_RELIABILITY_FIXES_2026_05_14.md §4.
export async function isWalletInSplit(
  splitAddress: `0x${string}`,
  walletAddress: `0x${string}`,
  client?: BasePublicClient,
): Promise<boolean | null> {
  const publicClient = client ?? getBasePublicClient();
  const walletLower = walletAddress.toLowerCase();

  let anyReadSucceeded = false;

  // --- Attempt 1: SplitUpdated event logs (canonical V2 approach) ---
  // Scan in chunks from the tip backward; the latest event has the current
  // recipients. We stop as soon as we find one.
  try {
    const tip = await publicClient.getBlockNumber();
    let toBlock = tip;
    for (let i = 0; i < LOG_SCAN_MAX_CHUNKS; i++) {
      const fromBlock = toBlock > LOG_SCAN_CHUNK_BLOCKS ? toBlock - LOG_SCAN_CHUNK_BLOCKS : BigInt(0);
      const logs = await publicClient.getLogs({
        address: splitAddress,
        event: SPLIT_UPDATED_EVENT,
        fromBlock,
        toBlock,
      });
      if (logs.length > 0) {
        anyReadSucceeded = true;
        const last = logs[logs.length - 1];
        const recipients: string[] = (last.args as { _split?: { recipients?: string[] } })._split?.recipients ?? [];
        if (recipients.length > 0) {
          return recipients.some((r) => r.toLowerCase() === walletLower);
        }
      }
      if (fromBlock === BigInt(0)) break;
      toBlock = fromBlock - BigInt(1);
    }
  } catch { /* RPC failure — try other strategies */ }

  // --- Attempt 2: getSplit() struct ABI (older V2 deployments) ---
  try {
    const result = await publicClient.readContract({
      address: splitAddress,
      abi: SPLIT_V2_STRUCT_ABI,
      functionName: 'getSplit',
    });
    const recipients: string[] = ((result as unknown as { recipients?: string[] })?.recipients ?? []) as string[];
    if (recipients.length > 0) {
      return recipients.some((r) => r.toLowerCase() === walletLower);
    }
    anyReadSucceeded = true; // returned, just empty
  } catch { /* try next */ }

  // --- Attempt 3: getSplit() tuple-array ABI ---
  try {
    const [receivers] = (await publicClient.readContract({
      address: splitAddress,
      abi: SPLIT_V2_TUPLE_ABI,
      functionName: 'getSplit',
    }) as unknown) as [Array<{ recipient: string }>];
    if (Array.isArray(receivers) && receivers.length > 0) {
      return receivers.some((r) => r.recipient?.toLowerCase() === walletLower);
    }
    anyReadSucceeded = true;
  } catch { /* try next */ }

  // --- Attempt 4: recipients() fallback ---
  try {
    const addrs = await publicClient.readContract({
      address: splitAddress,
      abi: SPLIT_RECIPIENTS_ABI,
      functionName: 'recipients',
    }) as string[];
    if (Array.isArray(addrs) && addrs.length > 0) {
      return addrs.some((r) => r.toLowerCase() === walletLower);
    }
    anyReadSucceeded = true;
  } catch { /* try next */ }

  // Attempt 5: warehouse balance — positive-only signal.
  try {
    if (await hasWarehouseBalance(walletAddress, publicClient)) {
      return true;
    }
  } catch { /* fall through */ }

  return anyReadSucceeded ? false : null;
}

async function hasWarehouseBalance(
  walletAddress: `0x${string}`,
  client: BasePublicClient,
): Promise<boolean> {
  const ethBal = await readWarehouseBalance({
    owner: walletAddress,
    token: SPLIT_NATIVE_TOKEN_ADDRESS,
    client,
  });
  if (ethBal > BigInt(0)) return true;

  for (const token of SUPPORTED_TOKENS) {
    const bal = await readWarehouseBalance({
      owner: walletAddress,
      token: token.address as `0x${string}`,
      client,
    });
    if (bal > BigInt(0)) return true;
  }
  return false;
}
