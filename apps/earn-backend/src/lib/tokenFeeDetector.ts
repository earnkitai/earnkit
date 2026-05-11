import { getAddress, isAddress, parseAbi } from 'viem';
import { getBasePublicClient } from './splitsWarehouse';

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

// Common ownership getter selectors
const OWNER_GETTERS = ['owner', 'getOwner', 'admin', 'getAdmin'] as const;

export interface OwnershipResult {
  ownerAddress: `0x${string}` | null;
  // True when the owner address has deployed bytecode (multisig/Safe)
  ownerIsContract: boolean;
  // Null when we couldn't read the owner at all
  callerIsOwner: boolean | null;
}

export interface FeeRecipientDetectionResult {
  detected: boolean;
  getterName: GetterName | null;
  setterName: string | null;
  currentRecipient: `0x${string}` | null;
  instruction: string;
  ownership: OwnershipResult;
}

function deriveSetterName(getter: string): string {
  return `set${getter.charAt(0).toUpperCase()}${getter.slice(1)}`;
}

export async function checkContractOwner(
  tokenContractAddress: `0x${string}`,
  callerAddress?: `0x${string}`,
): Promise<OwnershipResult> {
  const client = getBasePublicClient();
  const ZERO = '0x0000000000000000000000000000000000000000';

  let ownerAddress: `0x${string}` | null = null;

  for (const getter of OWNER_GETTERS) {
    try {
      const abi = parseAbi([`function ${getter}() view returns (address)`]);
      const raw = await client.readContract({
        address: tokenContractAddress,
        abi,
        functionName: getter,
      }) as string;

      if (raw && raw.toLowerCase() !== ZERO && isAddress(raw)) {
        ownerAddress = getAddress(raw) as `0x${string}`;
        break;
      }
    } catch { /* try next */ }
  }

  if (!ownerAddress) {
    return { ownerAddress: null, ownerIsContract: false, callerIsOwner: null };
  }

  // Check if owner is a contract (multisig/Safe)
  let ownerIsContract = false;
  try {
    const code = await client.getBytecode({ address: ownerAddress });
    ownerIsContract = !!(code && code !== '0x');
  } catch { /* assume EOA */ }

  const callerIsOwner = callerAddress
    ? ownerAddress.toLowerCase() === callerAddress.toLowerCase()
    : null;

  return { ownerAddress, ownerIsContract, callerIsOwner };
}

/**
 * Detect fee recipient getter on the contract and check ownership.
 * Purely read-only — never writes to the contract.
 */
export async function detectFeeRecipient(
  tokenContractAddress: `0x${string}`,
  callerAddress?: `0x${string}`,
): Promise<FeeRecipientDetectionResult> {
  const client = getBasePublicClient();
  const ZERO = '0x0000000000000000000000000000000000000000';

  // Run fee detection + ownership in parallel
  const ownershipPromise = checkContractOwner(tokenContractAddress, callerAddress);

  for (const getter of FEE_RECIPIENT_GETTERS) {
    try {
      const abi = parseAbi([`function ${getter}() view returns (address)`]);
      const raw = await client.readContract({
        address: tokenContractAddress,
        abi,
        functionName: getter,
      }) as string;

      if (!raw || raw.toLowerCase() === ZERO) continue;

      const checksummed   = getAddress(raw) as `0x${string}`;
      const setterName    = deriveSetterName(getter);
      const ownership     = await ownershipPromise;

      return {
        detected:         true,
        getterName:       getter,
        setterName,
        currentRecipient: checksummed,
        instruction:      `Call \`${setterName}(<our_wallet>)\` on your token contract.`,
        ownership,
      };
    } catch { /* try next */ }
  }

  const ownership = await ownershipPromise;

  return {
    detected:         false,
    getterName:       null,
    setterName:       null,
    currentRecipient: null,
    instruction:      'This contract does not expose a standard fee recipient setter. Use Shared Buyback instead.',
    ownership,
  };
}
