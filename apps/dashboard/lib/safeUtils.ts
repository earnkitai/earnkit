// Safe Transaction Service helpers for the Safe buyback flow.
// Uses the Safe Transaction Service REST API directly — no Safe SDK dependency.
// Signing uses viem EIP-712 (signTypedData) so the Safe contract can verify
// the proposer is an owner.

import {
  createWalletClient,
  custom,
  getAddress,
  hashTypedData,
  type Hex,
} from 'viem';
import { base } from 'viem/chains';
import type { ConnectedWallet } from '@privy-io/react-auth';

const SAFE_TX_SERVICE = '/api/safe-tx';

const SAFE_TX_TYPES = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/**
 * Propose a transaction to the Safe via the Safe Transaction Service.
 * The connected wallet (a Safe owner) signs the EIP-712 SafeTx hash and
 * posts it so other owners can approve and execute in the Safe UI.
 * Returns the contractTransactionHash (Safe's internal tx identifier).
 */
export async function proposeSafeTransaction(args: {
  safeAddress: string;
  to: string;
  data: Hex;
  wallet: ConnectedWallet;
}): Promise<{ contractTransactionHash: Hex }> {
  const safeAddress = getAddress(args.safeAddress) as `0x${string}`;
  const to = getAddress(args.to) as `0x${string}`;

  const safeInfo = await fetch(
    `${SAFE_TX_SERVICE}/safes/${safeAddress}/`,
  ).then((r) => {
    if (!r.ok) throw new Error(`Safe not found on Base (${r.status}) — is this a Base mainnet Safe?`);
    return r.json();
  });
  const nonce: number = safeInfo.nonce;

  const domain = { chainId: base.id, verifyingContract: safeAddress };
  const message = {
    to,
    value: BigInt(0),
    data: args.data,
    operation: 0,
    safeTxGas: BigInt(0),
    baseGas: BigInt(0),
    gasPrice: BigInt(0),
    gasToken: ZERO_ADDRESS as `0x${string}`,
    refundReceiver: ZERO_ADDRESS as `0x${string}`,
    nonce: BigInt(nonce),
  };

  const contractTransactionHash = hashTypedData({
    domain,
    types: SAFE_TX_TYPES,
    primaryType: 'SafeTx',
    message,
  });

  await args.wallet.switchChain(base.id).catch(() => {});
  const provider = await args.wallet.getEthereumProvider();
  const walletClient = createWalletClient({
    account: args.wallet.address as Hex,
    chain: base,
    transport: custom(provider),
  });

  const signature = await walletClient.signTypedData({
    domain,
    types: SAFE_TX_TYPES,
    primaryType: 'SafeTx',
    message,
  });

  const res = await fetch(
    `${SAFE_TX_SERVICE}/safes/${safeAddress}/multisig-transactions/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,
        value: '0',
        data: args.data,
        operation: 0,
        safeTxGas: '0',
        baseGas: '0',
        gasPrice: '0',
        gasToken: ZERO_ADDRESS,
        refundReceiver: ZERO_ADDRESS,
        nonce,
        contractTransactionHash,
        sender: getAddress(args.wallet.address),
        signature,
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text().catch(() => String(res.status));
    throw new Error(`Safe proposal failed: ${err}`);
  }

  return { contractTransactionHash };
}

/**
 * Fetch execution status of a previously proposed Safe transaction.
 * Returns { isExecuted, transactionHash } — transactionHash is null until executed.
 */
export async function getSafeTxExecution(safeTxHash: string): Promise<{
  isExecuted: boolean;
  transactionHash: string | null;
}> {
  const res = await fetch(
    `${SAFE_TX_SERVICE}/multisig-transactions/${safeTxHash}/`,
  );
  if (!res.ok) throw new Error(`Failed to fetch Safe tx status (${res.status})`);
  const data = await res.json();
  return {
    isExecuted: !!data.isExecuted,
    transactionHash: data.transactionHash ?? null,
  };
}
