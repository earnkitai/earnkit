import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  parseAbi,
  parseUnits,
  type Abi,
  type TransactionSerializableEIP1559,
} from 'viem';
import { getAddress, isAddress } from 'viem';
import { base } from 'viem/chains';
import { prisma } from '../lib/prisma';
import {
  encodeWarehouseWithdraw,
  getBasePublicClient,
  readWarehouseBalance,
  SPLIT_NATIVE_TOKEN_ADDRESS,
  SPLIT_WAREHOUSE_ADDRESS,
} from '../lib/splitsWarehouse';
import {
  applySlippage,
  encodeExactInput,
  quoteBestPath,
  UNISWAP_V3_SWAP_ROUTER_02,
  WETH_BASE,
} from '../lib/uniswap';
import { DEAD_ADDRESS } from '../lib/tokenSafety';
import { signTransaction } from '../services/turnkeyService';
import { SUPPORTED_TOKENS } from '../services/tokenService';
import { priceService } from '../services/priceService';
import { ensureGasFunded } from '../lib/operatorGas';
import { isWalletInSplit } from '../lib/splitReader';
import { snapshotBuybackBalance } from '../lib/buybackBalance';

const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? String(5 * 60_000), 10);
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];
const MIN_GAS_RESERVE_WEI = parseUnits('0.0001', 18);
const TX_RECEIPT_TIMEOUT_MS = 5 * 60_000;

const BURN_FN_ABI = parseAbi(['function burn(uint256 amount)']) as Abi;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

interface RunCtx {
  configId: string;
  executionId: string;
  walletAddress: `0x${string}`;
  subOrgId: string;
  tokenAddress: `0x${string}`;
  tokenDecimals: number;
  slippageBps: number;
  burnMode: 'DEAD_ADDRESS' | 'TOKEN_BURN_FN';
  recoveryAddress: `0x${string}`;
  feeRateBps: number;
}

function getTreasuryAddress(): `0x${string}` | null {
  const addr = process.env.BUYBACK_TREASURY_ADDRESS;
  if (!addr || !isAddress(addr)) return null;
  return getAddress(addr) as `0x${string}`;
}

async function buildBaseTx(
  client: ReturnType<typeof getBasePublicClient>,
  walletAddress: `0x${string}`,
  to: `0x${string}`,
  data: `0x${string}`,
  value: bigint,
): Promise<TransactionSerializableEIP1559> {
  const [nonce, fees, gas] = await Promise.all([
    client.getTransactionCount({ address: walletAddress, blockTag: 'pending' }),
    client.estimateFeesPerGas(),
    client.estimateGas({ account: walletAddress, to, data, value }),
  ]);
  return {
    chainId: base.id,
    type: 'eip1559',
    to,
    data,
    value,
    nonce,
    gas: (gas * BigInt(120)) / BigInt(100),
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  };
}

async function sendTurnkeySignedTx(
  ctx: RunCtx,
  to: `0x${string}`,
  data: `0x${string}`,
  value: bigint = BigInt(0),
): Promise<`0x${string}`> {
  const client = getBasePublicClient();
  const unsignedTx = await buildBaseTx(client, ctx.walletAddress, to, data, value);
  const signed = await signTransaction({
    subOrgId: ctx.subOrgId,
    fromAddress: ctx.walletAddress,
    unsignedTx,
  });
  const txHash = await client.sendRawTransaction({ serializedTransaction: signed });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: TX_RECEIPT_TIMEOUT_MS });
  if (receipt.status === 'reverted') throw new Error(`tx_reverted:${txHash}`);
  return txHash;
}

// ---------- Step 1: Withdraw from warehouse ----------

// Persists each hash incrementally so a mid-loop failure doesn't lose
// prior progress on retry — see docs §5.
async function withdrawAllFromWarehouse(ctx: RunCtx): Promise<string[]> {
  const client = getBasePublicClient();
  const hashes: string[] = [];

  const persistHash = async (hash: string): Promise<void> => {
    hashes.push(hash);
    await prisma.sharedSplitExecution.update({
      where: { id: ctx.executionId },
      data: { warehouseWithdrawHashes: { push: hash } },
    });
  };

  const ethBal = await readWarehouseBalance({ owner: ctx.walletAddress, token: SPLIT_NATIVE_TOKEN_ADDRESS, client });
  if (ethBal > BigInt(0)) {
    const data = encodeWarehouseWithdraw({ owner: ctx.walletAddress, token: SPLIT_NATIVE_TOKEN_ADDRESS });
    await persistHash(await sendTurnkeySignedTx(ctx, SPLIT_WAREHOUSE_ADDRESS, data));
  }

  for (const token of SUPPORTED_TOKENS) {
    const bal = await readWarehouseBalance({ owner: ctx.walletAddress, token: token.address as `0x${string}`, client });
    if (bal === BigInt(0)) continue;
    const data = encodeWarehouseWithdraw({ owner: ctx.walletAddress, token: token.address as `0x${string}` });
    await persistHash(await sendTurnkeySignedTx(ctx, SPLIT_WAREHOUSE_ADDRESS, data));
  }

  return hashes;
}

// ---------- Step 2: Deduct platform fee ----------

async function deductFees(ctx: RunCtx): Promise<{ hashes: string[]; feeUsd: number }> {
  const treasury = getTreasuryAddress();
  if (!treasury || ctx.feeRateBps === 0) return { hashes: [], feeUsd: 0 };

  const client = getBasePublicClient();
  const hashes: string[] = [];
  let feeUsd = 0;

  // Native ETH fee
  const ethBal = await client.getBalance({ address: ctx.walletAddress });
  const ethSwappable = ethBal > MIN_GAS_RESERVE_WEI ? ethBal - MIN_GAS_RESERVE_WEI : BigInt(0);
  if (ethSwappable > BigInt(0)) {
    const feeWei = (ethSwappable * BigInt(ctx.feeRateBps)) / BigInt(10_000);
    if (feeWei > BigInt(0)) {
      try {
        const hash = await sendTurnkeySignedTx(ctx, treasury, '0x', feeWei);
        hashes.push(hash);
        try {
          const ethPrice = await priceService.getEthPriceUsd();
          feeUsd += Number(formatUnits(feeWei, 18)) * ethPrice;
        } catch { /* best-effort */ }
      } catch (err: unknown) {
        console.warn(`[SharedSplitWorker] ETH fee transfer failed for ${ctx.executionId}:`, err);
      }
    }
  }

  // ERC-20 fees
  for (const token of SUPPORTED_TOKENS) {
    const tokenAddr = token.address as `0x${string}`;
    const isUserToken = tokenAddr.toLowerCase() === ctx.tokenAddress.toLowerCase();
    if (isUserToken) continue; // don't take fee from the token we're trying to buy back

    const bal = (await client.readContract({
      address: tokenAddr,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [ctx.walletAddress],
    })) as bigint;

    if (bal === BigInt(0)) continue;
    const feeAmt = (bal * BigInt(ctx.feeRateBps)) / BigInt(10_000);
    if (feeAmt === BigInt(0)) continue;

    try {
      const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [treasury, feeAmt] });
      const hash = await sendTurnkeySignedTx(ctx, tokenAddr, data);
      hashes.push(hash);
      try {
        const tokenPrice = await priceService.getTokenPriceUsd(tokenAddr);
        feeUsd += Number(formatUnits(feeAmt, token.decimals)) * tokenPrice;
      } catch { /* best-effort */ }
    } catch (err: unknown) {
      console.warn(`[SharedSplitWorker] ${token.symbol} fee transfer failed for ${ctx.executionId}:`, err);
    }
  }

  return { hashes, feeUsd };
}

// ---------- Step 3: Swap to target token ----------

async function approveIfNeeded(ctx: RunCtx, token: `0x${string}`, amount: bigint): Promise<void> {
  const client = getBasePublicClient();
  const allowance = (await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [ctx.walletAddress, UNISWAP_V3_SWAP_ROUTER_02],
  })) as bigint;
  if (allowance >= amount) return;

  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [UNISWAP_V3_SWAP_ROUTER_02, BigInt(2) ** BigInt(256) - BigInt(1)],
  });
  await sendTurnkeySignedTx(ctx, token, data);
}

interface SwapNote {
  symbol: string;
  status: 'ok' | 'no_quote' | 'failed';
  hash?: string;
  error?: string;
}

// Read-modify-write on assetsIn.swapResults — see docs §6.
async function recordSwapNote(executionId: string, note: SwapNote): Promise<void> {
  const exec = await prisma.sharedSplitExecution.findUnique({
    where: { id: executionId },
    select: { assetsIn: true },
  });
  const current = (exec?.assetsIn as Record<string, unknown> | null) ?? {};
  const list = (Array.isArray(current.swapResults) ? current.swapResults : []) as SwapNote[];
  list.push(note);
  await prisma.sharedSplitExecution.update({
    where: { id: executionId },
    data: { assetsIn: { ...current, swapResults: list } as never },
  });
}

async function swapAllToUserToken(ctx: RunCtx): Promise<{ swapHash: string | null; tokenBalanceAfter: bigint }> {
  const client = getBasePublicClient();
  let lastSwapHash: string | null = null;

  const ethBal = await client.getBalance({ address: ctx.walletAddress });
  const ethSwappable = ethBal > MIN_GAS_RESERVE_WEI ? ethBal - MIN_GAS_RESERVE_WEI : BigInt(0);

  if (ethSwappable > BigInt(0)) {
    try {
      const quote = await quoteBestPath({ tokenIn: WETH_BASE, tokenOut: ctx.tokenAddress, amountIn: ethSwappable, client });
      if (!quote || quote.amountOut === BigInt(0)) {
        await recordSwapNote(ctx.executionId, { symbol: 'ETH', status: 'no_quote' });
      } else {
        const data = encodeExactInput({
          path: quote.path,
          recipient: ctx.walletAddress,
          amountIn: ethSwappable,
          amountOutMinimum: applySlippage(quote.amountOut, ctx.slippageBps),
        });
        lastSwapHash = await sendTurnkeySignedTx(ctx, UNISWAP_V3_SWAP_ROUTER_02, data, ethSwappable);
        await recordSwapNote(ctx.executionId, { symbol: 'ETH', status: 'ok', hash: lastSwapHash });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[SharedSplitWorker] ETH swap failed for ${ctx.executionId}:`, err);
      await recordSwapNote(ctx.executionId, { symbol: 'ETH', status: 'failed', error: msg.slice(0, 300) });
    }
  }

  for (const token of SUPPORTED_TOKENS) {
    const tokenAddr = token.address as `0x${string}`;
    if (tokenAddr.toLowerCase() === ctx.tokenAddress.toLowerCase()) continue;

    const bal = (await client.readContract({
      address: tokenAddr,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [ctx.walletAddress],
    })) as bigint;
    if (bal === BigInt(0)) continue;

    try {
      const quote = await quoteBestPath({ tokenIn: tokenAddr, tokenOut: ctx.tokenAddress, amountIn: bal, client });
      if (!quote || quote.amountOut === BigInt(0)) {
        await recordSwapNote(ctx.executionId, { symbol: token.symbol, status: 'no_quote' });
        continue;
      }
      await approveIfNeeded(ctx, tokenAddr, bal);
      const data = encodeExactInput({
        path: quote.path,
        recipient: ctx.walletAddress,
        amountIn: bal,
        amountOutMinimum: applySlippage(quote.amountOut, ctx.slippageBps),
      });
      lastSwapHash = await sendTurnkeySignedTx(ctx, UNISWAP_V3_SWAP_ROUTER_02, data);
      await recordSwapNote(ctx.executionId, { symbol: token.symbol, status: 'ok', hash: lastSwapHash });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[SharedSplitWorker] ${token.symbol} swap failed for ${ctx.executionId}:`, err);
      await recordSwapNote(ctx.executionId, { symbol: token.symbol, status: 'failed', error: msg.slice(0, 300) });
    }
  }

  const tokenBalanceAfter = (await client.readContract({
    address: ctx.tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [ctx.walletAddress],
  })) as bigint;

  return { swapHash: lastSwapHash, tokenBalanceAfter };
}

// ---------- Step 4: Burn ----------

async function burnAcquiredTokens(ctx: RunCtx): Promise<{ burnHash: string; amount: bigint }> {
  const client = getBasePublicClient();
  const balance = (await client.readContract({
    address: ctx.tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [ctx.walletAddress],
  })) as bigint;

  if (balance === BigInt(0)) throw new Error('no_balance_to_burn');

  if (ctx.burnMode === 'TOKEN_BURN_FN') {
    try {
      const data = encodeFunctionData({ abi: BURN_FN_ABI, functionName: 'burn', args: [balance] });
      const hash = await sendTurnkeySignedTx(ctx, ctx.tokenAddress, data);
      return { burnHash: hash, amount: balance };
    } catch {
      // fall through to dead-address
    }
  }

  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [DEAD_ADDRESS, balance] });
  const hash = await sendTurnkeySignedTx(ctx, ctx.tokenAddress, data);
  return { burnHash: hash, amount: balance };
}

// ---------- Activation check ----------

async function checkPendingActivations(): Promise<void> {
  // Skip configs without a split yet (Token card flow: user hasn't completed
  // the deploy step). They'll surface here once `/set-split` lands.
  const pending = await prisma.sharedSplitBuybackConfig.findMany({
    where: {
      status: 'PENDING_SPLIT_UPDATE',
      isActive: true,
      walletAddress: { not: null },
      splitAddress: { not: null },
    },
    take: 20,
  });

  for (const config of pending) {
    try {
      const inSplit = await isWalletInSplit(
        config.splitAddress! as `0x${string}`,
        config.walletAddress! as `0x${string}`,
      );
      if (inSplit === true) {
        await prisma.sharedSplitBuybackConfig.update({
          where: { id: config.id },
          data: { status: 'ACTIVE' },
        });
        console.log(`[SharedSplitWorker] Activated config ${config.id} — wallet found in split`);
      } else if (inSplit === null) {
        // null = unknown; retry next poll. See docs §4.
        console.log(`[SharedSplitWorker] Activation check for ${config.id}: membership unknown, will retry`);
      }
    } catch (err: unknown) {
      console.warn(`[SharedSplitWorker] Activation check failed for ${config.id}:`, err);
    }
  }
}

// ---------- Balance scan + queue ----------

async function scanActiveConfigs(): Promise<void> {
  const active = await prisma.sharedSplitBuybackConfig.findMany({
    where: { status: 'ACTIVE', isActive: true, walletAddress: { not: null } },
  });

  for (const config of active) {
    try {
      const snapshot = await snapshotBuybackBalance(config.walletAddress! as `0x${string}`);

      await prisma.sharedSplitBuybackConfig.update({
        where: { id: config.id },
        data: { lastCheckedAt: new Date() },
      });

      if (snapshot.totalUsd < config.thresholdUsd) continue;

      const inFlight = await prisma.sharedSplitExecution.findFirst({
        where: { configId: config.id, status: { in: ['QUEUED', 'WITHDRAWING', 'SWAPPING', 'BURNING', 'RETRYING'] } },
      });
      if (inFlight) continue;

      await prisma.sharedSplitExecution.create({
        data: {
          configId: config.id,
          triggerBalanceUsd: snapshot.totalUsd,
          assetsIn: snapshot.assets as any,
        },
      });
      console.log(`[SharedSplitWorker] Queued execution for config ${config.id} at $${snapshot.totalUsd.toFixed(2)}`);
    } catch (err: unknown) {
      console.warn(`[SharedSplitWorker] Scan failed for config ${config.id}:`, err);
    }
  }
}

// ---------- Execute queued executions ----------

async function processExecutions(): Promise<void> {
  const now = new Date();
  const due = await prisma.sharedSplitExecution.findMany({
    where: {
      status: { in: ['QUEUED', 'RETRYING'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    include: { config: true },
    take: 5,
  });

  for (const exec of due) {
    const config = exec.config;
    if (!config.isActive || config.status !== 'ACTIVE') {
      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: { status: 'FAILED', lastError: 'config_disabled', completedAt: new Date() },
      });
      continue;
    }

    if (!config.walletAddress || !config.turnkeySubOrgId) {
      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: { status: 'FAILED', lastError: 'wallet_not_provisioned', completedAt: new Date() },
      });
      continue;
    }

    const claim = await prisma.sharedSplitExecution.updateMany({
      where: { id: exec.id, attempts: exec.attempts },
      data: { attempts: exec.attempts + 1, status: 'WITHDRAWING', nextAttemptAt: null },
    });
    if (claim.count === 0) continue;

    const ctx: RunCtx = {
      configId: config.id,
      executionId: exec.id,
      walletAddress: config.walletAddress as `0x${string}`,
      subOrgId: config.turnkeySubOrgId,
      tokenAddress: config.tokenAddress as `0x${string}`,
      tokenDecimals: config.tokenDecimals,
      slippageBps: config.slippageBps,
      burnMode: config.burnMode as 'DEAD_ADDRESS' | 'TOKEN_BURN_FN',
      recoveryAddress: config.recoveryAddress as `0x${string}`,
      feeRateBps: config.feeRateBps,
    };

    const attempt = exec.attempts + 1;
    const isFinal = attempt >= MAX_ATTEMPTS;

    try {
      try {
        await ensureGasFunded(ctx.walletAddress);
      } catch (err: unknown) {
        throw new Error(`gas_drip_failed: ${err instanceof Error ? err.message : err}`);
      }

      // Hashes are persisted inside the helper; don't overwrite on retry.
      await withdrawAllFromWarehouse(ctx);
      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: { status: 'SWAPPING' },
      });

      const { hashes: feeHashes, feeUsd } = await deductFees(ctx);
      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: { feeTransferHashes: feeHashes, feeCollectedUsd: feeUsd },
      });

      const { swapHash, tokenBalanceAfter } = await swapAllToUserToken(ctx);
      if (tokenBalanceAfter === BigInt(0)) {
        await prisma.sharedSplitExecution.update({
          where: { id: exec.id },
          data: { status: 'FAILED', swapHash: swapHash ?? undefined, lastError: 'swap_produced_no_tokens', completedAt: new Date() },
        });
        continue;
      }
      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: { swapHash: swapHash ?? undefined, status: 'BURNING' },
      });

      const burn = await burnAcquiredTokens(ctx);

      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: {
          status: 'COMPLETED',
          burnHash: burn.burnHash,
          tokensOutAmount: burn.amount.toString(),
          tokensOutUsd: exec.triggerBalanceUsd,
          completedAt: new Date(),
        },
      });
      await prisma.sharedSplitBuybackConfig.update({
        where: { id: config.id },
        data: { lastTriggeredAt: new Date() },
      });

      console.log(
        `[SharedSplitWorker] Completed ${exec.id}: burned ${formatUnits(burn.amount, ctx.tokenDecimals)} ${config.tokenSymbol}, fee $${feeUsd.toFixed(2)}`,
      );
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'unknown_error';
      const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
      await prisma.sharedSplitExecution.update({
        where: { id: exec.id },
        data: {
          status: isFinal ? 'FAILED' : 'RETRYING',
          lastError: reason.slice(0, 500),
          nextAttemptAt: isFinal ? null : new Date(Date.now() + delay),
          completedAt: isFinal ? new Date() : null,
        },
      });
      console.error(`[SharedSplitWorker] Execution ${exec.id} attempt ${attempt} failed:`, reason);

      // After a final failure, check if the last 3 executions are all FAILED → mark BROKEN
      if (isFinal) {
        try {
          const lastExecs = await prisma.sharedSplitExecution.findMany({
            where:   { configId: config.id },
            orderBy: { startedAt: 'desc' },
            take:    3,
            select:  { status: true },
          });
          if (lastExecs.length >= 3 && lastExecs.every((e) => e.status === 'FAILED')) {
            await prisma.sharedSplitBuybackConfig.update({
              where: { id: config.id },
              data:  { status: 'BROKEN' },
            });
            console.warn(`[SharedSplitWorker] Config ${config.id} marked BROKEN after 3 consecutive failed executions`);
          }
        } catch { /* non-fatal */ }
      }
    }
  }
}

// ---------- Main poll loop ----------

async function poll(): Promise<void> {
  await checkPendingActivations();
  await scanActiveConfigs();
  await processExecutions();
}

export function startSharedSplitBuybackWorker(): void {
  if (intervalHandle) return;
  console.log(`[SharedSplitWorker] Starting — polling every ${POLL_INTERVAL_MS / 1000}s`);
  poll().catch((e) => console.error('[SharedSplitWorker] Initial run error:', e));
  intervalHandle = setInterval(() => {
    poll().catch((e) => console.error('[SharedSplitWorker] Poll error:', e));
  }, POLL_INTERVAL_MS);
}

export function stopSharedSplitBuybackWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
