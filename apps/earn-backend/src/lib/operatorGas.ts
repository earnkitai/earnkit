import { createWalletClient, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { getBasePublicClient } from './splitsWarehouse';

/**
 * Operator gas wallet — drips a tiny amount of ETH to a buyback wallet right
 * before it executes, so users never need to fund their buyback wallets.
 *
 * Funded by a raw EOA private key held in env (OPERATOR_GAS_PRIVATE_KEY).
 * Bounded loss model: this wallet only ever holds whatever you fund it with
 * (suggested ~$5 ETH for thousands of drips on Base). It is platform gas
 * budget, not user funds — so a leak costs at most that float, and the
 * Cloudflare Worker co-signer still protects every actual buyback wallet.
 */

interface OperatorEnv {
  account: ReturnType<typeof privateKeyToAccount>;
  walletAddress: `0x${string}`;
  dripAmountWei: bigint;
  dripThresholdWei: bigint;
}

let cachedEnv: OperatorEnv | null = null;

function getOperatorEnv(): OperatorEnv {
  if (cachedEnv) return cachedEnv;

  const pk = process.env.OPERATOR_GAS_PRIVATE_KEY;
  if (!pk) {
    throw new Error('Operator gas wallet is not configured: set OPERATOR_GAS_PRIVATE_KEY');
  }
  const normalized = (pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`;
  const account = privateKeyToAccount(normalized);

  const dripAmountEth = process.env.GAS_DRIP_AMOUNT_ETH || '0.001';
  const dripThresholdEth = process.env.GAS_DRIP_THRESHOLD_ETH || '0.0005';
  cachedEnv = {
    account,
    walletAddress: account.address,
    dripAmountWei: parseUnits(dripAmountEth, 18),
    dripThresholdWei: parseUnits(dripThresholdEth, 18),
  };
  return cachedEnv;
}

export function getOperatorWalletAddress(): `0x${string}` | null {
  try {
    return getOperatorEnv().walletAddress;
  } catch {
    return null;
  }
}

/**
 * Ensure the given buyback wallet has at least `dripThresholdWei` of ETH on
 * Base. If not, send a drip from the operator wallet and wait for the receipt
 * before returning.
 *
 * Idempotent / safe to call repeatedly. No-ops when the balance is already
 * sufficient. Failures are surfaced — the caller (executor worker) marks the
 * execution RETRYING and the next cycle tries again.
 */
export async function ensureGasFunded(
  buybackWalletAddress: `0x${string}`,
): Promise<{ topped: boolean; txHash?: string }> {
  const op = getOperatorEnv();
  const publicClient = getBasePublicClient();

  const balance = await publicClient.getBalance({ address: buybackWalletAddress });
  if (balance >= op.dripThresholdWei) {
    return { topped: false };
  }

  const walletClient = createWalletClient({
    account: op.account,
    chain: base,
    transport: http(process.env.BASE_RPC_URL),
  });

  const txHash = await walletClient.sendTransaction({
    to: buybackWalletAddress,
    value: op.dripAmountWei,
    data: '0x',
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 5 * 60_000 });

  return { topped: true, txHash };
}
