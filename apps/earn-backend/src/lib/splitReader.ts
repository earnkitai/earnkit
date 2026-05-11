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

/**
 * Check if a wallet is listed as a recipient in a 0xSplits V2 split contract.
 *
 * Strategy (in order):
 * 1. Query SplitUpdated event logs — the authoritative source for V2 contracts
 *    which store only a splitHash on-chain, not the full struct.
 * 2. getSplit() struct ABI — for older factory deployments that do expose it.
 * 3. getSplit() tuple-array ABI — alternative V2 layout.
 * 4. recipients() — some push-split variants.
 * 5. Warehouse balance — last resort for push splits with no readable state.
 */
export async function isWalletInSplit(
  splitAddress: `0x${string}`,
  walletAddress: `0x${string}`,
  client?: BasePublicClient,
): Promise<boolean> {
  const publicClient = client ?? getBasePublicClient();
  const walletLower = walletAddress.toLowerCase();

  // --- Attempt 1: SplitUpdated event logs (canonical V2 approach) ---
  try {
    const logs = await publicClient.getLogs({
      address: splitAddress,
      event: SPLIT_UPDATED_EVENT,
      fromBlock: BigInt(1),
      toBlock: 'latest',
    });
    if (logs.length > 0) {
      // Most recent event has the current recipients
      const last = logs[logs.length - 1];
      const recipients: string[] = (last.args as { _split?: { recipients?: string[] } })._split?.recipients ?? [];
      if (recipients.length > 0) {
        return recipients.some((r) => r.toLowerCase() === walletLower);
      }
    }
  } catch { /* try next */ }

  // --- Attempt 2: getSplit() struct ABI (older V2 deployments) ---
  try {
    const result = await publicClient.readContract({
      address: splitAddress,
      abi: SPLIT_V2_STRUCT_ABI,
      functionName: 'getSplit',
    }) as { recipients?: string[] } | undefined;
    const recipients: string[] = (result as { recipients?: string[] })?.recipients ?? [];
    if (recipients.length > 0) {
      return recipients.some((r) => r.toLowerCase() === walletLower);
    }
  } catch { /* try next */ }

  // --- Attempt 3: getSplit() tuple-array ABI ---
  try {
    const [receivers] = await publicClient.readContract({
      address: splitAddress,
      abi: SPLIT_V2_TUPLE_ABI,
      functionName: 'getSplit',
    }) as [Array<{ recipient: string }>];
    if (Array.isArray(receivers) && receivers.length > 0) {
      return receivers.some((r) => r.recipient?.toLowerCase() === walletLower);
    }
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
  } catch { /* try next */ }

  // --- Attempt 5: Warehouse balance (push splits, last resort) ---
  return hasWarehouseBalance(walletAddress, publicClient);
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
