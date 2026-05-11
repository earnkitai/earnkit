import { parseAbi } from 'viem';
import {
  getBasePublicClient,
  readWarehouseBalance,
  SPLIT_NATIVE_TOKEN_ADDRESS,
  type BasePublicClient,
} from './splitsWarehouse';
import { SUPPORTED_TOKENS } from '../services/tokenService';

// 0xSplits V2 pull-split — returns a struct with separate recipient/allocation arrays
const SPLIT_V2_STRUCT_ABI = parseAbi([
  'function getSplit() external view returns ((address[] recipients, uint256[] allocations, uint256 totalAllocation, uint16 distributionIncentive) split_)',
]);

// 0xSplits V2 original — returns a tuple-array of (recipient, allocation) pairs
const SPLIT_V2_TUPLE_ABI = parseAbi([
  'function getSplit() external view returns ((address recipient, uint256 allocation)[] receivers, uint256 distributionIncentive)',
]);

// Fallback: some split variants expose recipients() separately
const SPLIT_RECIPIENTS_ABI = parseAbi([
  'function recipients() external view returns (address[])',
]);

/**
 * Check if a wallet is listed as a recipient in a 0xSplits V2 split contract.
 *
 * Tries multiple ABI variants in order (V2 struct → V2 tuple-array → recipients()
 * → warehouse balance). Each variant handles a different split deployment pattern.
 * Never throws — returns false on any unrecoverable error so the worker can retry
 * next cycle rather than crashing.
 */
export async function isWalletInSplit(
  splitAddress: `0x${string}`,
  walletAddress: `0x${string}`,
  client?: BasePublicClient,
): Promise<boolean> {
  const publicClient = client ?? getBasePublicClient();
  const walletLower = walletAddress.toLowerCase();

  // --- Attempt 1: 0xSplits V2 struct ABI (separate arrays) ---
  try {
    const result: any = await publicClient.readContract({
      address: splitAddress,
      abi: SPLIT_V2_STRUCT_ABI,
      functionName: 'getSplit',
    });
    const recipients: string[] = result?.recipients ?? result?.split_?.recipients ?? [];
    if (recipients.length > 0) {
      return recipients.some((r) => r.toLowerCase() === walletLower);
    }
  } catch { /* try next */ }

  // --- Attempt 2: 0xSplits V2 original tuple-array ABI ---
  try {
    const [receivers]: any = await publicClient.readContract({
      address: splitAddress,
      abi: SPLIT_V2_TUPLE_ABI,
      functionName: 'getSplit',
    });
    if (Array.isArray(receivers) && receivers.length > 0) {
      return receivers.some((r: any) => r.recipient?.toLowerCase() === walletLower);
    }
  } catch { /* try next */ }

  // --- Attempt 3: recipients() fallback (some push-split variants) ---
  try {
    const addrs: string[] = await publicClient.readContract({
      address: splitAddress,
      abi: SPLIT_RECIPIENTS_ABI,
      functionName: 'recipients',
    }) as string[];
    if (Array.isArray(addrs) && addrs.length > 0) {
      return addrs.some((r) => r.toLowerCase() === walletLower);
    }
  } catch { /* try next */ }

  // --- Attempt 4: warehouse balance ---
  // If the wallet has any balance in the SplitsWarehouse it was a recipient at
  // least once. Used as a last resort when on-chain ABI calls all fail — this
  // handles push splits and other variants that store state off-contract.
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
