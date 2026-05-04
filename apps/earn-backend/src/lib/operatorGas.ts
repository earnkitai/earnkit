import { parseUnits, type TransactionSerializableEIP1559 } from 'viem';
import { base } from 'viem/chains';
import { getBasePublicClient } from './splitsWarehouse';
import { signTransaction } from '../services/turnkeyService';

/**
 * Operator gas wallet — drips a tiny amount of ETH to a buyback wallet right
 * before it executes, so users never need to fund their buyback wallets.
 *
 * Same security model as the buyback wallets themselves: the operator wallet
 * is a Turnkey-managed wallet inside a dedicated sub-org, with a two-stamper
 * policy that only permits "transfer ETH" calls (no contract data). The
 * Cloudflare Worker further restricts the destination to known buyback wallets
 * before co-signing — so even a Railway-only compromise cannot redirect the
 * gas wallet's funds to an attacker's address.
 *
 * Bounded loss: the operator wallet only ever holds whatever you fund it with
 * (suggested ~$5 ETH for thousands of drips on Base). It is not the user's
 * money — it is the platform's gas budget.
 */

interface OperatorEnv {
  subOrgId: string;
  walletAddress: `0x${string}`;
  dripAmountWei: bigint;
  dripThresholdWei: bigint;
}

let cachedEnv: OperatorEnv | null = null;

function getOperatorEnv(): OperatorEnv {
  if (cachedEnv) return cachedEnv;

  const subOrgId = process.env.OPERATOR_TURNKEY_SUB_ORG_ID;
  const walletAddress = process.env.OPERATOR_WALLET_ADDRESS as `0x${string}` | undefined;
  if (!subOrgId || !walletAddress) {
    throw new Error(
      'Operator gas wallet is not configured: set OPERATOR_TURNKEY_SUB_ORG_ID and OPERATOR_WALLET_ADDRESS',
    );
  }

  const dripAmountEth = process.env.GAS_DRIP_AMOUNT_ETH || '0.001';
  const dripThresholdEth = process.env.GAS_DRIP_THRESHOLD_ETH || '0.0005';
  cachedEnv = {
    subOrgId,
    walletAddress,
    dripAmountWei: parseUnits(dripAmountEth, 18),
    dripThresholdWei: parseUnits(dripThresholdEth, 18),
  };
  return cachedEnv;
}

/**
 * Ensure the given buyback wallet has at least `dripThresholdWei` of ETH on
 * Base. If not, send a drip from the operator wallet via Turnkey two-stamper
 * signing and wait for the receipt before returning.
 *
 * Idempotent / safe to call repeatedly. No-ops when the balance is already
 * sufficient. Failures are surfaced — the caller (executor worker) marks the
 * execution RETRYING and the next cycle tries again.
 */
export async function ensureGasFunded(
  buybackWalletAddress: `0x${string}`,
): Promise<{ topped: boolean; txHash?: string }> {
  const op = getOperatorEnv();
  const client = getBasePublicClient();

  const balance = await client.getBalance({ address: buybackWalletAddress });
  if (balance >= op.dripThresholdWei) {
    return { topped: false };
  }

  // Build a plain ETH transfer from operator -> buyback wallet.
  const [nonce, fees, gas] = await Promise.all([
    client.getTransactionCount({ address: op.walletAddress, blockTag: 'pending' }),
    client.estimateFeesPerGas(),
    client.estimateGas({
      account: op.walletAddress,
      to: buybackWalletAddress,
      value: op.dripAmountWei,
    }),
  ]);
  const tx: TransactionSerializableEIP1559 = {
    chainId: base.id,
    type: 'eip1559',
    to: buybackWalletAddress,
    value: op.dripAmountWei,
    data: '0x',
    nonce,
    gas: (gas * BigInt(120)) / BigInt(100),
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  };

  const signed = await signTransaction({
    subOrgId: op.subOrgId,
    fromAddress: op.walletAddress,
    unsignedTx: tx,
  });

  const txHash = await client.sendRawTransaction({ serializedTransaction: signed });
  await client.waitForTransactionReceipt({ hash: txHash, timeout: 5 * 60_000 });

  return { topped: true, txHash };
}
