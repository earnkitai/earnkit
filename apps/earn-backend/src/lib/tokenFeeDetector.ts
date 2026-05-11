import { getAddress, parseAbi } from 'viem';
import { getBasePublicClient } from './splitsWarehouse';

// Ordered list of common fee recipient getter patterns seen across Base token contracts.
// We try each in order and stop at the first match.
const FEE_RECIPIENT_GETTERS = [
  'feeRecipient',
  'creatorAddress',
  'creator',
  'teamFeeRecipient',
  'treasury',
  'getFeeCollector',
  'protocolFeeRecipient',
  'feeTo',
  'receiver',
  'revenueRecipient',
  'feeCollector',
  'platformFeeRecipient',
] as const;

type GetterName = (typeof FEE_RECIPIENT_GETTERS)[number];

export interface FeeRecipientDetectionResult {
  detected: boolean;
  getterName: GetterName | null;
  // Inferred setter — prepend "set" + capitalise first char of getter.
  // e.g. "feeRecipient" → "setFeeRecipient". Not verified on-chain.
  setterName: string | null;
  currentRecipient: `0x${string}` | null;
  // Human-readable instruction for the dashboard
  instruction: string;
}

function deriveSetterName(getter: string): string {
  return `set${getter.charAt(0).toUpperCase()}${getter.slice(1)}`;
}

/**
 * Attempts to detect which fee recipient getter the contract exposes by trying
 * a set of well-known view function selectors. Purely read-only — never writes
 * to the contract or changes any state.
 *
 * Returns the first matching getter + its current value. If none match, returns
 * detected=false. Either way the caller should still provision the wallet and
 * show generic instructions.
 */
export async function detectFeeRecipient(
  tokenContractAddress: `0x${string}`,
): Promise<FeeRecipientDetectionResult> {
  const client = getBasePublicClient();
  const ZERO = '0x0000000000000000000000000000000000000000';

  for (const getter of FEE_RECIPIENT_GETTERS) {
    try {
      const abi = parseAbi([`function ${getter}() view returns (address)`]);
      const raw = await client.readContract({
        address: tokenContractAddress,
        abi,
        functionName: getter,
      });

      const addr = raw as string;
      if (!addr || addr.toLowerCase() === ZERO) continue;

      const checksummed = getAddress(addr) as `0x${string}`;
      const setterName = deriveSetterName(getter);

      return {
        detected: true,
        getterName: getter,
        setterName,
        currentRecipient: checksummed,
        instruction: `Call \`${setterName}(<our_wallet>)\` on your token contract to route fees to the buyback wallet.`,
      };
    } catch {
      // Function doesn't exist on this contract — try the next one.
    }
  }

  return {
    detected: false,
    getterName: null,
    setterName: null,
    currentRecipient: null,
    instruction:
      'Update the fee recipient address on your token contract to the provisioned buyback wallet. Refer to your contract documentation or deployer interface for the specific function.',
  };
}
