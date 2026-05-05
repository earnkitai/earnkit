import { createWalletClient, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { getBasePublicClient } from './splitsWarehouse';

/**
 * Operator gas wallet — drips just enough ETH to a buyback wallet right before
 * it executes, so users never need to fund their buyback wallets.
 *
 * Sizing is dynamic, not fixed: we estimate the worst-case gas cost of one
 * full chain (withdraw → swap → burn) at the current Base gas price, multiply
 * by a safety factor, and drip exactly the deficit. This keeps stranded ETH
 * across the buyback wallet fleet near zero on cheap-gas Base while still
 * funding execution during congestion spikes.
 *
 * Funded by a raw EOA private key held in env (OPERATOR_GAS_PRIVATE_KEY).
 * Bounded-loss model: this wallet only ever holds whatever you fund it with
 * (recommended 0.02–0.05 ETH float). A leak costs at most that float; agent
 * buyback wallets are still protected by the Turnkey two-stamper policy.
 */

interface OperatorEnv {
  account: ReturnType<typeof privateKeyToAccount>;
  walletAddress: `0x${string}`;
  gasBudget: bigint;            // worst-case gas units for one execution chain
  safetyMultiplierBps: number;  // applied to (gasBudget * gasPrice)
  minDripWei: bigint;           // floor: don't drip dust below this
  maxDripWei: bigint;           // ceiling: hard cap regardless of gas spike
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

  cachedEnv = {
    account,
    walletAddress: account.address,
    // 500k gas covers the worst case: 2 Warehouse withdraws + WETH wrap +
    // approve + Uniswap V3 swap + burn transfer. Most chains use 200–300k.
    gasBudget: BigInt(process.env.GAS_BUDGET_UNITS ?? '500000'),
    // 1.3x = 30% headroom against gas-price drift between drip and execution.
    safetyMultiplierBps: Number(process.env.GAS_SAFETY_MULTIPLIER_BPS ?? '13000'),
    // Floor: don't bother dripping less than the drip's own gas cost × ~5.
    minDripWei: parseUnits(process.env.GAS_MIN_DRIP_ETH ?? '0.00002', 18),
    // Ceiling: even during a 100-gwei spike, never drip more than this.
    maxDripWei: parseUnits(process.env.GAS_MAX_DRIP_ETH ?? '0.002', 18),
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
 * Ensure the given buyback wallet has enough ETH for one execution chain at
 * current Base gas conditions. Drips the deficit (floored / capped) if needed,
 * waits for the receipt, then returns.
 *
 * Idempotent — calling repeatedly is safe; no-ops when the balance is already
 * sufficient for the current gas conditions.
 */
export async function ensureGasFunded(
  buybackWalletAddress: `0x${string}`,
): Promise<{ topped: boolean; txHash?: string; required?: bigint; sent?: bigint }> {
  const op = getOperatorEnv();
  const publicClient = getBasePublicClient();

  const [balance, fees] = await Promise.all([
    publicClient.getBalance({ address: buybackWalletAddress }),
    publicClient.estimateFeesPerGas(),
  ]);

  const gasPrice = fees.maxFeePerGas; // worst-case price the chain can charge us
  const baseRequired = op.gasBudget * gasPrice;
  const required =
    (baseRequired * BigInt(op.safetyMultiplierBps)) / BigInt(10_000);

  if (balance >= required) {
    return { topped: false, required };
  }

  let dripAmount = required - balance;
  if (dripAmount < op.minDripWei) dripAmount = op.minDripWei;
  if (dripAmount > op.maxDripWei) dripAmount = op.maxDripWei;

  const walletClient = createWalletClient({
    account: op.account,
    chain: base,
    transport: http(process.env.BASE_RPC_URL),
  });

  const txHash = await walletClient.sendTransaction({
    to: buybackWalletAddress,
    value: dripAmount,
    data: '0x',
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 5 * 60_000 });

  return { topped: true, txHash, required, sent: dripAmount };
}
