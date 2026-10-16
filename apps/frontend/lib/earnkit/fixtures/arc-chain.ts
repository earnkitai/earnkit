import type { DeployChain } from '../deploy';

/**
 * The deployer's chain (Arc) as the starter build sees it: one creation at ARC_CONTRACT; owner()
 * reads the constructor's owner, the builder (moved from v211-journey.test.ts, v2.13 F19). `sends`,
 * when given, records each creation's calldata.
 */
export const ARC_CONTRACT = '0x00000000000000000000000000000000000a11ce';
export function fakeArc(owner: () => string, sends?: string[]): DeployChain {
  return {
    estimate: async () => ({ gas: 900_000n, maxFeePerGas: 20_000_000_000n }),
    simulate: async () => `0x${'60'.repeat(60)}`,
    nonce: async () => 1,
    balance: async () => 5n * 10n ** 18n,
    send: async (a) => (sends?.push(a.data), `0x${'ab'.repeat(32)}`),
    receipt: async () => ({ status: 'success', contractAddress: ARC_CONTRACT, gasUsed: 800_000n, effectiveGasPrice: 20_000_000_000n, blockNumber: 4242n }),
    code: async () => `0x${'60'.repeat(60)}`,
    read: async (a) => (a.fn === 'owner' ? owner() : null),
    write: async () => `0x${'ef'.repeat(32)}`,
  } as DeployChain;
}
/** arc-tipjar's constructor and owner(), as the build's deploy call sends them. */
export const TIPJAR_ABI = [
  { type: 'constructor', inputs: [{ name: 'owner_', type: 'address' }, { name: 'name_', type: 'string' }, { name: 'minTip_', type: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'owner', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
];
