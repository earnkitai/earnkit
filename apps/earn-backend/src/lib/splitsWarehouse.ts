import {
  createPublicClient,
  encodeFunctionData,
  http,
  type Abi,
} from 'viem';
import { base } from 'viem/chains';

// Canonical 0xSplits v2 SplitsWarehouse address (deterministic across chains).
// PullSplit deposits funds here; recipients call `withdraw` to release their balance.
export const SPLIT_WAREHOUSE_ADDRESS =
  '0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8' as const;

// Splits sentinel for native ETH inside the Warehouse.
export const SPLIT_NATIVE_TOKEN_ADDRESS =
  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const;

export const SPLIT_WAREHOUSE_ABI = [
  {
    type: 'function',
    name: 'withdraw',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const satisfies Abi;

// Inferred return type — exporting the concrete viem PublicClient type
// causes a generic-mismatch error against the chain-specific client in v2.30.
export function getBasePublicClient() {
  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  return createPublicClient({ chain: base, transport: http(rpcUrl) });
}

export type BasePublicClient = ReturnType<typeof getBasePublicClient>;

// Splits encodes Warehouse balance keys as `uint256(token)`. ETH uses the native sentinel.
function tokenIdFor(token: `0x${string}`): bigint {
  return BigInt(token);
}

export async function readWarehouseBalance({
  owner,
  token,
  client,
}: {
  owner: `0x${string}`;
  token: `0x${string}`;
  client?: BasePublicClient;
}): Promise<bigint> {
  const publicClient = client ?? getBasePublicClient();
  try {
    const balance = (await publicClient.readContract({
      address: SPLIT_WAREHOUSE_ADDRESS,
      abi: SPLIT_WAREHOUSE_ABI,
      functionName: 'balanceOf',
      args: [owner, tokenIdFor(token)],
    })) as bigint;
    return balance;
  } catch {
    return BigInt(0);
  }
}

export function encodeWarehouseWithdraw({
  owner,
  token,
}: {
  owner: `0x${string}`;
  token: `0x${string}`;
}): `0x${string}` {
  return encodeFunctionData({
    abi: SPLIT_WAREHOUSE_ABI,
    functionName: 'withdraw',
    args: [owner, token],
  });
}
