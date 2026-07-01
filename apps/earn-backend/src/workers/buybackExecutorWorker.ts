import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  parseAbi,
  parseUnits,
  type Abi,
  type TransactionSerializableEIP1559,
} from 'viem';
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
import { assertSwapValueVsMarket, clampSlippageBps } from '../lib/swapGuard';
import { discoverWalletErc20s, discoverWarehouseTokens } from '../lib/tokenDiscovery';
import { signTransaction } from '../services/turnkeyService';
import { priceService } from '../services/priceService';
import { ensureGasFunded } from '../lib/operatorGas';

const POLL_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]; // 1m, 5m, 30m, 2h, 12h
const MIN_GAS_RESERVE_WEI = parseUnits('0.0001', 18); // ~$0.30 worth on Base
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
  const gasWithBuffer = (gas * BigInt(120)) / BigInt(100);
  return {
    chainId: base.id,
    type: 'eip1559',
    to,
    data,
    value,
    nonce,
    gas: gasWithBuffer,
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
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    timeout: TX_RECEIPT_TIMEOUT_MS,
  });
  // A mined-but-reverted tx must NOT be treated as success — otherwise a
  // reverted swap/burn gets recorded COMPLETED and we lose track of funds.
  // (Mirrors the shared-split worker's guard.)
  if (receipt.status === 'reverted') throw new Error(`tx_reverted:${txHash}`);
  return txHash;
}

// ---------- State machine steps ----------

async function withdrawAllFromWarehouse(ctx: RunCtx): Promise<string[]> {
  const client = getBasePublicClient();
  const hashes: string[] = [];

  // ETH first
  const ethBal = await readWarehouseBalance({
    owner: ctx.walletAddress,
    token: SPLIT_NATIVE_TOKEN_ADDRESS,
    client,
  });
  if (ethBal > BigInt(0)) {
    const data = encodeWarehouseWithdraw({
      owner: ctx.walletAddress,
      token: SPLIT_NATIVE_TOKEN_ADDRESS,
    });
    hashes.push(
      await sendTurnkeySignedTx(ctx, SPLIT_WAREHOUSE_ADDRESS, data),
    );
  }

  // This config has no stored split address, so warehouse discovery falls back
  // to the seed set (WETH + SUPPORTED_TOKENS). Arbitrary tokens that reach the
  // wallet directly are picked up by the wallet-side discovery in the swap and
  // sweep steps.
  const warehouseTokens = await discoverWarehouseTokens(null);
  for (const token of warehouseTokens) {
    const bal = await readWarehouseBalance({
      owner: ctx.walletAddress,
      token: token.address as `0x${string}`,
      client,
    });
    if (bal === BigInt(0)) continue;
    const data = encodeWarehouseWithdraw({
      owner: ctx.walletAddress,
      token: token.address as `0x${string}`,
    });
    hashes.push(await sendTurnkeySignedTx(ctx, SPLIT_WAREHOUSE_ADDRESS, data));
  }

  return hashes;
}

async function approveIfNeeded(
  ctx: RunCtx,
  token: `0x${string}`,
  amount: bigint,
): Promise<void> {
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
    args: [UNISWAP_V3_SWAP_ROUTER_02, BigInt(2) ** BigInt(256) - BigInt(1)], // max approve
  });
  await sendTurnkeySignedTx(ctx, token, data);
}

interface SwapStepResult {
  swapHash: string | null;
  tokensOutAmount: bigint; // delta from swaps only (0 when fees arrived as the buyback token)
  tokenBalanceAfter: bigint; // full wallet balance after all swaps — use this to decide whether to burn
  // Per-asset notes for transparency in execution log + Sentry.
  // [{ asset: "ETH" | "USDC" | ..., amountIn: "0.05", success: true, hash?, error? }]
  notes: Array<{
    asset: string;
    amountIn: string;
    success: boolean;
    hash?: string;
    error?: string;
  }>;
}

async function swapAllToUserToken(ctx: RunCtx): Promise<SwapStepResult> {
  const client = getBasePublicClient();
  const beforeUserToken = (await client.readContract({
    address: ctx.tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [ctx.walletAddress],
  })) as bigint;

  // Discover what's on the wallet (after warehouse withdraw step).
  const ethBal = await client.getBalance({ address: ctx.walletAddress });
  const tokenBalances: Array<{ address: `0x${string}`; amount: bigint; symbol: string; decimals: number }> = [];
  // Every ERC-20 actually in the wallet — WETH, USDC, arbitrary revenue tokens.
  const walletTokens = await discoverWalletErc20s(ctx.walletAddress);
  for (const t of walletTokens) {
    const bal = (await client.readContract({
      address: t.address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [ctx.walletAddress],
    })) as bigint;
    if (bal > BigInt(0) && t.address.toLowerCase() !== ctx.tokenAddress.toLowerCase()) {
      tokenBalances.push({
        address: t.address as `0x${string}`,
        amount: bal,
        symbol: t.symbol,
        decimals: t.decimals,
      });
    }
  }

  // Reserve gas: only swap ETH amount > MIN_GAS_RESERVE_WEI.
  const ethSwappable =
    ethBal > MIN_GAS_RESERVE_WEI ? ethBal - MIN_GAS_RESERVE_WEI : BigInt(0);

  let lastSwapHash: string | null = null;
  const notes: SwapStepResult['notes'] = [];

  // Each asset's swap is wrapped in its own try/catch — a failure on ETH
  // doesn't strand USDC, and vice versa. Failures are recorded in `notes`
  // and the burn step proceeds with whatever userToken balance materialized.
  if (ethSwappable > BigInt(0)) {
    try {
      const quote = await quoteBestPath({
        tokenIn: WETH_BASE,
        tokenOut: ctx.tokenAddress,
        amountIn: ethSwappable,
        client,
      });
      if (!quote || quote.amountOut === BigInt(0)) {
        throw new Error('no_liquidity_eth_to_token');
      }
      await assertSwapValueVsMarket({
        client,
        inputToken: WETH_BASE,
        amountIn: ethSwappable,
        outputToken: ctx.tokenAddress,
        expectedOut: quote.amountOut,
      });
      const minOut = applySlippage(quote.amountOut, ctx.slippageBps);
      const data = encodeExactInput({
        path: quote.path,
        recipient: ctx.walletAddress,
        amountIn: ethSwappable,
        amountOutMinimum: minOut,
      });
      const hash = await sendTurnkeySignedTx(
        ctx,
        UNISWAP_V3_SWAP_ROUTER_02,
        data,
        ethSwappable, // msg.value — router wraps to WETH internally
      );
      lastSwapHash = hash;
      notes.push({
        asset: 'ETH',
        amountIn: formatUnits(ethSwappable, 18),
        success: true,
        hash,
      });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[BuybackExecutor] ETH swap failed for ${ctx.executionId}:`, reason);
      notes.push({
        asset: 'ETH',
        amountIn: formatUnits(ethSwappable, 18),
        success: false,
        error: reason,
      });
    }
  }

  for (const t of tokenBalances) {
    try {
      const quote = await quoteBestPath({
        tokenIn: t.address,
        tokenOut: ctx.tokenAddress,
        amountIn: t.amount,
        client,
      });
      if (!quote || quote.amountOut === BigInt(0)) {
        throw new Error(`no_liquidity_${t.symbol.toLowerCase()}_to_token`);
      }
      await assertSwapValueVsMarket({
        client,
        inputToken: t.address,
        amountIn: t.amount,
        outputToken: ctx.tokenAddress,
        expectedOut: quote.amountOut,
      });
      await approveIfNeeded(ctx, t.address, t.amount);
      const minOut = applySlippage(quote.amountOut, ctx.slippageBps);
      const data = encodeExactInput({
        path: quote.path,
        recipient: ctx.walletAddress,
        amountIn: t.amount,
        amountOutMinimum: minOut,
      });
      const hash = await sendTurnkeySignedTx(ctx, UNISWAP_V3_SWAP_ROUTER_02, data);
      lastSwapHash = hash;
      notes.push({
        asset: t.symbol,
        amountIn: formatUnits(t.amount, t.decimals),
        success: true,
        hash,
      });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[BuybackExecutor] ${t.symbol} swap failed for ${ctx.executionId}:`,
        reason,
      );
      notes.push({
        asset: t.symbol,
        amountIn: formatUnits(t.amount, t.decimals),
        success: false,
        error: reason,
      });
    }
  }

  const afterUserToken = (await client.readContract({
    address: ctx.tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [ctx.walletAddress],
  })) as bigint;

  return {
    swapHash: lastSwapHash,
    tokensOutAmount: afterUserToken - beforeUserToken,
    // Fees may have arrived already as the buyback token (no swap needed).
    // In that case tokensOutAmount delta is 0 even though there's balance to burn.
    tokenBalanceAfter: afterUserToken,
    notes,
  };
}

async function burnAcquiredTokens(ctx: RunCtx): Promise<{ burnHash: string; amount: bigint; burnMethod: string }> {
  const client = getBasePublicClient();
  const balance = (await client.readContract({
    address: ctx.tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [ctx.walletAddress],
  })) as bigint;

  if (balance === BigInt(0)) {
    throw new Error('no_balance_to_burn');
  }

  // Try token's native burn() first when configured, fall back to dead-address
  // transfer if the burn function reverts (e.g. permission-gated or non-standard ABI).
  if (ctx.burnMode === 'TOKEN_BURN_FN') {
    try {
      const data = encodeFunctionData({ abi: BURN_FN_ABI, functionName: 'burn', args: [balance] });
      const hash = await sendTurnkeySignedTx(ctx, ctx.tokenAddress, data);
      return { burnHash: hash, amount: balance, burnMethod: 'TOKEN_BURN_FN' };
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[BuybackExecutor] burn() failed for ${ctx.executionId}, falling back to dead-address transfer:`,
        reason,
      );
      // Fall through to dead-address transfer below.
    }
  }

  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [DEAD_ADDRESS, balance],
  });
  const hash = await sendTurnkeySignedTx(ctx, ctx.tokenAddress, data);
  return { burnHash: hash, amount: balance, burnMethod: 'DEAD_ADDRESS' };
}

// ---------- Recovery (sweep funds back to user's dev wallet) ----------

async function sweepToRecoveryAddress(ctx: RunCtx): Promise<string[]> {
  const client = getBasePublicClient();
  const hashes: string[] = [];

  // 1. Drain Splits Warehouse to the buyback wallet.
  hashes.push(...(await withdrawAllFromWarehouse(ctx)));

  // 2. ERC-20 sweeps: every ERC-20 in the wallet (WETH, USDC, arbitrary revenue
  //    tokens — discovered dynamically) + the userToken (in case there's a stale
  //    post-swap balance from a previously-failed burn step).
  const walletTokens = await discoverWalletErc20s(ctx.walletAddress);
  const tokensToSweep: Array<{ address: `0x${string}`; symbol: string }> = [
    ...walletTokens.map((t) => ({
      address: t.address as `0x${string}`,
      symbol: t.symbol,
    })),
    { address: ctx.tokenAddress, symbol: 'USERTOKEN' },
  ];
  // Dedupe in case userToken is also one of the supported tokens.
  const seen = new Set<string>();
  for (const t of tokensToSweep) {
    const key = t.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const bal = (await client.readContract({
        address: t.address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [ctx.walletAddress],
      })) as bigint;
      if (bal === BigInt(0)) continue;
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [ctx.recoveryAddress, bal],
      });
      hashes.push(await sendTurnkeySignedTx(ctx, t.address, data));
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[BuybackExecutor] sweep ${t.symbol} failed for ${ctx.executionId}:`,
        reason,
      );
      // Continue — sweep is best-effort per asset.
    }
  }

  // 3. Native ETH sweep — leave a small reserve for the sweep tx itself.
  try {
    const ethBal = await client.getBalance({ address: ctx.walletAddress });
    if (ethBal > MIN_GAS_RESERVE_WEI) {
      const sendable = ethBal - MIN_GAS_RESERVE_WEI;
      hashes.push(
        await sendTurnkeySignedTx(
          ctx,
          ctx.recoveryAddress,
          '0x',
          sendable,
        ),
      );
    }
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(
      `[BuybackExecutor] ETH sweep failed for ${ctx.executionId}:`,
      reason,
    );
  }

  return hashes;
}

// ---------- Main loop ----------

// Disable a config once it's clearly broken so client-driven /check calls can't
// keep re-queuing a swap that can never succeed (wrong pool / no route), burning
// gas each attempt. Mirrors the shared-split worker's BROKEN auto-pause.
async function maybeDisableAfterFailures(configId: string): Promise<void> {
  try {
    const lastExecs = await prisma.buybackExecution.findMany({
      where: { buybackConfigId: configId },
      orderBy: { startedAt: 'desc' },
      take: 3,
      select: { status: true },
    });
    if (lastExecs.length >= 3 && lastExecs.every((e) => e.status === 'FAILED')) {
      await prisma.buybackConfig.update({
        where: { id: configId },
        data: { isActive: false },
      });
      console.warn(
        `[BuybackExecutor] Config ${configId} disabled after 3 consecutive failed executions — pausing to stop repeated bad swaps`,
      );
    }
  } catch {
    /* non-fatal */
  }
}

// Re-read the target-token balance a few times before trusting a 0 — a lagging
// RPC node can report 0 immediately after a successful swap (read-after-write
// lag), which would otherwise mark a healthy buyback FAILED. Mirrors the
// shared-split worker's post-swap retry loop.
async function confirmTargetBalance(
  ctx: RunCtx,
  initial: bigint,
  hadSwapHash: boolean,
): Promise<bigint> {
  const client = getBasePublicClient();
  let balance = initial;
  for (let i = 0; balance === BigInt(0) && hadSwapHash && i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    balance = (await client.readContract({
      address: ctx.tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [ctx.walletAddress],
    })) as bigint;
  }
  return balance;
}

async function processOne(): Promise<void> {
  const now = new Date();

  const due = await prisma.buybackExecution.findMany({
    where: {
      status: { in: ['QUEUED', 'RETRYING'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    include: { buybackConfig: true },
    take: 5,
  });

  if (due.length === 0) return;

  for (const exec of due) {
    const config = exec.buybackConfig;
    if (!config.isActive) {
      // Owner disabled buyback — cancel pending executions.
      await prisma.buybackExecution.update({
        where: { id: exec.id },
        data: { status: 'FAILED', lastError: 'config_disabled', completedAt: new Date() },
      });
      continue;
    }

    // Atomic claim: set status to a transitional state so other workers skip.
    const claim = await prisma.buybackExecution.updateMany({
      where: { id: exec.id, attempts: exec.attempts },
      data: {
        attempts: exec.attempts + 1,
        status: 'WITHDRAWING',
        nextAttemptAt: null,
      },
    });
    if (claim.count === 0) {
      console.log(`[BuybackExecutor] Skipping ${exec.id} — claimed by another worker`);
      continue;
    }

    const isRecovery =
      exec.assetsIn &&
      typeof exec.assetsIn === 'object' &&
      !Array.isArray(exec.assetsIn) &&
      (exec.assetsIn as any).intent === 'recover';

    const ctx: RunCtx = {
      configId: config.id,
      executionId: exec.id,
      walletAddress: config.walletAddress as `0x${string}`,
      subOrgId: config.turnkeySubOrgId,
      tokenAddress: config.tokenAddress as `0x${string}`,
      tokenDecimals: config.tokenDecimals,
      slippageBps: clampSlippageBps(config.slippageBps),
      burnMode: config.burnMode,
      recoveryAddress: config.recoveryAddress as `0x${string}`,
    };

    const attempt = exec.attempts + 1;
    const isFinal = attempt >= MAX_ATTEMPTS;

    try {
      // Top up gas from the platform's operator wallet before any signing.
      // The buyback wallet pays its own gas for the actual ops; the drip just
      // ensures it has enough ETH on hand to do so. Drips come from a Turnkey
      // wallet with a "ETH transfers only, to known buyback wallets" policy,
      // so a Railway compromise still cannot reroute the gas budget.
      try {
        await ensureGasFunded(ctx.walletAddress);
      } catch (err: any) {
        // Operator-gas failures should fail the execution attempt, not silently
        // proceed and hit "insufficient funds" deeper in the flow with a
        // confusing error.
        throw new Error(`gas_drip_failed: ${err?.message ?? err}`);
      }

      if (isRecovery) {
        // Recovery sweep: drain Warehouse + transfer all balances on the
        // wallet to the user-configured recoveryAddress (= their dev wallet).
        // Permitted by the Turnkey policy because recoveryAddress is bound
        // into the policy at config-creation time.
        const sweepHashes = await sweepToRecoveryAddress(ctx);
        await prisma.buybackExecution.update({
          where: { id: exec.id },
          data: {
            warehouseWithdrawHashes: sweepHashes,
            status: 'COMPLETED',
            completedAt: new Date(),
          },
        });
        continue;
      }

      const withdrawHashes = await withdrawAllFromWarehouse(ctx);
      await prisma.buybackExecution.update({
        where: { id: exec.id },
        data: {
          warehouseWithdrawHashes: withdrawHashes,
          status: 'SWAPPING',
        },
      });

      const swap = await swapAllToUserToken(ctx);
      // Use tokenBalanceAfter (not the delta) to decide whether to proceed to burn.
      // Fees can arrive already as the buyback token — in that case tokensOutAmount
      // is 0 (no swap ran) but tokenBalanceAfter > 0 and burn should still fire.
      // Confirm a 0 across a few RPC reads first so read-after-write lag can't
      // false-fail a healthy buyback.
      const tokenBalanceAfter = await confirmTargetBalance(
        ctx,
        swap.tokenBalanceAfter,
        Boolean(swap.swapHash),
      );
      // Decide purely on the resulting balance — if the buyback token is present
      // (bought now, or fees arrived already denominated in it), burn it even if
      // some other asset's swap leg failed. Never skip a burnable balance.
      if (tokenBalanceAfter === BigInt(0)) {
        if (!swap.swapHash) {
          // No swap actually executed this attempt: every leg threw (fail-closed
          // market guard on a stale price, a transient RPC/quote blip, or no
          // route this poll). This is RETRYABLE — do NOT permanently disable a
          // possibly-healthy config on one bad poll. Let the retry/backoff and
          // the 3-consecutive-failure auto-disable handle persistence.
          throw new Error(
            `no_swap_executed: ${JSON.stringify(swap.notes).slice(0, 300)}`,
          );
        }
        // A swap executed on-chain but yielded zero tokens (even after the RPC
        // re-read) — a genuine wrong pool / venue / no-liquidity signal. Disable
        // so client /check calls stop re-triggering the same bad swap.
        await prisma.buybackExecution.update({
          where: { id: exec.id },
          data: {
            status: 'FAILED',
            swapHash: swap.swapHash,
            lastError: `swap_produced_no_tokens: ${JSON.stringify(swap.notes).slice(0, 300)}`,
            completedAt: new Date(),
          },
        });
        await prisma.buybackConfig.update({
          where: { id: config.id },
          data: { isActive: false },
        });
        console.warn(
          `[BuybackExecutor] Config ${config.id} disabled — swap produced no tokens (possible wrong pool/venue)`,
        );
        continue;
      }
      await prisma.buybackExecution.update({
        where: { id: exec.id },
        data: {
          swapHash: swap.swapHash ?? undefined,
          status: 'BURNING',
        },
      });

      const burn = await burnAcquiredTokens(ctx);

      let usdEstimate: number | undefined;
      try {
        const tokenAmountHuman = Number(formatUnits(burn.amount, ctx.tokenDecimals));
        // We don't know the token's USD price from coingecko (it's user-supplied),
        // so we report the trigger USD as a stand-in.
        usdEstimate = exec.triggerBalanceUsd;
        void tokenAmountHuman;
      } catch {
        // ignore — accounting is best-effort.
      }

      await prisma.buybackExecution.update({
        where: { id: exec.id },
        data: {
          status: 'COMPLETED',
          burnHash: burn.burnHash,
          tokensOutAmount: burn.amount.toString(),
          tokensOutUsd: usdEstimate,
          completedAt: new Date(),
        },
      });
      await prisma.buybackConfig.update({
        where: { id: config.id },
        data: { lastTriggeredAt: new Date() },
      });

      console.log(
        `[BuybackExecutor] Completed ${exec.id}: burned ${formatUnits(burn.amount, ctx.tokenDecimals)} ${config.tokenSymbol} via ${burn.burnMethod}`,
      );
    } catch (err: any) {
      const reason: string = err?.message ?? 'unknown_error';
      const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
      await prisma.buybackExecution.update({
        where: { id: exec.id },
        data: {
          status: isFinal ? 'FAILED' : 'RETRYING',
          lastError: reason.slice(0, 500),
          nextAttemptAt: isFinal ? null : new Date(Date.now() + delay),
          completedAt: isFinal ? new Date() : null,
        },
      });
      console.error(
        `[BuybackExecutor] Execution ${exec.id} attempt ${attempt} failed:`,
        reason,
      );
      if (isFinal) await maybeDisableAfterFailures(config.id);
    }
  }
}

export function startBuybackExecutorWorker(): void {
  if (intervalHandle) return;
  console.log(
    `[BuybackExecutor] Starting — polling every ${POLL_INTERVAL_MS / 1000}s`,
  );
  processOne().catch((e) =>
    console.error('[BuybackExecutor] Initial run error:', e),
  );
  intervalHandle = setInterval(() => {
    processOne().catch((e) => console.error('[BuybackExecutor] Poll error:', e));
  }, POLL_INTERVAL_MS);
}

export function stopBuybackExecutorWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
