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
import { getBasePublicClient, SPLIT_NATIVE_TOKEN_ADDRESS } from '../lib/splitsWarehouse';
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
import { snapshotBuybackBalance } from '../lib/buybackBalance';

const POLL_INTERVAL_MS  = 5 * 60_000;
const MAX_ATTEMPTS      = 5;
const RETRY_DELAYS_MS   = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];
const MIN_GAS_RESERVE_WEI   = parseUnits('0.0001', 18);
const TX_RECEIPT_TIMEOUT_MS = 5 * 60_000;
// Wallet must receive at least this much before we consider the fee recipient set
const MIN_ACTIVATION_USD = 0.10;

const BURN_FN_ABI = parseAbi(['function burn(uint256 amount)']) as Abi;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

interface RunCtx {
  configId:       string;
  executionId:    string;
  walletAddress:  `0x${string}`;
  subOrgId:       string;
  tokenAddress:   `0x${string}`;
  tokenDecimals:  number;
  slippageBps:    number;
  burnMode:       'DEAD_ADDRESS' | 'TOKEN_BURN_FN';
  recoveryAddress: `0x${string}`;
  feeRateBps:     number;
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
    maxFeePerGas:         fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  };
}

async function sendTurnkeySignedTx(
  ctx: RunCtx,
  to: `0x${string}`,
  data: `0x${string}`,
  value: bigint = BigInt(0),
): Promise<`0x${string}`> {
  const client     = getBasePublicClient();
  const unsignedTx = await buildBaseTx(client, ctx.walletAddress, to, data, value);
  const signed     = await signTransaction({ subOrgId: ctx.subOrgId, fromAddress: ctx.walletAddress, unsignedTx });
  const txHash     = await client.sendRawTransaction({ serializedTransaction: signed });
  await client.waitForTransactionReceipt({ hash: txHash, timeout: TX_RECEIPT_TIMEOUT_MS });
  return txHash;
}

// ---------- Activation balance check ----------
// Uses raw balances (no gas reserve deduction) so ETH fee contracts don't
// need > MIN_GAS_RESERVE_WEI extra just to pass the activation gate.

async function hasReceivedFunds(walletAddress: `0x${string}`): Promise<boolean> {
  const client = getBasePublicClient();

  try {
    const ethBal = await client.getBalance({ address: walletAddress });
    if (ethBal > BigInt(0)) {
      const ethPrice = await priceService.getEthPriceUsd();
      if (Number(formatUnits(ethBal, 18)) * ethPrice >= MIN_ACTIVATION_USD) return true;
    }
  } catch { /* best-effort */ }

  for (const token of SUPPORTED_TOKENS) {
    try {
      const bal = (await client.readContract({
        address:      token.address as `0x${string}`,
        abi:          erc20Abi,
        functionName: 'balanceOf',
        args:         [walletAddress],
      })) as bigint;
      if (bal > BigInt(0)) {
        const price = await priceService.getTokenPriceUsd(token.address as `0x${string}`);
        if (Number(formatUnits(bal, token.decimals)) * price >= MIN_ACTIVATION_USD) return true;
      }
    } catch { /* best-effort */ }
  }

  return false;
}

// ---------- Step 1: Deduct platform fee ----------
// For token contracts there is no warehouse withdrawal — fees arrive directly
// in the wallet. We go straight to fee deduction before the swap.

async function deductFees(ctx: RunCtx): Promise<{ hashes: string[]; feeUsd: number }> {
  const treasury = getTreasuryAddress();
  if (!treasury || ctx.feeRateBps === 0) return { hashes: [], feeUsd: 0 };

  const client = getBasePublicClient();
  const hashes: string[] = [];
  let feeUsd = 0;

  // Native ETH
  const ethBal      = await client.getBalance({ address: ctx.walletAddress });
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
        console.warn(`[TokenBuybackWorker] ETH fee transfer failed for ${ctx.executionId}:`, err);
      }
    }
  }

  // ERC-20s from SUPPORTED_TOKENS (the most common fee currencies)
  for (const token of SUPPORTED_TOKENS) {
    const tokenAddr = token.address as `0x${string}`;
    // Never take fee from the token we're buying back
    if (tokenAddr.toLowerCase() === ctx.tokenAddress.toLowerCase()) continue;

    const bal = (await client.readContract({
      address: tokenAddr,
      abi:     erc20Abi,
      functionName: 'balanceOf',
      args:    [ctx.walletAddress],
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
      console.warn(`[TokenBuybackWorker] ${token.symbol} fee transfer failed for ${ctx.executionId}:`, err);
    }
  }

  return { hashes, feeUsd };
}

// ---------- Step 2: Swap to target token ----------

async function approveIfNeeded(ctx: RunCtx, token: `0x${string}`, amount: bigint): Promise<void> {
  const client    = getBasePublicClient();
  const allowance = (await client.readContract({
    address:      token,
    abi:          erc20Abi,
    functionName: 'allowance',
    args:         [ctx.walletAddress, UNISWAP_V3_SWAP_ROUTER_02],
  })) as bigint;
  if (allowance >= amount) return;

  const data = encodeFunctionData({
    abi:          erc20Abi,
    functionName: 'approve',
    args:         [UNISWAP_V3_SWAP_ROUTER_02, BigInt(2) ** BigInt(256) - BigInt(1)],
  });
  await sendTurnkeySignedTx(ctx, token, data);
}

async function swapAllToUserToken(ctx: RunCtx): Promise<{ swapHash: string | null; tokenBalanceAfter: bigint }> {
  const client        = getBasePublicClient();
  let lastSwapHash: string | null = null;

  const ethBal       = await client.getBalance({ address: ctx.walletAddress });
  const ethSwappable = ethBal > MIN_GAS_RESERVE_WEI ? ethBal - MIN_GAS_RESERVE_WEI : BigInt(0);

  if (ethSwappable > BigInt(0)) {
    try {
      const quote = await quoteBestPath({ tokenIn: WETH_BASE, tokenOut: ctx.tokenAddress, amountIn: ethSwappable, client });
      if (quote && quote.amountOut > BigInt(0)) {
        const data = encodeExactInput({
          path:             quote.path,
          recipient:        ctx.walletAddress,
          amountIn:         ethSwappable,
          amountOutMinimum: applySlippage(quote.amountOut, ctx.slippageBps),
        });
        lastSwapHash = await sendTurnkeySignedTx(ctx, UNISWAP_V3_SWAP_ROUTER_02, data, ethSwappable);
      }
    } catch (err: unknown) {
      console.warn(`[TokenBuybackWorker] ETH swap failed for ${ctx.executionId}:`, err);
    }
  }

  for (const token of SUPPORTED_TOKENS) {
    const tokenAddr = token.address as `0x${string}`;
    if (tokenAddr.toLowerCase() === ctx.tokenAddress.toLowerCase()) continue;

    const bal = (await client.readContract({
      address:      tokenAddr,
      abi:          erc20Abi,
      functionName: 'balanceOf',
      args:         [ctx.walletAddress],
    })) as bigint;
    if (bal === BigInt(0)) continue;

    try {
      const quote = await quoteBestPath({ tokenIn: tokenAddr, tokenOut: ctx.tokenAddress, amountIn: bal, client });
      if (!quote || quote.amountOut === BigInt(0)) continue;
      await approveIfNeeded(ctx, tokenAddr, bal);
      const data = encodeExactInput({
        path:             quote.path,
        recipient:        ctx.walletAddress,
        amountIn:         bal,
        amountOutMinimum: applySlippage(quote.amountOut, ctx.slippageBps),
      });
      lastSwapHash = await sendTurnkeySignedTx(ctx, UNISWAP_V3_SWAP_ROUTER_02, data);
    } catch (err: unknown) {
      console.warn(`[TokenBuybackWorker] ${token.symbol} swap failed for ${ctx.executionId}:`, err);
    }
  }

  const tokenBalanceAfter = (await client.readContract({
    address:      ctx.tokenAddress,
    abi:          erc20Abi,
    functionName: 'balanceOf',
    args:         [ctx.walletAddress],
  })) as bigint;

  return { swapHash: lastSwapHash, tokenBalanceAfter };
}

// ---------- Step 3: Burn ----------

async function burnAcquiredTokens(ctx: RunCtx): Promise<{ burnHash: string; amount: bigint }> {
  const client  = getBasePublicClient();
  const balance = (await client.readContract({
    address:      ctx.tokenAddress,
    abi:          erc20Abi,
    functionName: 'balanceOf',
    args:         [ctx.walletAddress],
  })) as bigint;

  if (balance === BigInt(0)) throw new Error('no_balance_to_burn');

  if (ctx.burnMode === 'TOKEN_BURN_FN') {
    try {
      const data = encodeFunctionData({ abi: BURN_FN_ABI, functionName: 'burn', args: [balance] });
      const hash = await sendTurnkeySignedTx(ctx, ctx.tokenAddress, data);
      return { burnHash: hash, amount: balance };
    } catch {
      // fall through to dead-address transfer
    }
  }

  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [DEAD_ADDRESS, balance] });
  const hash = await sendTurnkeySignedTx(ctx, ctx.tokenAddress, data);
  return { burnHash: hash, amount: balance };
}

// ---------- Activation check ----------
// We don't try to call feeRecipient() on the source contract because ABI varies
// wildly. Instead we watch the wallet's own balance: once funds arrive above the
// minimum activation threshold, it proves the owner updated their fee recipient.

async function checkPendingActivations(): Promise<void> {
  const pending = await prisma.tokenContractBuybackConfig.findMany({
    where: { status: 'PENDING_FEE_RECIPIENT_UPDATE', isActive: true, walletAddress: { not: null } },
    take: 20,
  });

  for (const config of pending) {
    try {
      const funded = await hasReceivedFunds(config.walletAddress! as `0x${string}`);
      if (funded) {
        await prisma.tokenContractBuybackConfig.update({
          where: { id: config.id },
          data:  { status: 'ACTIVE' },
        });
        console.log(`[TokenBuybackWorker] Activated config ${config.id} — funds received in wallet`);
      }
    } catch (err: unknown) {
      console.warn(`[TokenBuybackWorker] Activation check failed for ${config.id}:`, err);
    }
  }
}

// ---------- Balance scan + queue ----------

async function scanActiveConfigs(): Promise<void> {
  const active = await prisma.tokenContractBuybackConfig.findMany({
    where: { status: 'ACTIVE', isActive: true, walletAddress: { not: null } },
  });

  for (const config of active) {
    try {
      const snapshot = await snapshotBuybackBalance(config.walletAddress! as `0x${string}`);

      await prisma.tokenContractBuybackConfig.update({
        where: { id: config.id },
        data:  { lastCheckedAt: new Date() },
      });

      if (snapshot.totalUsd < config.thresholdUsd) continue;

      const inFlight = await prisma.tokenContractExecution.findFirst({
        where: { configId: config.id, status: { in: ['QUEUED', 'SWAPPING', 'BURNING', 'RETRYING'] } },
      });
      if (inFlight) continue;

      await prisma.tokenContractExecution.create({
        data: {
          configId:          config.id,
          triggerBalanceUsd: snapshot.totalUsd,
          assetsIn:          snapshot.assets as any,
        },
      });
      console.log(`[TokenBuybackWorker] Queued execution for config ${config.id} at $${snapshot.totalUsd.toFixed(2)}`);
    } catch (err: unknown) {
      console.warn(`[TokenBuybackWorker] Scan failed for config ${config.id}:`, err);
    }
  }
}

// ---------- Execute queued executions ----------

async function processExecutions(): Promise<void> {
  const now = new Date();
  const due = await prisma.tokenContractExecution.findMany({
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
      await prisma.tokenContractExecution.update({
        where: { id: exec.id },
        data:  { status: 'FAILED', lastError: 'config_disabled', completedAt: new Date() },
      });
      continue;
    }

    if (!config.walletAddress || !config.turnkeySubOrgId) {
      await prisma.tokenContractExecution.update({
        where: { id: exec.id },
        data:  { status: 'FAILED', lastError: 'wallet_not_provisioned', completedAt: new Date() },
      });
      continue;
    }

    // Optimistic lock — prevents two worker ticks from processing the same execution
    const claim = await prisma.tokenContractExecution.updateMany({
      where: { id: exec.id, attempts: exec.attempts },
      data:  { attempts: exec.attempts + 1, status: 'SWAPPING', nextAttemptAt: null },
    });
    if (claim.count === 0) continue;

    const ctx: RunCtx = {
      configId:       config.id,
      executionId:    exec.id,
      walletAddress:  config.walletAddress as `0x${string}`,
      subOrgId:       config.turnkeySubOrgId,
      tokenAddress:   config.targetTokenAddress as `0x${string}`,
      tokenDecimals:  config.targetTokenDecimals,
      slippageBps:    config.slippageBps,
      burnMode:       config.burnMode as 'DEAD_ADDRESS' | 'TOKEN_BURN_FN',
      recoveryAddress: config.recoveryAddress as `0x${string}`,
      feeRateBps:     config.feeRateBps,
    };

    const attempt = exec.attempts + 1;
    const isFinal = attempt >= MAX_ATTEMPTS;

    try {
      try {
        await ensureGasFunded(ctx.walletAddress);
      } catch (err: unknown) {
        throw new Error(`gas_drip_failed: ${err instanceof Error ? err.message : err}`);
      }

      // Token contracts: no warehouse withdrawal — fees are already in the wallet.
      // Pipeline: deductFees → swap → burn
      const { hashes: feeHashes, feeUsd } = await deductFees(ctx);
      await prisma.tokenContractExecution.update({
        where: { id: exec.id },
        data:  { feeTransferHashes: feeHashes, feeCollectedUsd: feeUsd },
      });

      const { swapHash, tokenBalanceAfter } = await swapAllToUserToken(ctx);
      if (tokenBalanceAfter === BigInt(0)) {
        await prisma.tokenContractExecution.update({
          where: { id: exec.id },
          data:  {
            status:     'FAILED',
            swapHash:   swapHash ?? undefined,
            lastError:  'swap_produced_no_tokens',
            completedAt: new Date(),
          },
        });
        continue;
      }
      await prisma.tokenContractExecution.update({
        where: { id: exec.id },
        data:  { swapHash: swapHash ?? undefined, status: 'BURNING' },
      });

      const burn = await burnAcquiredTokens(ctx);

      await prisma.tokenContractExecution.update({
        where: { id: exec.id },
        data: {
          status:         'COMPLETED',
          burnHash:       burn.burnHash,
          tokensOutAmount: burn.amount.toString(),
          tokensOutUsd:   exec.triggerBalanceUsd,
          completedAt:    new Date(),
        },
      });
      await prisma.tokenContractBuybackConfig.update({
        where: { id: config.id },
        data:  { lastTriggeredAt: new Date() },
      });

      console.log(
        `[TokenBuybackWorker] Completed ${exec.id}: burned ${formatUnits(burn.amount, ctx.tokenDecimals)} ${config.targetTokenSymbol}, fee $${feeUsd.toFixed(2)}`,
      );
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'unknown_error';
      const delay  = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
      await prisma.tokenContractExecution.update({
        where: { id: exec.id },
        data: {
          status:       isFinal ? 'FAILED' : 'RETRYING',
          lastError:    reason.slice(0, 500),
          nextAttemptAt: isFinal ? null : new Date(Date.now() + delay),
          completedAt:  isFinal ? new Date() : null,
        },
      });
      console.error(`[TokenBuybackWorker] Execution ${exec.id} attempt ${attempt} failed:`, reason);

      // After a final failure, check if the last 3 executions are all FAILED → mark BROKEN
      if (isFinal) {
        try {
          const lastExecs = await prisma.tokenContractExecution.findMany({
            where:   { configId: config.id },
            orderBy: { startedAt: 'desc' },
            take:    3,
            select:  { status: true },
          });
          if (lastExecs.length >= 3 && lastExecs.every((e) => e.status === 'FAILED')) {
            await prisma.tokenContractBuybackConfig.update({
              where: { id: config.id },
              data:  { status: 'BROKEN' },
            });
            console.warn(`[TokenBuybackWorker] Config ${config.id} marked BROKEN after 3 consecutive failed executions`);
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

export function startTokenBuybackWorker(): void {
  if (intervalHandle) return;
  console.log(`[TokenBuybackWorker] Starting — polling every ${POLL_INTERVAL_MS / 1000}s`);
  poll().catch((e) => console.error('[TokenBuybackWorker] Initial run error:', e));
  intervalHandle = setInterval(() => {
    poll().catch((e) => console.error('[TokenBuybackWorker] Poll error:', e));
  }, POLL_INTERVAL_MS);
}

export function stopTokenBuybackWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
